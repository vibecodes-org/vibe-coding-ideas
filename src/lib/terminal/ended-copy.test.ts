import { describe, expect, it } from "vitest";
import {
  endedCopy,
  endedCopyText,
  endedReasonAllowsResume,
  collectEndedCopy,
  FORBIDDEN_ENDED_COPY,
  type EndedCopyInput,
} from "./ended-copy";

// Card 6b2cb8ac (regression test 11, copy half): the ended screens' wording is
// pinned to the approved mock (docs/terminal-fresh-mac-folder-mock.html,
// sections 2, 3 and 4b).

const base: EndedCopyInput = {
  reason: "remote",
  detail: null,
  agent: "claude",
  folder: null,
  repo: null,
  newFolder: null,
};

const text = (i: Partial<EndedCopyInput>) => {
  const c = endedCopy({ ...base, ...i });
  return { ...c, bodyText: endedCopyText(c.body) };
};

describe("ended copy — pinned to the approved mock", () => {
  it("2a folder missing (resume)", () => {
    const c = text({ reason: "folder-missing", folder: "~/projects/vibe-coding-ideas" });
    expect(c.title).toBe("Claude Code stopped on your Mac straight away");
    expect(c.bodyText).toBe(
      "The project folder ~/projects/vibe-coding-ideas isn't on this Mac, so this conversation can't be reopened here. Start again for a new session: VibeCodes will find or download the project on this Mac."
    );
    expect(c.body.some((p) => p.code === "~/projects/vibe-coding-ideas")).toBe(true);
    expect(c.primary).toBe("start-again");
    expect(c.showDetails).toBe(false);
  });

  it("2b / 2c agent not installed", () => {
    const claude = text({ reason: "agent-not-installed" });
    expect(claude.title).toBe("Claude Code stopped on your Mac straight away");
    expect(claude.bodyText).toBe("Claude Code isn't installed on this Mac. Install it, then start again.");
    expect(claude.installLink).toEqual({ agent: "claude", label: "How to install Claude Code" });
    const codex = text({ reason: "agent-not-installed", agent: "codex" });
    expect(codex.title).toBe("Codex stopped on your Mac straight away");
    expect(codex.bodyText).toBe("Codex isn't installed on this Mac. Install it, then start again.");
    expect(codex.installLink).toEqual({ agent: "codex", label: "How to install Codex" });
  });

  it("2d stopped straight away with an exit code", () => {
    const c = text({ reason: "agent-stopped-early", detail: "1" });
    expect(c.title).toBe("Claude Code stopped on your Mac straight away");
    expect(c.bodyText).toBe(
      "It closed before it showed anything (exit code 1). Start again. If it keeps happening, open Terminal on this Mac and type claude to see its own message."
    );
    expect(c.body.some((p) => p.code === "claude")).toBe(true);
    expect(c.showDetails).toBe(true);
    expect(text({ reason: "agent-stopped-early", detail: "1", agent: "codex" }).body.some((p) => p.code === "codex")).toBe(true);
  });

  it("2e old helper", () => {
    const c = text({ reason: "agent-stopped-early", detail: "old-helper" });
    expect(c.title).toBe("Claude Code stopped on your Mac straight away");
    expect(c.bodyText).toBe(
      "The VibeCodes helper on this Mac is out of date, so it can't tell us why. Update it, then start again."
    );
    expect(c.showUpdate).toBe(true);
    expect(c.showDetails).toBe(false);
  });

  it("3a no access to a private project", () => {
    const c = text({ reason: "clone-no-access", repo: { owner: "you", name: "example-app" } });
    expect(c.title).toBe("Couldn't download example-app");
    expect(c.bodyText).toBe(
      "It's a private GitHub project, and this Mac isn't signed in to GitHub with an account that can see you/example-app. Sign this Mac in to GitHub (in Terminal: gh auth login), or download it once yourself with git clone https://github.com/you/example-app.git ~/projects/example-app. Then start again."
    );
    expect(c.showDetails).toBe(true);
    expect(c.barText).toBe("Couldn't download example-app.");
  });

  it("3b the download didn't finish", () => {
    const c = text({ reason: "clone-failed", repo: { owner: "vibecodes-org", name: "vibe-coding-ideas" } });
    expect(c.title).toBe("Couldn't download vibe-coding-ideas");
    expect(c.bodyText).toBe(
      "The download from GitHub stopped before it finished. Check this Mac's internet connection, then start again. Nothing half-downloaded was left behind."
    );
    expect(c.showDetails).toBe(true);
  });

  it("3c git missing", () => {
    const c = text({ reason: "git-missing" });
    expect(c.title).toBe("This Mac needs Apple's developer tools first");
    expect(c.bodyText).toBe(
      "Git isn't installed yet, so the project can't be downloaded. Your Mac is showing Apple's installer now: click Install (it takes a few minutes), then start again."
    );
  });

  it("3d folder can't be created / couldn't ask VibeCodes", () => {
    const c = text({ reason: "folder-unavailable", newFolder: "~/projects/my-new-idea" });
    expect(c.title).toBe("Couldn't create the project folder");
    expect(c.bodyText).toBe("~/projects/my-new-idea couldn't be created on this Mac. Check there's free space, then start again.");
    const l = text({ reason: "folder-lookup-failed" });
    expect(l.title).toBe("Couldn't check where this project lives");
    expect(l.bodyText).toBe(
      "The helper on this Mac couldn't reach VibeCodes to look it up. Check this Mac's internet connection, then start again."
    );
  });

  it("4b helper closed keeps Resume; today's remote end is unchanged", () => {
    const h = text({ reason: "helper-closed" });
    expect(h.title).toBe("The helper on your Mac was closed");
    expect(h.bodyText).toBe(
      "Claude Code stopped because the VibeCodes helper quit (for example, for an update). Your conversation is saved."
    );
    expect(h.primary).toBe("resume");
    const r = text({ reason: "remote" });
    expect(r.title).toBe("Session ended");
    expect(r.bodyText).toBe("Claude Code on your machine stopped. The scrollback above is kept.");
    expect(r.primary).toBe("resume");
  });

  it("unknown repo / folder still reads as plain English", () => {
    expect(text({ reason: "clone-no-access" }).title).toBe("Couldn't download the project");
    expect(text({ reason: "folder-missing" }).bodyText).toContain("The project folder isn't on this Mac");
    expect(text({ reason: "agent-stopped-early" }).bodyText).toContain("It closed before it showed anything. Start again.");
  });
});

describe("endedReasonAllowsResume", () => {
  it("never for a session that never started; yes for one that ran", () => {
    for (const r of [
      "agent-stopped-early",
      "agent-not-installed",
      "folder-missing",
      "folder-unavailable",
      "folder-not-allowed",
      "folder-lookup-failed",
      "clone-failed",
      "clone-no-access",
      "git-missing",
      "user",
    ] as const) {
      expect(endedReasonAllowsResume(r), r).toBe(false);
    }
    for (const r of ["helper-closed", "remote", "idle", "max-duration", "reconnect-failed"] as const) {
      expect(endedReasonAllowsResume(r), r).toBe(true);
    }
  });
});

describe("ended copy — no error-speak or jargon", () => {
  const strings = collectEndedCopy();
  it("collects the copy", () => {
    expect(strings.length).toBeGreaterThan(20);
  });
  it.each(FORBIDDEN_ENDED_COPY)("never uses %s", (word) => {
    const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    const offenders = strings.filter((s) => re.test(s));
    expect(offenders, `forbidden "${word}" in: ${offenders.join(" | ")}`).toEqual([]);
  });
});
