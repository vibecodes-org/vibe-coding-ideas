import { describe, it, expect } from "vitest";
import {
  normalizeName,
  parseMentionTokens,
  resolveMentions,
  stepTaskUnresolvedMentions,
  mightContainMention,
  type RosterMember,
} from "./mentions";

const NICK_BALL = "10000000-0000-4000-a000-000000000001";
const NICK_SOLO = "10000000-0000-4000-a000-000000000002";
const ADA = "10000000-0000-4000-a000-000000000003";
const JOSE = "10000000-0000-4000-a000-000000000004";
const CHRIS_ANDERSON = "10000000-0000-4000-a000-000000000005";
const CHRIS_BAKER = "10000000-0000-4000-a000-000000000006";

/** Roster used in docs/design-mcp-mention-comments.html §4.5 worked examples. */
const WORKED_ROSTER: RosterMember[] = [
  { user_id: NICK_BALL, full_name: "Nick Ball" },
  { user_id: NICK_SOLO, full_name: "Nick" },
  { user_id: ADA, full_name: "Ada Lovelace" },
  { user_id: JOSE, full_name: "José Díaz" },
];

const CHRIS_ROSTER: RosterMember[] = [
  { user_id: CHRIS_ANDERSON, full_name: "Chris Anderson" },
  { user_id: CHRIS_BAKER, full_name: "Chris Baker" },
];

function tokensOf(content: string, roster: RosterMember[] = WORKED_ROSTER) {
  return parseMentionTokens(content, roster);
}

describe("normalizeName", () => {
  it("NFKC-normalises, casefolds, and collapses whitespace", () => {
    expect(normalizeName("  Nick   Ball  ")).toBe("nick ball");
    expect(normalizeName("NICK BALL")).toBe("nick ball");
  });

  it("preserves diacritics", () => {
    expect(normalizeName("José Díaz")).not.toBe(normalizeName("Jose Diaz"));
  });
});

describe("parseMentionTokens — worked examples (design §4.5)", () => {
  it("1. greedy longest match: @Nick Ball beats bare Nick", () => {
    const result = tokensOf("Hey @Nick Ball can you look?");
    expect(result).toEqual([{ token: "Nick Ball", user_id: NICK_BALL }]);
  });

  it("2. trailing comma is not part of the name", () => {
    const result = tokensOf("thanks @Nick, done");
    expect(result).toEqual([{ token: "Nick", user_id: NICK_SOLO }]);
  });

  it("3. parenthesis is a valid boundary; closing paren is trailing punct", () => {
    const result = tokensOf("ping (@Nick Ball) re: build");
    expect(result).toEqual([{ token: "Nick Ball", user_id: NICK_BALL }]);
  });

  it("4. email guard: @ preceded by alnum never triggers", () => {
    const result = tokensOf("mail me at ballathesenior@gmail.com");
    expect(result).toEqual([]);
  });

  it("5. unknown name gets no partial credit", () => {
    const result = tokensOf("@Nicky started it");
    expect(result).toEqual([{ token: "Nicky", reason: "unknown_name" }]);
  });

  it("6. two distinct mentions, scan resumes after each match", () => {
    const result = tokensOf("cc @Ada Lovelace and @Nick");
    expect(result).toEqual([
      { token: "Ada Lovelace", user_id: ADA },
      { token: "Nick", user_id: NICK_SOLO },
    ]);
  });

  it("7. diacritics preserved and matched", () => {
    const result = tokensOf("see @José Díaz output");
    expect(result).toEqual([{ token: "José Díaz", user_id: JOSE }]);
  });

  it("8. parses inside code spans (deliberately not fence-aware)", () => {
    const result = tokensOf("`git log --author @Nick Ball`");
    expect(result).toEqual([{ token: "Nick Ball", user_id: NICK_BALL }]);
  });

  it("9. case/whitespace-insensitive, adjacent tokens, dedupe by user_id", () => {
    const result = tokensOf("@Nick @Nick Ball @nick ball");
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ token: "Nick", user_id: NICK_SOLO });
    expect(result[1]).toEqual({ token: "Nick Ball", user_id: NICK_BALL });
    expect(result[2].user_id).toBe(NICK_BALL); // "nick ball" case-insensitive match
    // De-dupe happens downstream in resolveMentions, not in the raw token list.
  });

  it("10. lone @ with no following name run is silently ignored", () => {
    const result = tokensOf("email @ me later");
    expect(result).toEqual([]);
  });
});

describe("parseMentionTokens — Nick amendment 2 (first-name matching)", () => {
  it("single unique first name resolves", () => {
    const roster: RosterMember[] = [{ user_id: CHRIS_ANDERSON, full_name: "Chris Anderson" }];
    const result = parseMentionTokens("@Chris can you take this?", roster);
    expect(result).toEqual([{ token: "Chris", user_id: CHRIS_ANDERSON }]);
  });

  it("ambiguous first name (two Chrises) -> ambiguous_name", () => {
    const result = parseMentionTokens("@Chris please review", CHRIS_ROSTER);
    expect(result).toEqual([{ token: "Chris", reason: "ambiguous_name" }]);
  });

  it("full-name match takes precedence over first-name fallback", () => {
    const result = parseMentionTokens("@Chris Baker please review", CHRIS_ROSTER);
    expect(result).toEqual([{ token: "Chris Baker", user_id: CHRIS_BAKER }]);
  });

  it("zero first-name matches falls through to unknown_name", () => {
    const result = parseMentionTokens("@Zed is unknown", CHRIS_ROSTER);
    expect(result).toEqual([{ token: "Zed", reason: "unknown_name" }]);
  });
});

