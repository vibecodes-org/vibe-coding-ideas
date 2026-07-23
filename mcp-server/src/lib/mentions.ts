/**
 * Pure @mention parsing + resolution for task and step comments
 * (docs/design-mcp-mention-comments.html). Everything in this file is a
 * pure function — no Supabase calls — so it can be unit tested without
 * mocks. Tool-level orchestration (team lookup, notification insert) lives
 * in mcp-server/src/lib/mention-notify.ts.
 */

// --- Types ---------------------------------------------------------------

/**
 * Binding reason enum (exhaustive, machine-stable — do not rename without
 * updating every caller/consumer).
 */
export type UnresolvedReason =
  | "unknown_name"
  | "ambiguous_name"
  | "not_team_member"
  | "opted_out"
  | "self"
  | "step_task_unresolved";

/** A roster entry: an idea's human team member (author or collaborator). */
export interface RosterMember {
  user_id: string;
  full_name: string | null;
  notification_preferences?: { task_mentions?: boolean } | null;
}

/** An element of `mentions.notified[]` in the tool response. */
export interface ResolvedMention {
  user_id: string;
  full_name: string | null;
}

/** An element of `mentions.unresolved[]` in the tool response. */
export interface UnresolvedMention {
  token?: string;
  user_id?: string;
  reason: UnresolvedReason;
}

/** The `mentions` field appended to add_task_comment / add_step_comment. */
export interface MentionResolution {
  notified: ResolvedMention[];
  unresolved: UnresolvedMention[];
  /** Present only when `unresolved` contains at least one "genuine miss". */
  warning?: string;
}

/** A single @token parsed from comment content, matched against the roster. */
export interface ParsedMentionToken {
  /** Raw text after '@' as typed (trailing punctuation stripped). */
  token: string;
  /** Present when the token resolved uniquely to one roster member. */
  user_id?: string;
  /** Present when the token did not resolve to exactly one roster member. */
  reason?: "unknown_name" | "ambiguous_name";
}

// --- Normalisation (design §4.1) -----------------------------------------

/**
 * NFKC-normalise, casefold, and collapse whitespace. Diacritics are
 * deliberately preserved (é ≠ e) — full names are identity data.
 */
