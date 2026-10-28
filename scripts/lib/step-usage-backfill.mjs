// Step cost backfill — pure logic (card ba37039b).
//
// Works out what past workflow step attempts cost from the Claude Code
// transcripts still on disk, with the same rules as the live usage command
// (src/lib/step-cost/usage-command.ts): an attempt's cost is the session's
// own model calls from the claim_next_step result up to the complete_step /
// fail_step call that closed it, plus the calls of every subagent the session
// launched in between (up to that moment). The claim and the completion are
// paired by their claim token, so nothing is guessed from timing.
//
// Steps run side by side (card 5e654dd1, stage 16): each of the session's own
// calls is split equally across the attempts open at that line (claimed and
// not yet completed, including claims that never finished), as the live
// command does. Subagent calls count in full.
//
// Session share only (stage 3 of card 1117ac6b): with `sessionShareOnly`, no
// subagent lines are read and each attempt is marked `adds_to_existing`, so the
// import stores it even on a step that already has a cost (a helper-only
// import left the claiming session's share out).
//
// Input/cache counts are exact; output is estimated from the length of what
// the model wrote, exactly as the live command's awk does it.

const TOOL_SUFFIX = /__(claim_next_step|complete_step|fail_step)$/;

/** Last `"key":<digits>` in s, as the awk's num() reads it (first match). */
function num(s, key) {
  const m = new RegExp(`"${key}":([0-9]+)`).exec(s);
  return m ? Number(m[1]) : 0;
}

/**
 * One transcript line → one model call's counts, or null if the line isn't
 * an assistant call. A port of the live command's awk, line for line.
 */
export function readCall(line) {
  if (!line.includes('"type":"assistant"')) return null;
  const idm = /"id":"(msg_[A-Za-z0-9_]+)"/.exec(line);
  if (!idm) return null;
  const at = line.lastIndexOf('"usage":{');
  if (at < 0) return null;
  const u = line.slice(at);
  let model = /"model":"([^"]+)"/.exec(line)?.[1] ?? "unknown";
  const input = num(u, "input_tokens");
  const read = num(u, "cache_read_input_tokens");
  const write = num(u, "cache_creation_input_tokens");
  const write1h = num(u, "ephemeral_1h_input_tokens");
  if (/haiku-5-5/.test(model) && input + read + write > 100000) model += "+long";
  let len = 0;
  const s = line.indexOf('"content":[');
  const e = line.indexOf(',"stop_reason":');
  if (s >= 0 && e > s) {
    const seg = line
      .slice(s + 11, e)
      .replace(/"signature":"[^"]*"/g, "")
      .replace(/"(type|id|name|caller|container)":("[^"]*"|null|\{[^{}]*\})/g, "");
    len = Buffer.byteLength(seg, "utf8");
  }
  return { id: idm[1], model, input, read, write5m: write - write1h, write1h, reported: num(u, "output_tokens"), len };
}

/**
 * Totals model calls the way the live command does: one entry per model.
 * weights[i] (default 1) is the share of line i's call that belongs to this
 * step, taken from the first line of each call.
 */
export function totalCalls(lines, weights = []) {
  const calls = new Map();
  for (const [i, line] of lines.entries()) {
    const c = readCall(line);
    if (!c) continue;
    const prev = calls.get(c.id);
    calls.set(c.id, {
      ...c,
      weight: prev?.weight ?? weights[i] ?? 1,
      reported: Math.max(c.reported, prev?.reported ?? 0),
      len: (prev?.len ?? 0) + c.len,
    });
  }
  const byModel = new Map();
  for (const c of calls.values()) {
    const est = Math.floor(c.len / 3.5 + 0.5);
    const m = byModel.get(c.model) ?? {
      model: c.model, calls: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_5m_tokens: 0, cache_write_1h_tokens: 0,
    };
    const w = c.weight;
    m.calls += w;
    m.input_tokens += c.input * w;
    m.output_tokens += Math.max(c.reported, est) * w;
    m.cache_read_tokens += c.read * w;
    m.cache_write_5m_tokens += c.write5m * w;
    m.cache_write_1h_tokens += c.write1h * w;
    byModel.set(c.model, m);
  }
  const round = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, typeof v === "number" ? Math.round(v) : v]));
  return [...byModel.values()].map(round);
}

function resultText(block) {
  const c = block.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (p && p.type === "text" ? p.text : "")).join("");
  return "";
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const timestampOf = (line) => /"timestamp":"([^"]+)"/.exec(line)?.[1] ?? null;

