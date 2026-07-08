# Recommendation — Claude model tiering for VibeCodes workflows

**Spike card:** Technical Spike — Claude model tiering ("Investigate Claude usages").
**Step:** 3 of 4 — Write Recommendation. **Author:** full-stack persona.
**Status:** Decision-grade. Next step is human approval (Step 4).

**Inputs this builds on (do not re-read in full):**
- **Step 1 — Define Research Questions:** the brief and success criteria (can we tier
  models to cut cost/usage without hurting quality; what is the concrete introduction
  mechanism; who actually saves).
- **Step 2 — Research & Prototype:** findings + the prototype at
  [`docs/spikes/claude-model-tiering-prototype.md`](./claude-model-tiering-prototype.md).
  Key Step 2 conclusions carried forward: the two independent levers (orchestrator
  model vs. subagent `model:`), the launch-bootstrap caveats, and risks **D1–D4**.

This document **corrects one Step 2 framing** (the mechanism is server-side data in the
MCP response, not the launch deep-link) and **adds Anthropic's own measured validation**.

---

## 1. Recommendation (go / no-go)

### GO — Path A now. Treat Path B (server-side CMA) as a validated strategic follow-up. Ship the Haiku-matching quick win independently.

**Preferred approach: Path A — per-step `model` hint in the workflow data returned by
`claim_next_step`.** Add a recommended model to each workflow step / persona role; the
orchestrator (the user's Claude Code) reads it and spawns that step's persona subagent
on the named model. Fable/Opus stays on the orchestrator; Sonnet does implementation;
Haiku does mechanical steps.

**Why Path A wins as the first move:**

1. **It is on-brand for the card.** The task is "Investigate Claude **usages**." Path A
   makes each user's Claude subscription / API budget stretch **~2.5× further** (Anthropic's
   own measured figure, §3) before hitting rate/usage limits — a direct, visible user
   benefit that is exactly what "usages" points at.
2. **The mechanism already exists — we're adding one field.** `claim_next_step`
   (`mcp-server/src/tools/workflows.ts`) already returns `agent_role`, `bot_id`, the
   `available_agents` roster, and a **mandatory** instruction to *"SPAWN a fresh subagent
   whose system prompt IS that persona prompt"* per step (lines 729–738). The tiering lever
   Step 2 identified (per-spawn Task `model` override) is a **real, shipping Claude Code
   feature** that needs **zero** VibeCodes code. All we add is the *recommendation* of which
   model, carried in data we already send.
3. **No user-machine access required.** This was Step 2's central blocker for the
   launch-bootstrap framing. Path A sidesteps it entirely: the model hint is server-side
   data, re-sent on **every** claim, so it survives session restarts, compaction, and
   config drift. Nothing is written to the user's disk.
4. **Anthropic themselves ship and measure this exact coordinator/worker split** (§3) — we
   are not betting on an unproven pattern.

**Why NOT Path B first:** Path B (VibeCodes runs the workflow server-side on Managed
Agents, billing our own key) is where the saving becomes a **VibeCodes COGS reduction**
rather than a user benefit — genuinely attractive — but it is a **large** build (new
server-side agent runner, environments, vaults, event streaming, billing integration) on a
**beta** API (CMA). It is the right *strategic* direction, now de-risked by Anthropic's
measured results, but it is not the cheapest high-value first move. Sequence it after Path A.

**Independent of both:** the in-app AI path is hardcoded to `claude-sonnet-4-6`
(`src/lib/ai-helpers.ts:7`, `AI_MODEL`), including the keyword-gated **workflow-matching
adjudication** which has a standing "move to Haiku" intent
(`src/lib/workflow-matching.ts:39–46`). Dropping that one call to a Haiku-tier model is a
**standalone COGS win** that touches neither path and can ship this week. **Caveat (newly
verified):** the plain `claude-haiku-4-5` alias was already tried and **rejected by the
Anthropic API on the resolved key**, silently falling back to the heuristic in prod — so
the quick win must use a **dated Haiku model id** and verify against the platform key
before merge, not the bare alias.

---

## 2. Introduction mechanism (concrete)

### Named mechanism: a `model` (a.k.a. `model_tier`) field per workflow step / persona role, surfaced in the `claim_next_step` MCP response.

