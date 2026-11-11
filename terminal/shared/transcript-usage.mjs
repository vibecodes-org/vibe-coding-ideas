// Reading Claude Code transcript lines into model-call counts (card ba37039b),
// and totalling the main window's OWN usage, the part no workflow step already
// took (card f2a563ca).
//
// Plain ES module with no dependencies: the helper's bridge, the backfill
// script and the tests all import it. Keep readCall in step with the awk in
// src/lib/step-cost/usage-command.ts.

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
  return { id: idm[1], model, input, read, write5m: Math.max(0, write - write1h), write1h, reported: num(u, "output_tokens"), len };
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

const HOUR_MS = 3_600_000;
const timestampOf = (line) => /"timestamp":"([^"]+)"/.exec(line)?.[1] ?? null;
const hourOf = (iso) => {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) ? new Date(Math.floor(t / HOUR_MS) * HOUR_MS).toISOString() : null;
};

/** The first complete 51-character claim token (ct_ + 48 hex) in s, as the awk's ctok() finds it. */
function claimTokenIn(s) {
  for (const m of s.matchAll(/ct_[0-9a-f]+/g)) if (m[0].length === 51) return m[0];
  return "";
}

function stepIdOfClaimResult(line) {
  try {
    const o = JSON.parse(line);
    const content = o?.message?.content;
    if (!Array.isArray(content)) return null;
    for (const b of content) {
      if (b?.type !== "tool_result") continue;
      const c = b.content;
      const text = typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => (p && p.type === "text" ? p.text : "")).join("") : "";
      const id = JSON.parse(text)?.step?.id;
      if (typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)) return id.toLowerCase();
    }
  } catch {
    /* not a claim result */
  }
  return null;
}

/**
 * Totals the main window's own model calls from one conversation transcript,
 * by hour and model: the share of each call that no workflow step took.
 *
 * A claim opens at the claim_next_step result line (a new vcu_ marker next to
 * a claim token) and closes at the first of: a main-window Bash call holding
 * its marker, or the accepted (no is_error) complete_step/fail_step result
 * carrying its token. This is the live rule in usage-command.ts. For each main
 * call, attributed = (claims open at that call that do close) / (all claims
 * open, including ones that never close); own = 1 - attributed, so step share
 * plus own share is every call, counted once. With no claim open, own = 1.
 *
 * Feed lines one at a time with push(), then call finish(). Sidechain (helper)
 * lines are never counted.
 */
export function createMainUsageScanner() {
  const open = new Map(); // marker -> claim { id, stepId, closed }
  const seen = new Set();
  const byToken = new Map(); // ct -> claims
  const pending = new Map(); // tool_use id -> ct
  const claims = [];
  const calls = new Map(); // msg id -> { call, hour, snapshot }
  let first = null;
  let last = null;

  return {
    push(line) {
      if (line.includes('"isSidechain":true')) return;
      const closes = [];
      const isAssistant = line.includes('"type":"assistant"');
      const ct = line.includes("ct_") ? claimTokenIn(line) : "";
      if (line.includes("vcu_")) {
        const isBash = isAssistant && line.includes('"name":"Bash"');
        const marks = new Set(line.match(/vcu_[0-9a-f]+/g));
        for (const k of marks) {
          if (!seen.has(k)) {
            seen.add(k);
            if (ct !== "") {
              const claim = { stepId: stepIdOfClaimResult(line), closed: false };
              claims.push(claim);
              open.set(k, claim);
              byToken.set(ct, [...(byToken.get(ct) ?? []), k]);
            }
          } else if (isBash && open.has(k)) {
            closes.push(k);
          }
        }
      }
      if (isAssistant && ct !== "" && /"name":"[^"]*__(complete|fail)_step"/.test(line)) {
        const m = /"id":"(toolu_[A-Za-z0-9_]+)"/.exec(line);
        if (m) pending.set(m[1], ct);
      }
      const tm = /"tool_use_id":"([A-Za-z0-9_]+)"/.exec(line);
      if (tm && pending.has(tm[1])) {
        if (!line.includes('"is_error":true')) for (const k of byToken.get(pending.get(tm[1])) ?? []) if (open.has(k)) closes.push(k);
        pending.delete(tm[1]);
      }
      if (isAssistant) {
        const c = readCall(line);
        if (c) {
          const prev = calls.get(c.id);
          if (prev) {
            prev.call = {
              ...c,
              reported: Math.max(c.reported, prev.call.reported),
              len: prev.call.len + c.len,
            };
          } else {
            const at = timestampOf(line);
            calls.set(c.id, { call: c, hour: hourOf(at), at, snapshot: [...open.values()] });
          }
        }
      }
      for (const k of closes) {
        const claim = open.get(k);
        if (claim) claim.closed = true;
        open.delete(k);
      }
    },

    finish() {
      const hours = new Map();
      for (const { call: c, hour, at, snapshot } of calls.values()) {
        if (!hour) continue;
        const attributed = snapshot.length ? snapshot.filter((cl) => cl.closed).length / snapshot.length : 0;
        const w = 1 - attributed;
        if (at && (!first || at < first)) first = at;
        if (at && (!last || at > last)) last = at;
        if (w <= 0) continue;
        const byModel = hours.get(hour) ?? new Map();
        const est = Math.floor(c.len / 3.5 + 0.5);
        const m = byModel.get(c.model) ?? { calls: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_5m_tokens: 0, cache_write_1h_tokens: 0 };
        m.calls += w;
        m.input_tokens += c.input * w;
        m.output_tokens += Math.max(c.reported, est) * w;
        m.cache_read_tokens += c.read * w;
        m.cache_write_5m_tokens += c.write5m * w;
        m.cache_write_1h_tokens += c.write1h * w;
        byModel.set(c.model, m);
        hours.set(hour, byModel);
      }
      const rows = [];
      for (const [hour, byModel] of [...hours].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        for (const [model, m] of byModel) {
          const r = Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round(v)]));
          if (r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_write_5m_tokens + r.cache_write_1h_tokens === 0) continue;
          rows.push({ hour, model, ...r });
        }
      }
      const stepIds = [...new Set(claims.filter((cl) => cl.closed && cl.stepId).map((cl) => cl.stepId))];
      return { hours: rows, stepIds, firstCallAt: first, lastCallAt: last };
    },
  };
}

/** Same as createMainUsageScanner over an iterable of lines. */
export function mainWindowOwnUsage(lines) {
  const s = createMainUsageScanner();
  for (const line of lines) s.push(line);
  return s.finish();
}
