// Terminal session token minting — SLICE 2 (auth + ownership).
//
// Mints the short-lived, owner-bound tokens the in-app terminal relay requires.
// The authenticated VibeCodes user gets a token PER LEG (browser + bridge) for one
// session id; both carry the same `sub` so the relay can prove the two legs belong
// to the same human and refuse a cross-user attach.
//
// Signing lives in the SHARED module (terminal/shared/session-token.mjs) so the
// exact same code verifies on the Cloudflare relay. The secret comes from the
// TERMINAL_SESSION_SECRET env var — never hard-coded.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isAuthCheckUnavailable } from "@/lib/supabase/auth-error";
import { logger } from "@/lib/logger";
// One shared implementation of the token scheme — also imported by the relay.
import { mintSessionTokens, mintHelperToken } from "../../../../../terminal/shared/session-token.mjs";
import {
  getServerTerminalSessionCap,
  getTerminalMintRateLimit,
  capRefusalMessage,
  RATE_LIMIT_MESSAGE,
  CAP_REFUSAL_CODE,
  RATE_LIMIT_CODE,
  DAILY_RELAY_BUDGET_CODE,
  DAILY_RELAY_BUDGET_MESSAGE,
  CONVERSATION_LIVE_CODE,
  CONVERSATION_LIVE_MESSAGE,
} from "@/lib/terminal/session-cap";
import {
  computeSessionExpiresAt,
  decideCap,
  decideRateLimit,
  rateLimitWindowStart,
} from "@/lib/terminal/session-registry";
import { reapExpiredSessions } from "@/lib/terminal/session-reap";
import { normalizeDisplayNameInput } from "@/lib/terminal/display-name";
import {
  getTerminalDailyBudget,
  getTerminalBudgetSoftPct,
  getAssumedRequestsPerSession,
  estimateDailyRelayRequestSpend,
  decideRelayBudget,
  utcDayStart,
} from "@/lib/terminal/relay-budget";
import { getPlatformTerminalModelDefault } from "@/lib/terminal/platform-terminal-model";
import { resolveEffectiveTerminalModel } from "@/lib/terminal/model-resolution";
import { AUTO_PERMISSION_MODE } from "@/lib/terminal/auto-accept-mode";

// Pin the runtime: this handler mints per-request, auth-bound tokens and must never
// be statically optimized or flipped to the Edge runtime. The pin stays as hygiene,
// but NOTE: the "No response is returned from route handler" 500s this route suffered
// (card b6e5c728) were NOT a runtime-flip problem. Root cause: mcp-handler@1.0.7's
// transport (@hono/node-server getRequestListener) replaced globalThis.Response when
// the MCP route loaded in the same function instance, so Next's `res instanceof
// Response` check rejected this route's NextResponse.json() — fixed by bumping
// mcp-handler to 1.1.0 (web-standard transport, no global mutation).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  ideaId: z.string().uuid(),
  // Multi-session stage 3 (C1/C4): carried through to the terminal_sessions
  // registry row so "My sessions" can show a task-scoped label. Both optional
  // — a board-level launch (toolbar "In the browser") carries neither.
  taskId: z.string().uuid().optional(),
  taskTitle: z.string().trim().min(1).max(500).optional(),
  // Rename that survives resume (card 3bf262ac): only ever set by the resume
  // flow — buildResumePayload/mintAndDeliver forward a previously-renamed
  // ended row's name into its fresh mint, the same way taskId/taskTitle
  // already ride resume. There is no rename UI before a session exists, so
  // this is never user-typed at mint time itself. Bounded generously above
  // the real 100-code-point limit (surrogate-pair emoji can double a
  // string's UTF-16 length without doubling its code-point count) —
  // `normalizeDisplayNameInput` enforces the actual limit below.
  displayName: z.string().max(1000).optional(),
  // Card 0301fe8e (duplicate-conversation guard): the claude conversation an
  // exact-conversation Resume is about to `claude --resume`. Sent ONLY by the
  // resume flow (use-terminal-session.ts forwards the carried payload's
  // `resumeId`); a fresh launch and the legacy `--continue` resume carry
  // nothing. Used twice below: to refuse a resume whose conversation this
  // user already has LIVE, and to stamp the new row's `claude_session_id` at
  // insert time instead of waiting for the bridge to announce it.
  resumeId: z.string().uuid().optional(),
});