describe("mightContainMention", () => {
  it("detects a plausible mention boundary", () => {
    expect(mightContainMention("hi @Nick")).toBe(true);
    expect(mightContainMention("(@Nick)")).toBe(true);
  });

  it("ignores email-like strings and lone @", () => {
    expect(mightContainMention("a@b.com")).toBe(false);
    expect(mightContainMention("email @ me")).toBe(false);
    expect(mightContainMention("no mentions here")).toBe(false);
  });
});

describe("resolveMentions", () => {
  const teamWithPrefs: RosterMember[] = [
    { user_id: NICK_BALL, full_name: "Nick Ball", notification_preferences: { task_mentions: true } },
    { user_id: ADA, full_name: "Ada Lovelace", notification_preferences: { task_mentions: false } },
  ];

  it("self-skip via ctx.userId", () => {
    const result = resolveMentions({
      content: "hey @Nick Ball",
      team: teamWithPrefs,
      selfIds: [NICK_BALL],
    });
    expect(result.notified).toEqual([]);
    expect(result.unresolved).toEqual([{ user_id: NICK_BALL, reason: "self" }]);
    expect(result.warning).toBeUndefined(); // self is not a "genuine miss"
  });

  it("self-skip via ctx.ownerUserId", () => {
    const result = resolveMentions({
      content: "hey @Nick Ball",
      team: teamWithPrefs,
      selfIds: ["some-other-id", NICK_BALL],
    });
    expect(result.unresolved).toEqual([{ user_id: NICK_BALL, reason: "self" }]);
  });

  it("opted_out when notification_preferences.task_mentions === false", () => {
    const result = resolveMentions({
      content: "cc @Ada Lovelace",
      team: teamWithPrefs,
      selfIds: [],
    });
    expect(result.notified).toEqual([]);
    expect(result.unresolved).toEqual([{ user_id: ADA, reason: "opted_out" }]);
    expect(result.warning).toBeUndefined(); // opted_out is not a "genuine miss"
  });

  it("not_team_member for an explicit id outside the roster", () => {
    const outsiderId = "20000000-0000-4000-a000-000000000099";
    const result = resolveMentions({
      content: "no @ mentions in text",
      mentionedUserIds: [outsiderId],
      team: teamWithPrefs,
      selfIds: [],
    });
    expect(result.notified).toEqual([]);
    expect(result.unresolved).toEqual([{ user_id: outsiderId, reason: "not_team_member" }]);
    expect(result.warning).toContain("1 mention");
  });

  it("unions explicit id + parsed name for the same user into one entry", () => {
    const result = resolveMentions({
      content: "hey @Nick Ball, thanks",
      mentionedUserIds: [NICK_BALL],
      team: teamWithPrefs,
      selfIds: [],
    });
    expect(result.notified).toEqual([{ user_id: NICK_BALL, full_name: "Nick Ball" }]);
    expect(result.unresolved).toEqual([]);
  });

  it("full success: notified with no warning", () => {
    const result = resolveMentions({
      content: "great work @Nick Ball",
      team: teamWithPrefs,
      selfIds: [],
    });
    expect(result.notified).toEqual([{ user_id: NICK_BALL, full_name: "Nick Ball" }]);
    expect(result.unresolved).toEqual([]);
    expect(result.warning).toBeUndefined();
  });

  it("unknown_name produces a warning", () => {
    const result = resolveMentions({
      content: "@Nicky did this",
      team: teamWithPrefs,
      selfIds: [],
    });
    expect(result.unresolved).toEqual([{ token: "Nicky", reason: "unknown_name" }]);
    expect(result.warning).toContain('"Nicky"');
  });

  it("no mentions at all -> empty arrays, no warning", () => {
    const result = resolveMentions({ content: "plain text", team: teamWithPrefs, selfIds: [] });
    expect(result).toEqual({ notified: [], unresolved: [] });
  });
});

describe("stepTaskUnresolvedMentions", () => {
  it("reports each explicit id as step_task_unresolved with a warning", () => {
    const id1 = "30000000-0000-4000-a000-000000000001";
    const id2 = "30000000-0000-4000-a000-000000000002";
    const result = stepTaskUnresolvedMentions("some content", [id1, id2]);
    expect(result.notified).toEqual([]);
    expect(result.unresolved).toEqual([
      { user_id: id1, reason: "step_task_unresolved" },
      { user_id: id2, reason: "step_task_unresolved" },
    ]);
    expect(result.warning).toBeDefined();
  });

  it("flags content-only @mentions with a reason-only entry", () => {
    const result = stepTaskUnresolvedMentions("hey @Someone", []);
    expect(result.unresolved).toEqual([{ reason: "step_task_unresolved" }]);
    expect(result.warning).toBeDefined();
  });

  it("no candidates at all -> empty, no warning", () => {
    const result = stepTaskUnresolvedMentions("plain content", []);
    expect(result).toEqual({ notified: [], unresolved: [] });
  });
});