/** The nearest timestamp at or before `index`, looking back at most 200 lines. */
function nearestEarlierTimestamp(lines, index) {
  for (let i = index; i >= 0 && i > index - 200; i--) {
    const t = timestampOf(lines[i]);
    if (t) return t;
  }
  return null;
}

/**
 * Finds every finished step attempt in one session transcript.
 * Returns [{ stepId, outcome, endedAt, from, to, agentIds }] where from/to are
 * line indexes: the session's calls after `from` up to and including `to`.
 */
export function findAttempts(lines) {
  return scanAttempts(lines).done;
}

/** The finished attempts, plus the claims still open at the end of the transcript. */
function scanAttempts(lines) {
  const tools = new Map(); // tool_use id -> { name, input, index }
  const open = new Map(); // claim token -> attempt
  let latest = null; // the attempt most recently claimed and still open
  const done = [];
  lines.forEach((line, index) => {
    if (!line.includes('"tool_use"') && !line.includes('"tool_result"')) return;
    const o = parseJson(line);
    const content = o?.message?.content;
    if (!Array.isArray(content) || o.isSidechain) return;
    for (const b of content) {
      if (b?.type === "tool_use") {
        tools.set(b.id, { name: String(b.name ?? ""), input: b.input ?? {}, index });
        continue;
      }
      if (b?.type !== "tool_result") continue;
      const use = tools.get(b.tool_use_id);
      if (!use || b.is_error) continue;
      if (use.name === "Agent" || use.name === "Task") {
        const agentId = o.toolUseResult?.agentId ?? /agentId: ([A-Za-z0-9_-]+)/.exec(resultText(b))?.[1];
        if (agentId && latest) latest.agentIds.add(agentId);
        continue;
      }
      const kind = TOOL_SUFFIX.exec(use.name)?.[1];
      if (!kind) continue;
      const result = parseJson(resultText(b));
      if (kind === "claim_next_step") {
        if (result && result.done === false && result.step?.id && result.claim_token) {
          latest = { stepId: result.step.id, from: index, agentIds: new Set() };
          open.set(result.claim_token, latest);
        }
        continue;
      }
      // complete_step / fail_step: an error comes back as text, not as the step.
      const attempt = open.get(use.input.claim_token);
      if (!attempt || !result?.step) continue;
      open.delete(use.input.claim_token);
      if (latest === attempt) latest = null;
      const outcome =
        kind === "fail_step" ? "failed" : result.step.status === "awaiting_approval" ? "awaiting_approval" : "completed";
      done.push({
        stepId: attempt.stepId,
        outcome,
        endedAt: o.timestamp ?? timestampOf(line) ?? nearestEarlierTimestamp(lines, index),
        from: attempt.from,
        to: use.index,
        agentIds: [...attempt.agentIds],
      });
    }
  });
  return { done, unfinished: [...open.values()] };
}

/**
 * Every finished attempt in one session, costed. readAgent(agentId) returns
 * that subagent's transcript lines, or null if it's gone. An attempt whose
 * subagent transcript is gone is skipped rather than under-counted.
 * With sessionShareOnly, only the session's own calls count and readAgent is never called.
 */
export function backfillSession(lines, readAgent, { sessionShareOnly = false } = {}) {
  const attempts = [];
  let skipped = 0;
  const { done, unfinished } = scanAttempts(lines);
  const spans = [...done.map((a) => [a.from, a.to]), ...unfinished.map((a) => [a.from, Infinity])];
  const share = (i) => 1 / Math.max(1, spans.filter(([from, to]) => from < i && i <= to).length);
  for (const a of done) {
    const own = [];
    const weights = [];
    for (let i = a.from + 1; i <= a.to; i++) {
      if (lines[i].includes('"isSidechain":true')) continue;
      own.push(lines[i]);
      weights.push(share(i));
    }
    const agentLines = [];
    let missing = false;
    for (const id of sessionShareOnly ? [] : a.agentIds) {
      const agent = readAgent(id);
      if (!agent) {
        missing = true;
        break;
      }
      // Only what the subagent did before the step closed: a later SendMessage isn't this step's.
      agentLines.push(...agent.filter((l) => (timestampOf(l) ?? "") <= a.endedAt));
    }
    const models = missing ? [] : totalCalls([...own, ...agentLines], weights);
    if (missing || models.length === 0 || !a.endedAt) {
      skipped++;
      continue;
    }
    attempts.push({
      step_id: a.stepId,
      outcome: a.outcome,
      ended_at: a.endedAt,
      models,
      output_estimated: true,
      ...(sessionShareOnly ? { adds_to_existing: true } : {}),
    });
  }
  return { attempts, skipped };
}
