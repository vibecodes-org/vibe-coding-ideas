import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpContext } from "../context";
import { listMySessions, sendSessionMessage } from "./session-messages";
import { buildSessionEnvValue, verifyPeerFrame } from "../../../terminal/shared/peer-message.mjs";

const ME = "00000000-0000-4000-a000-000000000001";
const OTHER_USER = "00000000-0000-4000-a000-000000000009";
// Database rows hold the key as base64 text. The helper (bridge) decodes it to a
// 32-byte Buffer and uses THAT, so the tests must model both forms.
const KEY_A = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 256)).toString("base64");
const KEY_B = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 11 + 5) % 256)).toString("base64");
const bridgeKey = (b64: string) => Buffer.from(b64, "base64");

type Row = Record<string, unknown>;
let sessions: Row[] = [];

function ctx(): McpContext {
  const query = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const c: Record<string, unknown> = {};
    c.select = vi.fn(() => c);
    c.eq = vi.fn((k: string, v: unknown) => (filters.push([k, v]), c));
    c.in = vi.fn(() => c);
    c.range = vi.fn(() => c);
    c.update = vi.fn(() => c);
    const result = () => {
      if (table === "ideas") return { data: [{ id: "idea-1", title: "My Board" }], error: null };
      // Behave like the database: apply the user_id / status filters the tool asked for.
      const rows = sessions.filter((r) => filters.every(([k, v]) => r[k] === v));
      return { data: rows, error: null };
    };
    c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
    return c;
  };
  return { supabase: { from: (t: string) => query(t) } as unknown as McpContext["supabase"], userId: ME };
}

const row = (over: Row): Row => ({
  user_id: ME, status: "active", idea_id: "idea-1", task_id: null, task_title: null, display_name: null,
  machine_label: "Mac", agent: "claude", e2ee_session_key: KEY_B, expires_at: new Date(Date.now() + 3_600_000).toISOString(), ...over,
});

let lastBody: { id: string; frame: string } | null = null;
let relayOutcome: unknown = "delivered";
let relayThrows = false;