This **corrects Step 2's launch-bootstrap framing.** Step 2 was right that the launch
deep-link *cannot* set the model (it only carries a prompt). The right lever is **not** the
launcher — it is the **server-side workflow data VibeCodes already fully controls and
already returns on every claim.**

**The founder's mental model, confirmed against the code:** Claude Code *is* the
orchestrator. It connects to VibeCodes, picks up a task, and runs the workflow step by
step, and it **already spawns a fresh persona subagent per step** — the `claim_next_step`
instruction literally mandates *"this step MUST be executed by a FRESH SUBAGENT that you
spawn with your Agent/Task tool"* and *"SPAWN a fresh subagent whose system prompt IS that
persona prompt"* (`workflows.ts:730,734`). Because each subagent runs in **isolated
context**, choosing its model per spawn does **not** invalidate the orchestrator's prompt
cache. So the founder's question — *"if we start with Fable, can we kick off the workflow
steps in agents that use Sonnet?"* — answers **yes, cleanly.**

**How the field rides the existing response.** `claim_next_step` already returns per step:
`agent_role`, `bot_id`, the matched persona, the `available_agents` roster, prior-step
`context`, and the spawn instruction. We add **one recommended model per step/role** and
**one clause** to the instruction text: *"spawn this step's agent with `model=<x>`."* The
prototype's §"in-prompt instruction" sketch
([prototype.md](./claude-model-tiering-prototype.md)) becomes redundant for the *current*
session — the hint is now authoritative data, re-sent every claim, not a trimmable tail
clause fighting the deep-link URL budget.

**Model → role mapping (natural fit to existing persona roles):**

| Workflow step / role | Recommended tier | Rationale |
| --- | --- | --- |
| Orchestrator (main Claude Code loop) | **Fable / Opus** | Plans, sequences, reviews, owns board state. Frontier reasoning where it counts; stays on one model to keep prompt cache warm. |
| Product Owner · "Review & Decide" · approval / synthesis steps | **Fable / Opus** (orchestrator tier) | Judgement-heavy, low-token — the frontier model earns its rate here. |
| Full Stack · Front End · implementation steps | **Sonnet** | Token-heavy generation/editing — the bulk of billed tokens, at worker rate. |
| QA · "run tests" · mechanical / mostly-deterministic steps | **Haiku** | Cheapest tier for low-judgement, high-volume mechanical work. |

**Board-identity safety constraint (carried from Step 2, still binding).**
Identity-bearing board mutations — `complete_step` / `fail_step`, and holding the
`claim_token` — **stay with the orchestrator / identity holder**, never the cheap worker
subagent. The existing instruction already enforces this (*"Keep the claim_token … do NOT
pass it to the subagent"* and *"YOU (the orchestrator) call complete_step"*,
`workflows.ts:732,735`). Tiering changes **only which model does the step's work**; it must
not move who is accountable for the step. Step attribution keys on `step.bot_id`
independent of the worker's model, so this holds by construction.

**What actually gets built for Path A:**
- A `model` (nullable text) column on the workflow-step / persona-role schema, plus mapping
  in the platform workflow templates (default null → orchestrator picks).
- The extra clause in the `claim_next_step` instruction builder (`workflows.ts`) that names
  the step's model when present.
- Advisory by nature — as Step 2 stressed, VibeCodes cannot *force* the model; the user's
  `/model` and config always win. That is acceptable: the default path is the good path.

---

## 3. Cost

**Lead with Anthropic's own measured numbers — the credible external anchor.** Anthropic's
Cookbook *"plan big, execute small"*
(`anthropics/claude-cookbooks/managed_agents/CMA_plan_big_execute_small.ipynb`) ships the
*exact* coordinator/worker split we are proposing — verbatim
`COORDINATOR_MODEL = "claude-fable-5"`, `WORKER_MODEL = "claude-sonnet-5"` — where the
frontier model plans and synthesizes and **never touches raw data**, while cheap workers do
all the token-heavy reading. On a 20-fact / 10-park verification task, measured:

