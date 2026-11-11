import { describe, expect, it } from "vitest";
import { outcomeText, peerSessionName, resolvePeerTarget, toListedSession, type PeerSessionRow } from "./peer-message";

const row = (over: Partial<PeerSessionRow> = {}): PeerSessionRow => ({
  sid: "sid-a", display_name: null, task_title: null, agent: "claude", idea_id: "i", task_id: null,
  machine_label: "Mac", e2ee_session_key: "k", ...over,
});

describe("peerSessionName", () => {
  it("prefers the display name, then the task title, then Untitled session", () => {
    expect(peerSessionName(row({ display_name: " Mine ", task_title: "T" }))).toBe("Mine");
    expect(peerSessionName(row({ task_title: "T" }))).toBe("T");
    expect(peerSessionName(row())).toBe("Untitled session");
  });
});

describe("resolvePeerTarget", () => {
  const rows = [row({ sid: "s1", display_name: "Plan" }), row({ sid: "s2", display_name: "Review" }), row({ sid: "s3", display_name: "Review" })];
  it("matches a session id", () => {
    expect(resolvePeerTarget(rows, "s2", "s1")).toMatchObject({ ok: true });
  });
  it("matches an exact name only when it is unique", () => {
    expect(resolvePeerTarget(rows, "plan", "s2")).toMatchObject({ ok: true, row: { sid: "s1" } });
    expect(resolvePeerTarget(rows, "Review", "s1")).toEqual({ ok: false, reason: "ambiguous" });
  });
  it("refuses yourself and unknown or foreign ids (rows are only the caller's own)", () => {
    expect(resolvePeerTarget(rows, "s1", "s1")).toEqual({ ok: false, reason: "self" });
    expect(resolvePeerTarget(rows, "Plan", "s1")).toEqual({ ok: false, reason: "self" });
    expect(resolvePeerTarget(rows, "someone-elses-sid", "s1")).toEqual({ ok: false, reason: "not-found" });
    expect(resolvePeerTarget(rows, "  ", "s1")).toEqual({ ok: false, reason: "not-found" });
  });
});

describe("outcomeText", () => {
  it("never claims delivery for anything but delivered", () => {
    for (const o of ["waiting", "not-running", "helper-too-old", "cannot-receive", "rate-limited", "unconfirmed", "rejected"] as const) {
      expect(outcomeText(o, "X")).not.toMatch(/^Delivered/);
    }
    expect(outcomeText("delivered", "X")).toBe('Delivered to "X".');
    expect(outcomeText("unconfirmed", "X")).toMatch(/didn't confirm/);
  });
});

describe("toListedSession", () => {
  it("says Codex sessions can't receive yet, and Claude sessions with a key can", () => {
    expect(toListedSession(row({ agent: "codex" }), "B", false).can_receive).toBe(false);
    expect(toListedSession(row(), "B", false).can_receive).toBe(true);
    expect(toListedSession(row({ e2ee_session_key: null }), "B", false).can_receive).toBe(false);
    expect(toListedSession(row(), "B", true).you).toBe(true);
  });
  it("never returns the session key", () => {
    expect(JSON.stringify(toListedSession(row(), "B", false))).not.toContain('"k"');
  });
});