beforeEach(() => {
  process.env.TERMINAL_SESSION_SECRET = "test-secret";
  lastBody = null;
  relayOutcome = "delivered";
  relayThrows = false;
  sessions = [
    row({ sid: "sender-sid", display_name: "Plan", agent: "codex", e2ee_session_key: KEY_A }),
    row({ sid: "target-sid", display_name: "Review", agent: "claude", e2ee_session_key: KEY_B }),
    row({ sid: "foreign-sid", user_id: OTHER_USER, display_name: "Theirs", e2ee_session_key: "c".repeat(43) }),
    row({ sid: "ended-sid", status: "ended", display_name: "Done" }),
  ];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
    if (relayThrows) throw new Error("down");
    lastBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ outcome: relayOutcome }), { status: 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

const FROM = () => buildSessionEnvValue(bridgeKey(KEY_A), "sender-sid");

describe("list_my_sessions", () => {
  it("lists only the caller's own active sessions and never a key", async () => {
    const r = await listMySessions(ctx(), { from_session: FROM() });
    expect(r.sessions.map((s) => s.id).sort()).toEqual(["sender-sid", "target-sid"]);
    expect(JSON.stringify(r)).not.toContain(KEY_A);
    expect(JSON.stringify(r)).not.toContain(KEY_B);
    expect(r.sessions.find((s) => s.id === "sender-sid")).toMatchObject({ you: true, agent: "Codex", can_receive: true });
    expect(r.sessions.find((s) => s.id === "target-sid")).toMatchObject({ agent: "Claude Code", can_receive: true, board: "My Board" });
  });
});

describe("send_session_message", () => {
  it("delivers: the relay gets one signed frame for the target, with the sender stamped from the database", async () => {
    const r = await sendSessionMessage(ctx(), { to: "Review", message: "hello\x1b[31m there", from_session: FROM() });
    expect(r).toMatchObject({ delivered: true, outcome: "delivered" });
    expect(JSON.stringify(r)).not.toContain("hello");
    const v = verifyPeerFrame({ key: bridgeKey(KEY_B), text: lastBody!.frame, sid: "target-sid" });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.env.text).toBe("hello[31m there");
      expect(v.env.from).toEqual({ sid: "sender-sid", name: "Plan", agent: "codex" });
    }
  });

  it("works with keys the way the helper holds them: a Buffer decoded from the stored base64", async () => {
    // Regression: the server once keyed with the base64 text, so every proof and every signature mismatched.
    const r = await sendSessionMessage(ctx(), { to: "target-sid", message: "hi", from_session: buildSessionEnvValue(bridgeKey(KEY_A), "sender-sid") });
    expect(r).toMatchObject({ delivered: true });
    // The base64 text as a key must NOT verify: that was the bug.
    expect(verifyPeerFrame({ key: KEY_B, text: lastBody!.frame, sid: "target-sid" }).ok).toBe(false);
    expect(verifyPeerFrame({ key: bridgeKey(KEY_B), text: lastBody!.frame, sid: "target-sid" }).ok).toBe(true);
    const bad = await sendSessionMessage(ctx(), { to: "target-sid", message: "hi", from_session: buildSessionEnvValue(KEY_A, "sender-sid") });
    expect(bad.outcome).toBe("not-sent");
  });

  it("refuses a missing or wrong proof and sends nothing", async () => {
    for (const from of [undefined, "sender-sid.wrongproof", buildSessionEnvValue(Buffer.alloc(32, 9), "sender-sid"), buildSessionEnvValue(bridgeKey(KEY_A), "foreign-sid")]) {
      const r = await sendSessionMessage(ctx(), { to: "target-sid", message: "hi", from_session: from });
      expect(r.delivered).toBe(false);
      expect(r.outcome).toBe("not-sent");
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("another user's session id is simply not found and nothing is sent", async () => {
    const r = await sendSessionMessage(ctx(), { to: "foreign-sid", message: "hi", from_session: FROM() });
    expect(r).toMatchObject({ delivered: false, outcome: "not-sent" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses yourself, an ended session, an empty message and 2,001 characters", async () => {
    expect((await sendSessionMessage(ctx(), { to: "sender-sid", message: "hi", from_session: FROM() })).message).toMatch(/your own session/);
    expect((await sendSessionMessage(ctx(), { to: "ended-sid", message: "hi", from_session: FROM() })).outcome).toBe("not-sent");
    expect((await sendSessionMessage(ctx(), { to: "target-sid", message: "\x1b\x03", from_session: FROM() })).message).toMatch(/empty/);
    expect((await sendSessionMessage(ctx(), { to: "target-sid", message: "x".repeat(2001), from_session: FROM() })).message).toMatch(/2000/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a target with no key can't receive (an old session)", async () => {
    sessions[1].e2ee_session_key = null;
    const r = await sendSessionMessage(ctx(), { to: "target-sid", message: "hi", from_session: FROM() });
    expect(r.outcome).toBe("cannot-receive");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("passes the relay's honest answers through and never reports success for anything but delivered", async () => {
    for (const o of ["waiting", "not-running", "helper-too-old", "rate-limited", "unconfirmed", "cannot-receive", "rejected"]) {
      relayOutcome = o;
      const r = await sendSessionMessage(ctx(), { to: "target-sid", message: "hi", from_session: FROM() });
      expect(r.delivered).toBe(false);
      expect(r.outcome).toBe(o);
    }
  });

  it("an unreachable or unknown-answer relay is reported as not sent, never as success", async () => {
    relayThrows = true;
    expect(await sendSessionMessage(ctx(), { to: "target-sid", message: "hi", from_session: FROM() })).toMatchObject({ delivered: false, outcome: "not-sent" });
    relayThrows = false;
    relayOutcome = "something-new";
    expect(await sendSessionMessage(ctx(), { to: "target-sid", message: "hi", from_session: FROM() })).toMatchObject({ delivered: false, outcome: "not-sent" });
  });

  it("fails clearly when the server has no terminal secret", async () => {
    process.env.TERMINAL_SESSION_SECRET = "   ";
    await expect(sendSessionMessage(ctx(), { to: "target-sid", message: "hi", from_session: FROM() })).rejects.toThrow(/isn't configured/);
  });
});