| Metric | Solo Fable | Split team (Fable coord + Sonnet workers) | Delta |
| --- | --- | --- | --- |
| Cost | **$4.00** | **$1.61** | **2.5× cheaper** |
| Wall-clock | 608 s | 194 s | **3× faster** |
| Input tokens billed at worker rate | — | **84–98%** | bulk of tokens move to the cheap tier |

This is first-party, measured confirmation from Anthropic of the saving pattern — not a
projection. It maps directly onto VibeCodes workflows: judgement (orchestrator/Product
Owner) is low-token and stays frontier; implementation/QA is high-token and moves to
Sonnet/Haiku.

**Step 2's per-token cost table (carried forward) — note who pays:**

| Split | Orchestrator tokens | Worker tokens | Who pays | Effect |
| --- | --- | --- | --- | --- |
| Solo Fable (today, local) | Fable | Fable | **User** | Baseline — most expensive |
| **Path A: Fable/Opus orch + Sonnet/Haiku workers** | Fable/Opus (low volume) | Sonnet/Haiku (high volume) | **User** | ~2.5× more headroom on the user's own budget/limits. **VibeCodes COGS unchanged.** |
| **Path B: server-side CMA, same split** | Fable/Opus | Sonnet/Haiku | **VibeCodes** | Same ~2.5× — but here it is a **real VibeCodes COGS reduction** on our API key. |
| Opus orch + Sonnet workers | Opus (cheaper than Fable) | Sonnet | either | Cheapest orchestrator option — Fable is ~2× Opus/token, so only keep Fable on the orchestrator if orchestration quality demonstrably needs the frontier model (Step 2 caveat D-note). |

**Segmentation — the crux, stated plainly:**
- **Path A → the *user* saves.** The launched Claude Code bills to the user's Claude
  subscription / their own API key. VibeCodes pays nothing for these tokens today, so
  tiering them is a **UX / goodwill / usage-headroom** feature, not a COGS line. This is
  fine — and it is precisely what a card titled "usages" is asking for.
- **Path B → *VibeCodes* saves.** Only when VibeCodes runs the workflow server-side on its
  own key does the 2.5× hit our P&L. That is the prize that justifies the larger build
  later.
- **Haiku-matching quick win → *VibeCodes* saves,** small but immediate: it is on the
  in-app platform-key path (`resolveAiProvider` / platform credits), independent of A/B.

---

## 4. Risks (Step 2 D1–D4 carried, re-adjudicated, plus CMA-specific)

| # | Risk | Disposition | Notes |
| --- | --- | --- | --- |
| **D1** | VibeCodes cannot *force* the model — the hint is advisory; user config/`/model` wins. | **Accepted** | Inherent to Path A. Default path is the good path; no correctness dependency on it. Not blocking. |
| **D2** | Sonnet/Haiku quality on real VibeCodes implementation/QA steps is unproven — could hurt output quality. | **Mitigated, but flagged unverified** | Anthropic's measured task held quality with 84–98% tokens at worker rate, but that is *their* task, not ours. Mitigation: default hints conservative (implementation→Sonnet only; Haiku reserved for genuinely mechanical steps), field is per-step so we can dial back any step, and it is opt-in via template mapping. **Real Sonnet-vs-Opus quality on VibeCodes tasks is the top open unknown — see §6.** |
| **D3** | Saving accrues to the user, not VibeCodes (Path A). | **Accepted / reframed** | Not a defect — it is the intended benefit for a "usages" card. Path B is the COGS lever when we want it. |
| **D4** | Board-identity / claim_token must not leak to the cheap subagent. | **Mitigated (already enforced)** | Existing `claim_next_step` instruction keeps token + `complete_step`/`fail_step` on the orchestrator; attribution keys on `step.bot_id`. Tiering does not touch this. Not blocking. |
| **D5 (new)** | **CMA is beta** (Path B). | **Blocking for Path B only** | API surface can change; not a basis to build production COGS on yet. Reinforces "Path B later." No effect on Path A. |
| **D6 (new)** | **CMA limits vs. our workflow shape** (Path B): one level of delegation (depth > 1 ignored), max 20 unique roster agents, 25 concurrent threads. | **Accepted with a design note (Path B)** | Our workflows are single-level (orchestrator → per-step persona), so depth-1 fits. But a long workflow could exceed **25 concurrent threads** / **20 unique roster agents** if run fully parallel — Path B design must cap concurrency / reuse roster agents across steps. Not relevant to Path A (local Claude Code has no such caps). |
| **D7 (new)** | **Haiku alias rejection** (quick win). | **Mitigated, must verify** | `claude-haiku-4-5` alias was rejected by the API on the resolved key and silently fell back to heuristic in prod (`workflow-matching.ts:39–46`). Use a **dated Haiku id** and verify against the platform key in a preview before merge. |