export function normalizeName(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

// --- Parsing (design §4.2/§4.3/§4.4 + Nick amendment 2) ------------------

const ALNUM_RE = /[\p{L}\p{N}]/u;
/** Characters allowed inside a name word. */
const NAME_WORD_RE = /^[\p{L}\p{N}'.-]+/u;
/** Trailing sentence-punctuation stripped from the end of a matched word. */
const TRAILING_DOT_RE = /\.+$/;

function isAlnum(ch: string | undefined): boolean {
  return !!ch && ALNUM_RE.test(ch);
}

function stripTrailingDot(word: string): string {
  return word.replace(TRAILING_DOT_RE, "");
}

interface ExtractedWord {
  word: string;
  /** Index in `content` immediately after this word. */
  end: number;
}

/**
 * Extracts up to `maxWords` consecutive name-words starting at `start`,
 * each separated by a run of whitespace. Stops as soon as a word or the
 * expected whitespace separator is missing (so "@Nick, done" stops after
 * "Nick" — the comma is not a name character and not whitespace).
 */
function extractWords(content: string, start: number, maxWords: number): ExtractedWord[] {
  const words: ExtractedWord[] = [];
  let pos = start;
  for (let n = 0; n < maxWords; n++) {
    const m = NAME_WORD_RE.exec(content.slice(pos));
    if (!m) break;
    const word = m[0];
    pos += word.length;
    words.push({ word, end: pos });
    if (n < maxWords - 1) {
      const ws = /^\s+/.exec(content.slice(pos));
      if (!ws) break;
      const after = content.slice(pos + ws[0].length);
      if (!isAlnum(after[0])) break;
      pos += ws[0].length;
    }
  }
  return words;
}

/**
 * Parses every @mention token in `content` against the idea's roster.
 *
 * Matching order:
 *   1. Greedy longest whole `full_name` match (longest word-count, then
 *      char length, wins) — design §4.3.
 *   2. Nick amendment 2: if that finds nothing AND no multi-word match was
 *      even attempted beyond the single word (i.e. the full-name loop is
 *      exhausted), fall back to a unique first-name match (first
 *      whitespace-separated word of a roster member's full_name). Zero
 *      matches -> unknown_name, >=2 -> ambiguous_name.
 *   3. Otherwise -> unknown_name.
 *
 * Parses everywhere, including inside markdown/code spans (design §4.4) —
 * deliberately not fence-aware.
 */
export function parseMentionTokens(content: string, roster: RosterMember[]): ParsedMentionToken[] {
  const fullNameMap = new Map<string, string[]>(); // normalized full_name -> user_ids
  const firstNameMap = new Map<string, string[]>(); // normalized first word -> user_ids
  let maxWords = 1;

  for (const m of roster) {
    if (!m.full_name) continue;
    const trimmed = m.full_name.trim().replace(/\s+/g, " ");
    if (!trimmed) continue;

    const norm = normalizeName(trimmed);
    const bucket = fullNameMap.get(norm);
    if (bucket) bucket.push(m.user_id);
    else fullNameMap.set(norm, [m.user_id]);

    const words = trimmed.split(" ");
    if (words.length > maxWords) maxWords = words.length;

    const firstNorm = normalizeName(words[0]);
    const firstBucket = firstNameMap.get(firstNorm);
    if (firstBucket) firstBucket.push(m.user_id);
    else firstNameMap.set(firstNorm, [m.user_id]);
  }

  const results: ParsedMentionToken[] = [];

  for (let i = 0; i < content.length; i++) {
    if (content[i] !== "@") continue;
    if (i > 0 && isAlnum(content[i - 1])) continue; // email guard (design §4.2)

    const words = extractWords(content, i + 1, maxWords);
    if (words.length === 0) continue; // lone @ — silently ignored (design §4.4)

    // 1. Greedy longest full-name match, longest word-count first.
    let matchedAt = -1;
    let matchedIds: string[] | null = null;
    for (let k = words.length; k >= 1; k--) {
      const phraseWords = words.slice(0, k).map((w) => w.word);
      phraseWords[phraseWords.length - 1] = stripTrailingDot(phraseWords[phraseWords.length - 1]);
      const phrase = normalizeName(phraseWords.join(" "));
      const ids = fullNameMap.get(phrase);
      if (ids && ids.length > 0) {
        matchedAt = k;
        matchedIds = ids;
        break;
      }
    }

    if (matchedIds) {
      const end = words[matchedAt - 1].end;
      const rawToken = content.slice(i + 1, end);
      results.push(
        matchedIds.length === 1
          ? { token: rawToken, user_id: matchedIds[0] }
          : { token: rawToken, reason: "ambiguous_name" }
      );
      i = end - 1; // resume scan after the matched span
      continue;
    }

    // 2. Nick amendment 2: single-word first-name fallback.
    const firstWordRaw = stripTrailingDot(words[0].word);
    const firstIds = firstNameMap.get(normalizeName(firstWordRaw));
    if (firstIds && firstIds.length > 0) {
      results.push(
        firstIds.length === 1
          ? { token: firstWordRaw, user_id: firstIds[0] }
          : { token: firstWordRaw, reason: "ambiguous_name" }
      );
      i = words[0].end - 1;
      continue;
    }

    // 3. No match at all.
    results.push({ token: firstWordRaw, reason: "unknown_name" });
    i = words[0].end - 1;
  }

  return results;
}

// --- Resolution (design §5.3, binding A reason enum) ---------------------

const GENUINE_MISS_REASONS: ReadonlySet<UnresolvedReason> = new Set([
  "unknown_name",
  "ambiguous_name",
  "not_team_member",
  "step_task_unresolved",
]);

function buildWarning(genuineMisses: UnresolvedMention[]): string | undefined {
  if (genuineMisses.length === 0) return undefined;
  const parts = genuineMisses.map((u) => (u.token ? `"${u.token}"` : (u.user_id ?? "unknown")));
  const noun = genuineMisses.length === 1 ? "mention" : "mentions";
  return `${genuineMisses.length} ${noun} could not be matched to a notified team member: ${parts.join(", ")}.`;
}

export interface ResolveMentionsInput {
  content: string;
  mentionedUserIds?: string[];
  team: RosterMember[];
  /** ctx.userId AND ctx.ownerUserId — both are excluded as self-mentions. */
  selfIds: string[];
}

/**
 * Full resolution pipeline: parse @names from content, union with explicit
 * mentioned_user_ids, dedupe by user_id, then classify each survivor as
 * notified or unresolved (self / not_team_member / opted_out) — design §5.3.
 *
 * Explicit ids are processed before parsed-name ids so an id present via
 * both paths reports under the explicit (id-only) shape.
 */
export function resolveMentions(input: ResolveMentionsInput): MentionResolution {
  const { content, mentionedUserIds = [], team, selfIds } = input;
  const teamById = new Map(team.map((m) => [m.user_id, m]));

  const parsed = parseMentionTokens(content, team);

  const notified: ResolvedMention[] = [];
  const unresolved: UnresolvedMention[] = [];

  // unknown_name / ambiguous_name never carry a user_id — report directly,
  // deduped by (reason, normalized token).
  const seenUnresolvedTokens = new Set<string>();
  for (const p of parsed) {
    if (!p.reason) continue;
    const key = `${p.reason}:${normalizeName(p.token)}`;
    if (seenUnresolvedTokens.has(key)) continue;
    seenUnresolvedTokens.add(key);
    unresolved.push({ token: p.token, reason: p.reason });
  }

  // Union of resolved candidate user_ids: explicit ids ∪ parsed matches,
  // deduped by user_id (explicit wins for reporting — see doc comment).
  const seenUserIds = new Set<string>();
  const candidateIds: string[] = [];
  for (const id of mentionedUserIds) {
    if (!seenUserIds.has(id)) {
      seenUserIds.add(id);
      candidateIds.push(id);
    }
  }
  for (const p of parsed) {
    if (p.user_id && !seenUserIds.has(p.user_id)) {
      seenUserIds.add(p.user_id);
      candidateIds.push(p.user_id);
    }
  }

  for (const userId of candidateIds) {
    if (selfIds.includes(userId)) {
      unresolved.push({ user_id: userId, reason: "self" });
      continue;
    }
    const member = teamById.get(userId);
    if (!member) {
      unresolved.push({ user_id: userId, reason: "not_team_member" });
      continue;
    }
    if (member.notification_preferences?.task_mentions === false) {
      unresolved.push({ user_id: userId, reason: "opted_out" });
      continue;
    }
    notified.push({ user_id: userId, full_name: member.full_name });
  }

  const warning = buildWarning(unresolved.filter((u) => GENUINE_MISS_REASONS.has(u.reason)));
  return warning ? { notified, unresolved, warning } : { notified, unresolved };
}

// --- Step degrade path (design §6/§9) -------------------------------------

/** Cheap, roster-independent check for "does content look like it has an @mention". */
export function mightContainMention(content: string): boolean {
  return /(?:^|[^\p{L}\p{N}])@[\p{L}\p{N}]/u.test(content);
}

/**
 * Builds the `mentions` result for a step comment whose parent-task lookup
 * failed (design §6/§9): the comment still posts, but no mention can be
 * routed to a task, so every candidate is reported as step_task_unresolved
 * instead of being silently dropped.
 */
export function stepTaskUnresolvedMentions(
  content: string,
  mentionedUserIds: string[] = []
): MentionResolution {
  const unresolved: UnresolvedMention[] = mentionedUserIds.map((user_id) => ({
    user_id,
    reason: "step_task_unresolved" as const,
  }));
  if (mentionedUserIds.length === 0 && mightContainMention(content)) {
    unresolved.push({ reason: "step_task_unresolved" });
  }
  if (unresolved.length === 0) return { notified: [], unresolved: [] };
  return {
    notified: [],
    unresolved,
    warning: `Could not resolve this step's parent task, so ${unresolved.length === 1 ? "a mention" : "mentions"} could not be routed.`,
  };
}
