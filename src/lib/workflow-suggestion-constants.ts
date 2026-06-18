/**
 * Client-safe constants for the mismatched-workflow suggestion feature.
 *
 * This module deliberately has NO server-only imports (no AI SDK, no Supabase
 * service client) so it can be imported from `"use client"` components without
 * pulling the AI stack into the browser bundle. `src/lib/workflow-matching.ts`
 * (server-only) re-exports from here, so there is a single source of truth.
 */

/**
 * How long a `workflow_suggestions.adjudication_started_at` marker is treated as
 * "in flight". While the marker is set AND within this window, agent pickup
 * (get_task / claim_next_step) reports the suggestion as still being checked and
 * the UI shows the "checking fit…" micro-state. Once older than this, the marker
 * is stale and the suggestion is surfaced as a normal blocking suggestion.
 */
export const WORKFLOW_AI_ADJUDICATION_TIMEOUT_MS = 60_000;
