# Agent skills (source and register)

This folder holds the source text of the VibeCodes agent skills we keep, one folder per skill with a `SKILL.md` inside. The live copy is the one on the agent in the app (agent page, "Add Skill"); this copy is the reviewable record, so edit it here first and paste it into the app after.

A skill here is for process and machine knowledge that applies on every board. Facts about this codebase go in the root `CLAUDE.md` instead. Skills are sent in full with every step, so every line has to earn its place.

## Rules

7. A line is added only for a failure that was actually observed (the evidence column below). No skill is written "just in case".
8. When the agents' model changes, re-check every skill listed here: run one past step of each kind without the skill on the new model, and remove any line the model no longer needs.

## Register

| Skill | Agents | Evidence behind each line |
|---|---|---|
| `checking-pages-in-a-browser` | Sentinel, both Planners | Playwright refuses `file://` and saves screenshots only under `.playwright-mcp/` (a Planner could not preview its mock). Playwright's browser is not signed in and the sign-in page has a CAPTCHA (Sentinel was pointed at the wrong browser). The Chrome window will not shrink to phone width (two test runs worked around it; once the phone screenshots were not attached). A card cover image was mistaken for a live dialog for 20 minutes (27 Aug 2026). Testing started before the site served the new release (27 Aug 2026). The deploy line's `?dpl=` hint was wrong for vibecodes.co.uk and was reworded on 14 Oct. |
