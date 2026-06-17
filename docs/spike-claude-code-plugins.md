# Spike: Should VibeCodes integrate Claude Code plugins?

**Task:** `ea9b2abc` · **Type:** Research / spike · **Author:** Claude Code (for Nick to sign off)
**Sources:** [code.claude.com/docs/en/plugins](https://code.claude.com/docs/en/plugins) (fetched), VibeCodes Agent Skills + Project Kits (in-repo)

---

## TL;DR — Recommendation: **Watch & align, don't build plugin support now**

A Claude Code **plugin** is a *packaging-and-distribution wrapper* for **one developer's local Claude Code** — it bundles skills, subagents, slash commands, hooks, MCP/LSP servers, background monitors, and `bin/` executables into a versioned, marketplace-installable unit. VibeCodes is the opposite shape: a **server-orchestrated, multi-agent** platform where capabilities are assembled into *teams* (Project Kits) and *personas* (agents) and surfaced to whatever Claude Code the user happens to run.

The high-value plugin components VibeCodes cares about — **skills and subagents** — VibeCodes already has, in the **identical `SKILL.md` format**. The rest of the plugin surface (hooks, slash commands, LSP, monitors, `bin/`) is local dev-loop machinery that doesn't map onto VibeCodes' model.

**So:**
1. **Don't build "plugin support" as a feature.** It would re-wrap things we already do, at the wrong altitude.
2. **Keep VibeCodes skills spec-compatible with the plugin `SKILL.md` format** (they already are). This is cheap insurance — it keeps the "publish/consume via marketplace" door open for near-zero cost.
3. **Ride the ecosystem at our altitude** via the two Phase II tasks already on the board — *Import agents from community repos* (`8c87fd5f`) and *Agent Skills Directory browser* (`b393642a`). Those consume the valuable parts (subagents + skills) without adopting the whole plugin packaging stack.
4. **Revisit** only if (a) marketplaces show real adoption, (b) users explicitly ask to attach a plugin to a VibeCodes agent, or (c) Anthropic makes plugins the *dominant* distribution channel for skills/agents.

---

## What a plugin actually is (grounded in the docs)

A plugin is a directory with an optional `.claude-plugin/plugin.json` manifest (name, description, version, author). It can contain, at the plugin root:

| Component | Dir/file | VibeCodes equivalent? |
|---|---|---|
| **Skills** | `skills/<name>/SKILL.md` | ✅ **Yes** — Agent Skills, same `SKILL.md` format |
| **Subagents** | `agents/` | ✅ **Yes** — agent personas (bot_profiles: prompt + role) |
| **MCP servers** | `.mcp.json` | ✅ **Yes** — the VibeCodes MCP server (+ any user MCPs) |
| **Slash commands** | `commands/` | ⚠️ Partial — no per-agent slash commands; not our model |
| **Hooks** | `hooks/hooks.json` | ❌ No — local PreToolUse/PostToolUse automation |
| **LSP servers** | `.lsp.json` | ❌ No — local code-intelligence |
| **Background monitors** | `monitors/monitors.json` | ❌ No — local log/file watchers |
| **`bin/` executables** | `bin/` | ❌ No — local PATH additions |
| **Default settings** | `settings.json` | ⚠️ Partial — can force a default agent as main thread |

**Distribution:** marketplaces (git repos with a `marketplace.json`), plus `--plugin-dir` / `--plugin-url` (zip) for dev. Anthropic runs two: `claude-plugins-official` (curated) and `claude-community` (reviewed public submissions). Skills from a plugin are **namespaced** (`/plugin-name:skill`).

**Key fact:** a plugin is *the same skills/agents/hooks you'd put in `.claude/`*, just wrapped for **sharing, versioning, and marketplace install**. Plugin ≠ new capability; plugin = distribution.

---

## The six questions

**1. What is a plugin vs a skill/subagent?** A skill is one capability; a subagent is one persona. A **plugin is a shareable, versioned bundle** that can contain *many* of each, plus hooks/MCP/LSP/monitors/bin. It's a level up — the packaging/distribution layer.

**2. Do VibeCodes agents need plugins?** No. VibeCodes agents already carry the two things that matter — a system prompt (≈ subagent) and `SKILL.md` skills — plus MCP tools. Plugins would add hooks/commands/LSP/monitors, which are **local single-session dev-loop features**, not multi-agent-orchestration features. Nothing in VibeCodes' value prop is blocked by their absence.

**3. Could a Project Kit *be* a plugin?** They rhyme but sit at different altitudes, so no — don't conflate them:
- A **plugin** configures **one Claude Code instance** (one developer's session).
- A **Project Kit** provisions a **multi-agent team + workflow templates + board labels + auto-rules** for a **project**, orchestrated server-side.
A Kit is closer to "a curated mini-marketplace of agents + process for a project" than to "a plugin." Rebuilding Kits as plugins would *lose* the orchestration layer that is VibeCodes' actual product.

**4. Should users attach a Claude Code plugin to a VibeCodes agent?** Defer — low marginal value. VibeCodes agents already run **inside the user's own Claude Code**, so a user who loves a plugin can just `/plugin install` it locally; VibeCodes doesn't need to mediate. The only VibeCodes-specific version is "this agent role recommends plugin X" — a thin recommendation feature worth doing only if users ask.

**5. Community adoption?** Early but formalizing fast: Anthropic now runs official + community marketplaces with a review pipeline, `marketplace.json` catalogs, and in-app submission. The valuable community content today is **subagents and skills** (e.g. `awesome-claude-code-subagents`) — which is exactly what our import tasks already target.

**6. Build now or wait?** **Wait** on plugin packaging. **Act now** only on the cheap, already-planned pieces: keep skills `SKILL.md`-compatible, and ship the community **subagent/skill import** + **skills directory** features — they capture the ecosystem's value at the right altitude.

---

## What this means for the roadmap

- **No new "plugins" epic.** Close this spike as *watch & align*.
- **Format insurance (near-zero cost):** keep VibeCodes Agent Skills byte-compatible with the plugin `SKILL.md` spec (frontmatter `description`, progressive disclosure, tool restrictions). Already true — just don't drift.
- **The real ecosystem play is two existing tasks:** `8c87fd5f` (import community subagents) and `b393642a` (Agent Skills Directory browser). Frame them as "consume the plugin ecosystem's *contents* (skills + agents), not its *container*."
- **Watch triggers to reopen:** marketplace adoption inflects · a user asks to attach a plugin to an agent · Anthropic makes plugins the primary skills/agents distribution.

_This is a recommendation for Nick to accept/reject — it makes no code or product change on its own._