export async function POST(req: Request) {
  try {
    const secret = process.env.TERMINAL_SESSION_SECRET;
    if (!secret) {
      logger.error("Terminal session mint failed: TERMINAL_SESSION_SECRET not configured");
      return NextResponse.json({ error: "Terminal sessions are not configured" }, { status: 503 });
    }

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    // Card 42453a7d: a FAILED auth check is not the same as "no session".
    // getUser() returns a null user for both, and answering 401 for the former
    // tells a perfectly logged-in user they're logged out (and, client-side,
    // surfaces "Couldn't start a terminal session — Not authenticated"). 503
    // says "ask again", which is the truth. See auth-error.ts for the evidence.
    if (!user && isAuthCheckUnavailable(authError)) {
      logger.error("Terminal session mint: auth check unavailable", {
        name: authError?.name,
        status: authError?.status,
        error: authError?.message,
      });
      return NextResponse.json(
        { error: "Couldn't verify your login just now — please try again" },
        { status: 503 },
      );
    }
    if (!user) {
      // Card 42453a7d (2026-08-19): this refusal used to be completely silent,
      // so when SOMETHING retried a mint every ~30 minutes all night (15
      // unauthenticated attempts, 18-19 Aug, each one an isolated request with
      // no page load or list poll around it) there was nothing in the logs to
      // attribute it to. Log just enough to identify the caller next time —
      // never cookie values or token material, and only the idea id from the
      // body, which is the one field that tells us WHICH board's page is doing
      // it. `hasAuthCookie` separates the two very different causes: absent =
      // a client with no session at all, present = a session that expired or
      // was rotated away under a long-lived page.
      const probe = (await req.json().catch(() => null)) as { ideaId?: unknown } | null;
      logger.warn("Terminal session mint refused: not authenticated", {
        userAgent: req.headers.get("user-agent"),
        referer: req.headers.get("referer"),
        origin: req.headers.get("origin"),
        hasAuthCookie: /(?:^|;\s*)sb-[^=;]*auth-token/.test(req.headers.get("cookie") ?? ""),
        ideaId: typeof probe?.ideaId === "string" ? probe.ideaId : null,
        // Answered-but-no: WHICH no. "Auth session missing" (no cookie at all)
        // and "Invalid Refresh Token: Already Used" (a rotation race between
        // this user's several open tabs) are different bugs with the same
        // 401, and only this field tells them apart.
        authError: authError?.message ?? null,
        authErrorName: authError?.name ?? null,
      });
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const { ideaId, taskId, taskTitle, displayName, resumeId } = parsed.data;

    // Only a member of the idea (author or collaborator) may open a terminal on it.
    const { data: idea } = await supabase
      .from("ideas")
      .select("id, author_id")
      .eq("id", ideaId)
      .maybeSingle();
    if (!idea) {
      return NextResponse.json({ error: "Idea not found" }, { status: 404 });
    }
    if (idea.author_id !== user.id) {
      const { data: collab } = await supabase
        .from("collaborators")
        .select("id")
        .eq("idea_id", ideaId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!collab) {
        return NextResponse.json(
          { error: "Only team members can open a terminal for this idea" },
          { status: 403 },
        );
      }
    }

    // ── task/idea correctness guard (cross-board resume bug 62e57071) ───────
    // `terminal_sessions.task_id` carries no FK to `idea_id` (see the
    // 00141_terminal_sessions migration), so nothing at the DB layer stops a
    // client from minting a session that claims a task from one board while
    // registering it under a DIFFERENT idea_id — exactly the shape a
    // mis-filed Recent-row resume produces client-side (see chooser-data.ts
    // / terminal-dock.tsx for the client-side fix). This is the server-side
    // backstop: reject only a task_id we can SEE and KNOW belongs to another
    // idea. A task_id that resolves to no row at all is let through
    // deliberately — with no FK, a task deleted between page load and this
    // click is a benign race, not a boundary this guard exists to police;
    // only a CONFIRMED cross-idea mismatch is rejected.
    if (taskId) {
      const { data: task, error: taskLookupErr } = await supabase
        .from("board_tasks")
        .select("id, idea_id")
        .eq("id", taskId)
        .maybeSingle();
      if (taskLookupErr) {
        // Best-effort, same fail-open posture as the budget/reap reads below
        // — a transient read error must never itself block a legitimate
        // mint.
        logger.error("Terminal session mint: task lookup failed", {
          error: taskLookupErr.message,
          taskId,
          ideaId,
        });
      } else if (task && task.idea_id !== ideaId) {
        logger.warn("Terminal session mint refused: task belongs to a different board", {
          userId: user.id,
          ideaId,
          taskId,
          taskIdeaId: task.idea_id,
        });
        return NextResponse.json({ error: "That task doesn't belong to this board" }, { status: 400 });
      }
    }

    const nowMs = Date.now();

    // ── (a-1) MITIGATION 3 — ACCOUNT-WIDE daily relay budget breaker. Gated
    // BEFORE any per-user bookkeeping: if the whole account is already near
    // Cloudflare's free-tier daily cap there's no point doing the per-user
    // reap/cap/rate-limit work below. Zero-cost (no Cloudflare API call) — a
    // conservative estimate from data we already record; see relay-budget.ts
    // for the estimator's documented assumptions. Existing sessions are
    // completely unaffected; this only refuses NEW mints. Fails OPEN on a
    // read error (matches every other best-effort registry read in this
    // route) — a transient DB hiccup must never itself block every new
    // terminal session account-wide.
    const dailyBudget = getTerminalDailyBudget();
    const softPct = getTerminalBudgetSoftPct();
    const requestsPerSession = getAssumedRequestsPerSession();
    const { count: sessionsToday, error: budgetErr } = await supabase
      .from("terminal_sessions")
      .select("id", { count: "exact", head: true })
      .gte("created_at", utcDayStart(nowMs));
    if (budgetErr) {
      logger.error("Terminal relay budget read failed", { error: budgetErr.message });
    }
    const estimatedSpend = estimateDailyRelayRequestSpend(sessionsToday ?? 0, requestsPerSession);
    const budgetDecision = decideRelayBudget(estimatedSpend, dailyBudget, softPct);
    if (!budgetDecision.ok) {
      logger.warn("Terminal relay daily budget breaker tripped — refusing new mint", {
        estimatedSpend: budgetDecision.estimatedSpend,
        dailyBudget: budgetDecision.dailyBudget,
        softLimit: budgetDecision.softLimit,
        sessionsToday: sessionsToday ?? 0,
        requestsPerSession,
      });
      return NextResponse.json(
        { error: DAILY_RELAY_BUDGET_MESSAGE, code: DAILY_RELAY_BUDGET_CODE },
        { status: 429 },
      );
    }

    // ── (a) REAP: mark this user's own expired-but-still-"active" rows ended
    // BEFORE trusting any count below (R2 mitigation) — the registry is
    // best-effort and can drift from the relay (e.g. a max-duration close the
    // registry was never told about), so an unreaped stale row would wrongly
    // count against the cap/rate-limit forever. Shared with the reattach and
    // list routes (session-reap.ts, rework 8) so every reaped row's ended_at
    // is backdated to its own expires_at the same way everywhere.
    const { activeBefore, reapedIds } = await reapExpiredSessions(
      supabase,
      user.id,
      nowMs,
      "Terminal session mint",
    );
    const activeCount = activeBefore - reapedIds.length;

    // ── (a.5) DUPLICATE-CONVERSATION GUARD (card 0301fe8e) ──────────────────
    // A Resume targeting a claude conversation this user ALREADY has a live
    // session on must never spawn a second `claude --resume <id>` — two
    // Claude Code processes on one transcript is the wedge Nick hit on
    // 2026-08-25. The chooser hides such rows client-side (chooser-data.ts);
    // this is the server backstop for a second tab, a stale list, or a click
    // that beat the registry refresh. Runs AFTER the reap so an expired row
    // never blocks a legitimate resume, and reads `claude_session_id` — which
    // the insert below now stamps from `resumeId` at mint time, closing the
    // window in which a freshly-resumed row carried null until the bridge
    // announced its id. Best-effort read: an error fails OPEN (logged), the
    // same posture as the task-lookup / cap / budget reads around it.
    if (resumeId) {
      const { data: liveRow, error: liveErr } = await supabase
        .from("terminal_sessions")
        .select("sid, idea_id")
        .eq("user_id", user.id)
        .eq("status", "active")
        .eq("claude_session_id", resumeId)
        .limit(1)
        .maybeSingle();
      if (liveErr) {
        logger.error("Terminal session mint: live-conversation lookup failed", {
          error: liveErr.message,
          userId: user.id,
          resumeId,
        });
      } else if (liveRow) {
        logger.warn("Terminal session mint refused: conversation already live", {
          userId: user.id,
          ideaId,
          resumeId,
          liveSid: liveRow.sid,
        });
        return NextResponse.json(
          {
            error: CONVERSATION_LIVE_MESSAGE,
            code: CONVERSATION_LIVE_CODE,
            liveSid: liveRow.sid,
            liveIdeaId: liveRow.idea_id,
          },
          { status: 409 },
        );
      }
    }

    // ── (b) CAP (E1) — refuse before minting anything. ──────────────────────
    const cap = getServerTerminalSessionCap();
    const capDecision = decideCap(activeCount, cap);
    if (!capDecision.ok) {
      const { data: activeSummaries } = await supabase
        .from("terminal_sessions")
        .select("sid, idea_id, task_title, created_at")
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("created_at", { ascending: false });
      return NextResponse.json(
        {
          error: capRefusalMessage(cap),
          code: CAP_REFUSAL_CODE,
          cap,
          active: (activeSummaries ?? []).map((row) => ({
            sid: row.sid,
            idea_id: row.idea_id,
            task_title: row.task_title,
            created_at: row.created_at,
          })),
        },
        { status: 409 },
      );
    }

    // ── (c) RATE LIMIT (E2) — distinct state, distinct copy (binding note: NO
    // mention of ending a session — this refusal isn't about the cap). ──────
    const rateLimit = getTerminalMintRateLimit();
    const { count: recentCount, error: recentErr } = await supabase
      .from("terminal_sessions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", rateLimitWindowStart(nowMs));
    if (recentErr) {
      logger.error("Terminal session rate-limit read failed", { error: recentErr.message });
    }
    const rateDecision = decideRateLimit(recentCount ?? 0, rateLimit);
    if (!rateDecision.ok) {
      return NextResponse.json({ error: RATE_LIMIT_MESSAGE, code: RATE_LIMIT_CODE }, { status: 429 });
    }

    // ── (c.5) EFFECTIVE MODEL (task c4ca2d95, "Terminal starting model") ────
    // Resolved here, once, right before mint — user override -> platform
    // default -> omit (resolveEffectiveTerminalModel; no seed step, binding
    // approval-gate note). Every read is best-effort and never blocks a
    // launch (AC-2): a failed/errored read degrades to "no override"/"no
    // platform default" via logger.warn, exactly like getPlatformTerminalModelDefault's
    // own posture. The client threads the result into the FRESH-launch deep
    // link only — a resume never carries it (see use-terminal-session.ts).
    let userTerminalModel: string | null = null;
    // Task d3de150c ("Terminal mode") — read alongside terminal_model in the
    // SAME row fetch (one extra column, not a second query). Best-effort,
    // same posture as terminal_model above: a failed/errored read degrades
    // to "off" (AC-2 equivalent: never block a launch over this), never
    // throws, never blocks the mint.
    let userAutoAccept = false;
    try {
      const { data: userRow, error: userRowErr } = await supabase
        .from("users")
        .select("terminal_model, terminal_auto_accept")
        .eq("id", user.id)
        .maybeSingle();
      if (userRowErr) {
        logger.warn("Terminal session mint: failed to read terminal_model/terminal_auto_accept — omitting user overrides", {
          error: userRowErr.message,
          userId: user.id,
        });
      } else {
        userTerminalModel = userRow?.terminal_model ?? null;
        userAutoAccept = userRow?.terminal_auto_accept ?? false;
      }
    } catch (err) {
      logger.warn("Terminal session mint: unexpected error reading terminal_model/terminal_auto_accept — omitting user overrides", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    const platformTerminalModel = await getPlatformTerminalModelDefault(supabase);
    const effectiveModel = resolveEffectiveTerminalModel({
      userValue: userTerminalModel,
      platformValue: platformTerminalModel,
    });
    // Task d3de150c: no platform-wide default exists for this by design —
    // the ONLY input is the user's own row. Resolves to the literal
    // "auto" or undefined (never any other string) so the deep link
    // and the mint response can never carry a forbidden value.
    const effectivePermissionMode = userAutoAccept ? AUTO_PERMISSION_MODE : undefined;

    // ── (c.7) CONCURRENT-SESSION ISOLATION ──────────────────────────────────
    // Does this user ALREADY have a live in-app session on this board? If so
    // the new one must not share its project folder — the client fires the
    // launch with `claude --worktree` (an isolated working copy) when this is
    // true. The FIRST session on a board works in the main folder itself:
    // isolating every launch unconditionally (the state of play after #219)
    // put even a lone session in a throwaway `.claude/worktrees/<id>` copy,
    // whose `pwd` then got recorded as the project folder. Counted BEFORE the
    // insert below, so this row never counts itself. Best-effort read; on an
    // error the SAFE default is to isolate (two sessions silently sharing a
    // folder clobber each other's files — a needless worktree merely confuses).
    let isolate = false;
    {
      const { count: siblingCount, error: siblingErr } = await supabase
        .from("terminal_sessions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("idea_id", ideaId)
        .eq("status", "active");
      if (siblingErr) {
        logger.warn("Terminal session mint: live-sibling count failed — defaulting to isolate", {
          error: siblingErr.message,
          userId: user.id,
          ideaId,
        });
        isolate = true;
      } else {
        isolate = (siblingCount ?? 0) > 0;
      }
    }

    // ── (d) MINT + register. ────────────────────────────────────────────────
    // The bridge/browser pair (per-launch, random sid) and the helper's OWN
    // standing control-connection credential (card cc74a067 — reserved,
    // per-owner sid, see helperSessionId) are minted together so the SAME
    // click that starts a terminal also (re)establishes the helper's control
    // connection to the relay — see terminal/helper/main.js's handleLaunchUrl.
    const [tokens, helperToken] = await Promise.all([
      mintSessionTokens({ sub: user.id, idea: ideaId, secret }),
      mintHelperToken({ sub: user.id, secret }),
    ]);

    const { error: insertErr } = await supabase.from("terminal_sessions").insert({
      sid: tokens.sid,
      user_id: user.id,
      idea_id: ideaId,
      task_id: taskId ?? null,
      task_title: taskTitle ?? null,
      display_name: displayName !== undefined ? normalizeDisplayNameInput(displayName) : null,
      // Card 0301fe8e: an exact-conversation Resume knows its conversation id
      // from the very first instant — stamp it now so the duplicate guard
      // above (and the chooser's live-conversation filter) see it immediately,
      // rather than only once the bridge's announcement PATCH lands seconds
      // later. The bridge's later announcement writes the same id back over
      // it (see session/[sid]/route.ts) — harmless, and still authoritative
      // for the fresh-launch case, where this stays null.
      claude_session_id: resumeId ?? null,
      status: "active",
      expires_at: computeSessionExpiresAt(nowMs),
    });
    if (insertErr) {
      // The registry is best-effort (R2) — never fail an otherwise-successful
      // mint just because its bookkeeping row didn't write; the relay session
      // is real either way. My-sessions / the cap count simply undercount this
      // one session until the next reap or mint self-corrects.
      logger.error("Terminal session registry insert failed", {
        error: insertErr.message,
        sid: tokens.sid,
      });
    }

    logger.info("Minted terminal session tokens", {
      userId: user.id,
      ideaId,
      sid: tokens.sid,
      exp: tokens.exp,
    });

    // Return both leg tokens + the session id. The browser token is for the in-app
    // panel; the bridge token is handed to the local helper (slice 3 wiring).
    // helperToken rides the SAME deep link (card cc74a067) so a same-machine
    // launch also (re)establishes the helper's standing control connection —
    // an already-connected helper treats a redundant one as a no-op.
    return NextResponse.json({
      sessionId: tokens.sid,
      ideaId: tokens.idea,
      expiresAt: tokens.exp,
      browserToken: tokens.browser,
      bridgeToken: tokens.bridge,
      helperToken,
      // Task c4ca2d95: resolved starting model for a FRESH launch only — the
      // client must never thread this into a resume/resumeId deep link (AC-8).
      // Omitted (undefined, dropped by JSON.stringify) when nothing should be
      // passed at all — the fresh-launch call site treats absence the same
      // as an explicit undefined.
      model: effectiveModel,
      // Task d3de150c ("Terminal mode") — set ONLY when this user's own
      // terminal_auto_accept preference is on, for a FRESH launch only; the
      // client must never thread this into a resume/resumeId deep link
      // (mirrors AC-8 for `model` above). Omitted (undefined, dropped by
      // JSON.stringify) when off — byte-identical to today's response shape.
      permissionMode: effectivePermissionMode,
      // Concurrent-session isolation (see (c.7) above): true when another of
      // this user's sessions is already live on this board, so the client
      // fires this FRESH launch with `claude --worktree`. Always present (a
      // plain boolean) — the client treats anything but `true` as "work in
      // the main folder". Never threaded into a resume link: Claude Code's
      // own `--resume` reopens whatever worktree the session started in.
      isolate,
    });
  } catch (err) {
    logger.error("Terminal session mint error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "An unexpected error occurred" }, { status: 500 });
  }
}