**Nothing here is blocking for the recommended first move (Path A + quick win).** D5/D6
gate only Path B, which we are deliberately deferring.

---

## 5. Build-effort t-shirt sizes

| Work item | Size | What it entails |
| --- | --- | --- |
| **Path A — per-step `model` hint in `claim_next_step`** | **S** | One nullable `model` column on workflow-step/role schema; populate the platform templates with the role→tier mapping; add one clause to the `claim_next_step` instruction builder (`workflows.ts`); update `src/types/database.ts` (+ `Relationships`). No user-machine access, no new services. Per-spawn Task `model` override is already a shipping Claude Code feature. |
| **Haiku-for-matching quick win** | **XS** | Swap `WORKFLOW_MATCHING_MODEL` (and consider the `role_matching` adjudication) to a **dated Haiku id**; verify against the platform key in preview (D7). ~1 line + a verification pass. Independent of A/B; can ship first. |
| **Path B — server-side CMA workflow runner** | **L (XL if billing-integrated)** | New server-side agent runner on Managed Agents (Fable/Opus coordinator + Sonnet/Haiku roster mapped to existing `bot_profiles` / `idea_agents`), environments, vaults, event streaming, concurrency capping for D6, and integration with the platform-credit / billing surface. On a **beta** API. Strategic follow-up, not now. |

---

## 6. Decision & next steps (for Step 4 — human approval)

**Recommended decision:** **Approve Path A + the Haiku-matching quick win. Log Path B as a
tracked strategic follow-up (do not build yet).**

**If approved, the actionable next steps:**
1. **Ship the Haiku-matching quick win (XS).** New task: switch workflow-matching (and
   optionally role-matching) adjudication to a **dated Haiku id**, verify against the
   platform key in a preview deploy (respect D7 — do **not** reuse the bare `claude-haiku-4-5`
   alias). Immediate, independent VibeCodes COGS win.
2. **Build Path A (S).** New task: add the `model` column + template mapping + the
   `claim_next_step` instruction clause, with the role→tier table from §2 as the default
   mapping and board-identity constraint (D4) preserved. Keep hints conservative (Haiku only
   for mechanical steps).
3. **Resolve the top open unknown (D2) with a cheap experiment before over-committing tiers:**
   run one representative VibeCodes workflow twice — orchestrator+Sonnet workers vs.
   all-Opus — and compare deliverable quality and cost/latency. This tells us how aggressive
   the default mapping should be. Do this *alongside* shipping Path A's conservative default.
4. **File Path B (L/XL) as a strategic epic**, explicitly gated on: CMA leaving beta (D5),
   a concurrency/roster design for the 25-thread / 20-agent / depth-1 limits (D6), and
   billing integration. Cite the Anthropic Cookbook measured result (2.5× / 3×) as the
   business case anchor.

**Still explicitly unverified (flagged honestly):**
- **Real Sonnet-vs-Opus quality on VibeCodes' own tasks** — the load-bearing unknown behind
  the tier mapping (D2). Step 3 recommends the mapping *conservatively* precisely because
  this is untested; step 3 experiment above closes it.
- **Repo is on Sonnet 4.6, not Sonnet 5.** Anthropic's cookbook figures use `claude-sonnet-5`
  / `claude-fable-5`; our in-app path pins `claude-sonnet-4-6` and `WORKFLOW_MATCHING_MODEL`
  the same. Any Path B / quick-win work should confirm the intended concrete model ids at
  build time rather than assume the cookbook's aliases resolve on our key (see D7 — an alias
  already failed once in prod).
- **Path A saving is real but accrues to the user, not VibeCodes** (D3) — restated so Step 4
  does not mistake it for a COGS reduction. The COGS reduction is Path B (and the small
  quick win).
