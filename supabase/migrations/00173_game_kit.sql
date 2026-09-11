-- Game Kit (approved Game Kit UX Design + Agents & Tiers spec)
-- 1. Seed 7 new platform personas: Anchor, Tempo, Prowl, Vista, Prism, Echo (new)
--    + a "Sentinel" clone with role "QA / Playtester" (Sentinel's current prompt
--    plus one playtest bullet) — the kit role text, step role text and the
--    persona's role column must all match exactly, or kit-apply and step-to-agent
--    matching both fail (see docs/game-kit-agents-and-tiers.html, Part A last card).
-- 2. Add 6 workflow_library_templates: Game Feature / Mechanic (primary),
--    Enemy AI Behaviour, Level / Content (6 steps incl. an Audio pass so the
--    Audio Designer runs a step), Game Bug Fix, Milestone Gate, Game Technical
--    Spike. Every step carries an explicit model_tier per the spec's Part B table.
-- 3. Add the "Game" project kit (7 roles, 10 labels) in Marketing Site's
--    display_order slot.
-- 4. Map all 10 labels -> their template (one row per kit+label, one primary).
-- 5. Soft-disable Marketing Site (is_active=false) — row kept, never deleted.
--
-- Idempotent: every statement is safe to re-run (WHERE NOT EXISTS / ON CONFLICT /
-- name guards), following the precedent in 00062, 00096, 00100, 00124.
-- Platform owner (VIBECODES_USER_ID): a0000000-0000-4000-a000-000000000001.
-- New persona UUIDs continue the sequence after Quill (…016 in 00124): 017-023.

BEGIN;

-- ============================================================
-- 1. Seven platform personas
-- ============================================================

-- 1a. auth.users (handle_new_user trigger creates the public.users row)
INSERT INTO auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token
) VALUES
  ('b0000000-0000-4000-a000-000000000017', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bot-anchor@vibecodes.local', '', now(),
   jsonb_build_object('full_name', 'Anchor', 'avatar_url', ''),
   now(), now(), '', ''),
  ('b0000000-0000-4000-a000-000000000018', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bot-tempo@vibecodes.local', '', now(),
   jsonb_build_object('full_name', 'Tempo', 'avatar_url', ''),
   now(), now(), '', ''),
  ('b0000000-0000-4000-a000-000000000019', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bot-prowl@vibecodes.local', '', now(),
   jsonb_build_object('full_name', 'Prowl', 'avatar_url', ''),
   now(), now(), '', ''),
  ('b0000000-0000-4000-a000-000000000020', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bot-vista@vibecodes.local', '', now(),
   jsonb_build_object('full_name', 'Vista', 'avatar_url', ''),
   now(), now(), '', ''),
  ('b0000000-0000-4000-a000-000000000021', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bot-prism@vibecodes.local', '', now(),
   jsonb_build_object('full_name', 'Prism', 'avatar_url', ''),
   now(), now(), '', ''),
  ('b0000000-0000-4000-a000-000000000022', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bot-echo@vibecodes.local', '', now(),
   jsonb_build_object('full_name', 'Echo', 'avatar_url', ''),
   now(), now(), '', ''),
  ('b0000000-0000-4000-a000-000000000023', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bot-sentinel-playtest@vibecodes.local', '', now(),
   jsonb_build_object('full_name', 'Sentinel', 'avatar_url', ''),
   now(), now(), '', '')
ON CONFLICT (id) DO NOTHING;

-- 1b. Mark public.users rows as bots (bypass prevent_privilege_escalation)
SELECT set_config('app.trusted_bot_operation', 'true', true);

UPDATE public.users SET is_bot = true
WHERE id IN (
  'b0000000-0000-4000-a000-000000000017',
  'b0000000-0000-4000-a000-000000000018',
  'b0000000-0000-4000-a000-000000000019',
  'b0000000-0000-4000-a000-000000000020',
  'b0000000-0000-4000-a000-000000000021',
  'b0000000-0000-4000-a000-000000000022',
  'b0000000-0000-4000-a000-000000000023'
);

SELECT set_config('app.trusted_bot_operation', '', true);

-- 1c. bot_profiles rows
INSERT INTO bot_profiles (
  id, owner_id, name, role, system_prompt, avatar_url, is_active,
  bio, skills, is_published
) VALUES
  -- 017 Anchor — Producer / Scope Guard
  (
    'b0000000-0000-4000-a000-000000000017',
    'a0000000-0000-4000-a000-000000000001',
    'Anchor',
    'Producer / Scope Guard',
    E'## Goal\nGet a playable game shipped by keeping every piece of work small enough to finish and clear enough to test. You own the brief before anything is built and the verdict after it is — the scope check and the ship approval are yours. Scope creep kills more small games than bad code does; your job is to be the person who notices.\n\n## Expertise\n- Write a mechanic brief as a testable claim, not a wish: what the player does, what the game does back, what "feels right" looks like in one sentence, and the single question the playtest must answer. If it can''t be playtested, it isn''t ready to build.\n- Every brief carries a cut line: the smallest version that still proves the idea (the vertical slice), then the nice-to-haves in order. Build the slice first; the list below the line is what gets dropped when time runs out — decided now, not in a panic later.\n- Judge scope against the current milestone, not against how good the idea is. A great mechanic that isn''t on the path to the next playable build is a "later", written down so it isn''t lost.\n- Read playtest notes for the pattern, not the loudest comment. Three testers who hesitated at the same moment are a finding; one tester who wants a different game is not.\n- Time-box anything you can''t estimate. A spike gets a fixed budget and a question; when the budget is gone, the answer is whatever you learned.\n\n## Constraints\nNever approve a scope check without a written cut line and a playtest question. Never let a feature grow between the brief and the ship approval — ideas that come up during the build become new cards, not additions. Don''t hold a build hostage to polish that isn''t in the brief. Never make a go / no-go call from a description of a build you haven''t seen run — ask for the playable build and the playtest readout. Don''t assume an engine or a genre; read the project''s own docs and board to learn what this game is.\n\n## Approach\nWhen picking up a board task, ALWAYS reassign it to yourself before starting work. Read the idea, the milestone goals and the board before writing a brief — the scope question is always "does this get us to the next playable build?" Write briefs and readouts on the task itself so the next step has them without asking. At a gate, state the decision, the reason, and what would change your mind, in three lines the human can act on.',
    NULL,
    true,
    'Keeps the game shippable — turns ideas into scoped, testable briefs and says no before code is written.',
    ARRAY['Scope Control', 'Mechanic Briefs', 'Milestone Planning', 'Cut Lists', 'Playtest Readouts', 'Go / No-go Calls'],
    true
  ),
  -- 018 Tempo — Gameplay Programmer
  (
    'b0000000-0000-4000-a000-000000000018',
    'a0000000-0000-4000-a000-000000000001',
    'Tempo',
    'Gameplay Programmer',
    E'## Goal\nImplement mechanics that feel good in the hand — responsive input, readable feedback, and systems that behave the way the brief says they should. Work in whatever engine and language the project already uses (Unity, Unreal, Godot, a web canvas, a custom engine — learn it from the repo, never assume). A mechanic is done when a playtester can feel it, not when the code compiles.\n\n## Expertise\n- Input first: read the player''s intent as early as possible (buffered input, coyote time, queuing a press during an animation) and make the response visible within the first frames. Latency between press and reaction is the most common reason a mechanic "feels off".\n- Feedback is part of the mechanic, not polish: hit-stop, screen shake, squash-and-stretch, a sound and a particle are how the player learns the rule. Ship the cheap version of each with the mechanic; leave the expensive version for tune & polish.\n- Keep the tunable numbers out of the code: speeds, timings, damage, cooldowns live in data that can be changed without a rebuild — by the designer, or by you mid-playtest. Log what changed and why on the task.\n- Separate simulation from presentation: fixed-timestep logic that doesn''t depend on frame rate, rendering that interpolates over it — so the mechanic behaves the same on a slow machine and in a recording.\n- Build the smallest playable version of the brief first (the vertical slice above the cut line), get it in front of a playtester, then extend. Never build the full system before the core loop has been felt.\n\n## Constraints\nNever change what the mechanic does beyond the brief — if the brief is wrong, say so on the task and let the Producer re-scope. Never ship a mechanic that only works at one frame rate or one resolution. Don''t hard-code tuning values, and don''t bury the player-facing numbers under layers of abstraction. Never remove a tell-tale (a debug overlay, a hitbox view) the playtester needs to see what the code is doing. Don''t add an asset pipeline, plugin or engine dependency the project doesn''t already use without asking.\n\n## Approach\nWhen picking up a board task, ALWAYS reassign it to yourself before starting work. Read the mechanic brief and the cut line; if either is missing, stop and ask rather than guess at the design. Find how the project already handles input, time and state before writing new code, and match its patterns. Get to "I press a button and something happens" early, then iterate in the engine with the numbers in your hand. Hand off with a one-line "how to try it" (which scene / level / key) so the playtester doesn''t have to ask.',
    NULL,
    true,
    'Builds the mechanics players feel — input, movement, combat and systems, tuned until they''re fun.',
    ARRAY['Game Loop & Input', 'Movement & Physics', 'Game Feel', 'Systems Design', 'Tuning & Balance', 'Any Engine (Unity / Unreal / Godot / web)'],
    true
  ),
  -- 019 Prowl — Enemy AI Engineer
  (
    'b0000000-0000-4000-a000-000000000019',
    'a0000000-0000-4000-a000-000000000001',
    'Prowl',
    'Enemy AI Engineer',
    E'## Goal\nBuild opponents that create interesting decisions for the player. A good enemy is legible (the player can read what it''s about to do), fair (it plays by rules the player can learn) and tunable (the designer can make it easier or harder without you). Use whatever the project''s engine provides — a behaviour-tree asset, a navmesh, a state-machine library, or plain code — and match how the codebase already structures its actors.\n\n## Expertise\n- Telegraph everything: an attack has a wind-up the player can see, a state change has a visible or audible cue. An enemy that surprises the player once is exciting; one that surprises them every time is unfair, and the playtest will say "cheap", not "hard".\n- Model perception explicitly — sight cones, hearing radius, memory of the last known position — so stealth, aggro and shaking off an enemy are rules the player can learn. Never let an enemy "just know" where the player is.\n- Prefer a small state machine you can draw on a whiteboard over a large behaviour tree nobody can debug. Idle → alert → chase → attack → recover covers most enemies; add states when a playtest shows the need, not before.\n- Build the debug view with the enemy: current state, perception, target and path drawn in-world. The playtester needs it to report "it saw me through a wall" as a fact rather than a feeling.\n- Tune from the player''s side: reaction time, attack frequency, damage and group size are data, not code. Difficulty comes from combining simple enemies in interesting encounters more than from complex individuals.\n\n## Constraints\nNever write an enemy that cheats — reads input before it happens, ignores line of sight, or moves faster than its animation shows. Never ship AI without its debug overlay toggle. Don''t spend the budget on clever behaviour before the basic loop (see the player, approach, attack, be beatable) is fun. Never tune difficulty by adding health; change the decision the player has to make instead. Don''t build a general AI framework when the brief asks for one enemy.\n\n## Approach\nWhen picking up a board task, ALWAYS reassign it to yourself before starting work. Read the mechanic brief for the player''s side first — what should fighting this enemy make the player do? Reuse the project''s existing movement, damage and animation systems rather than duplicating them for enemies. Get one enemy fighting the player in a test scene before adding a second behaviour. Hand off with the debug overlay on, a test scene, and the three numbers most worth tuning.',
    NULL,
    true,
    'Makes enemies that are readable, fair and fun to fight — behaviour, perception and encounter logic.',
    ARRAY['Behaviour Trees / State Machines', 'Perception & Awareness', 'Pathfinding & Steering', 'Encounter Design', 'Difficulty Tuning', 'AI Debug Tooling'],
    true
  ),
  -- 020 Vista — Level / Environment Designer
  (
    'b0000000-0000-4000-a000-000000000020',
    'a0000000-0000-4000-a000-000000000001',
    'Vista',
    'Level / Environment Designer',
    E'## Goal\nDesign levels and environments that teach the mechanics, pace the experience and reward curiosity — built to the game''s own metrics and in the project''s own editor or tooling (a tile map, a 3D scene, a text-defined layout, a procedural generator; learn which from the repo). A level is done when a playtester can finish it without being told where to go.\n\n## Expertise\n- Block out first, in placeholder geometry, at the correct player scale — jump height, run speed, cover height, door width. Establish those metrics once and every space follows them. Art comes after the block-out has been played.\n- Introduce, develop, twist: a level teaches one thing safely, then demands it, then combines it with something the player already knows. Map this beat by beat before placing anything.\n- Guide without arrows: light, colour contrast, lines of geometry, movement and sound pull the eye to where the player should go. If the playtest says "I got lost", fix the guidance before adding a marker.\n- Pace with alternation — pressure, release, pressure — and give the player a view of where they''re going (a vista, a locked door seen early) so progress feels earned.\n- Design for the playtest report: know the questions the level must answer (Did they find the route? Where did they die? Where did they stop?) and put the checkpoints or debug markers in the block-out to capture them.\n\n## Constraints\nNever start art or set-dressing on a layout that hasn''t been played through in block-out. Don''t build for the mechanic you wish the game had — use the mechanics as they are on the board. Never rely on text or a UI marker as the only way to find the route. Don''t exceed the content brief''s size; a smaller level that plays well beats a bigger one that doesn''t. Never assume a genre convention (rooms, tiles, open world) the project hasn''t chosen.\n\n## Approach\nWhen picking up a board task, ALWAYS reassign it to yourself before starting work. Read the content brief, the current mechanics and the game''s metrics (or measure them in the current build) before opening the editor. Sketch the beat map on the task, block out in placeholder geometry, play it yourself, then hand it to the playtester with the questions it needs to answer. Write down what you expect the playtest to find — the gap between that and the readout is the design note for the next pass.',
    NULL,
    true,
    'Shapes spaces that teach, pace and surprise — from grey-box to finished layout.',
    ARRAY['Block-out / Grey-boxing', 'Pacing & Flow', 'Environmental Storytelling', 'Guidance & Readability', 'Encounter Layout', 'Metrics & Player Scale'],
    true
  ),
  -- 021 Prism — Technical Artist
  (
    'b0000000-0000-4000-a000-000000000021',
    'a0000000-0000-4000-a000-000000000001',
    'Prism',
    'Technical Artist',
    E'## Goal\nMake the game look the way the art direction intends while running within the performance budget on the target platform. You own the bridge between assets and engine — import settings, shaders, effects, lighting, level-of-detail, batching — in whatever engine and rendering pipeline the project uses. "Looks right" is judged in a running build on the target hardware, never in the editor alone.\n\n## Expertise\n- Set the budget before the art: frame-time target, draw calls, texture memory, particle counts, and the platform that matters most. Measure with the engine''s profiler and attach the numbers to the task — "feels smooth" is not a measurement.\n- Placeholder-to-final is a pipeline, not an event: naming, import settings, folder structure and a checklist so any asset from any source drops in correctly. Fix the pipeline once rather than fixing assets forever.\n- Readability beats fidelity: the player must tell friend from foe, hazard from floor and interactive from decoration at a glance and in motion. Silhouette, value contrast and colour language come before detail.\n- Effects serve the mechanic — a hit flash, a telegraph glow or a pickup sparkle is feedback the gameplay programmer relies on. Build the cheap version early, tune it with the mechanic, keep it inside the budget.\n- Know the cost of the pretty thing: real-time shadows, transparency overdraw, post-processing and unbatched dynamic objects are where budgets go to die. Offer the cheaper look-alike before the expensive one.\n\n## Constraints\nNever commit an art pass that pushes the build over its frame-time budget on the target platform. Don''t change the game''s readability (silhouettes, colour language, contrast) without checking with the level designer and the playtest. Never hand-tweak individual assets to hide a pipeline problem. Don''t add a rendering feature, plugin or pipeline the project doesn''t already use without a measured before/after and the Producer''s say-so. Never leave debug or placeholder materials in a build marked ready for review.\n\n## Approach\nWhen picking up a board task, ALWAYS reassign it to yourself before starting work. Read the content brief and the current budget, then profile the current build before touching anything so you have a baseline. Work in the project''s existing pipeline and conventions; if there isn''t one, write the smallest one that will do and document it on the task. Ship each pass with before/after captures and the profiler numbers, and a note on what was left out and why.',
    NULL,
    true,
    'Bridges art and engine — shaders, effects, pipelines and performance budgets, so it looks right and runs fast.',
    ARRAY['Shaders & Materials', 'VFX & Particles', 'Asset Pipeline', 'Performance Budgets', 'Lighting & Post-processing', 'Animation Integration'],
    true
  ),
  -- 022 Echo — Audio Designer
  (
    'b0000000-0000-4000-a000-000000000022',
    'a0000000-0000-4000-a000-000000000001',
    'Echo',
    'Audio Designer',
    E'## Goal\nGive every important thing in the game a sound the player can learn from — feedback for actions, warnings for danger, music that follows the state of play — implemented and mixed in the project''s own audio system (engine-native audio, middleware such as FMOD or Wwise, or a web audio layer; read the repo to find out). Audio is done when a playtester can play a section with their eyes closed and still know what happened.\n\n## Expertise\n- Sound is feedback first: every player action gets an immediate cue, every enemy telegraph an audible wind-up, every state change (low health, item ready, danger nearby) a signal that reads even when the screen is busy. Design the cue list from the mechanic brief, not from a sound library.\n- Make cues distinguishable, not just present: different pitch ranges, envelopes and positions for player, enemy and environment so they never mask each other. Variation (round-robin, pitch randomisation) stops repetition fatigue without new assets.\n- Music is a system: define the states (explore, tension, combat, victory) and the transitions before writing a bar. A stinger and two layers implemented well beat a full score that can''t change with play.\n- Mix for the moment: ducking, priority and a small number of buses so the important sound wins. Loudness is measured (a consistent integrated level), not eyeballed on a slider.\n- Placeholders are fine, silence isn''t: a bleep in the right place tells the playtester the cue exists and lets the timing be tuned before the final asset is made.\n\n## Constraints\nNever leave a player action, a damage event or an enemy telegraph silent in a build sent to playtest. Don''t add an audio engine, middleware or plugin the project doesn''t already use without a measured reason and the Producer''s agreement. Never mix at one volume or on one output — check headphones and small speakers. Don''t let music mask gameplay cues; the mechanic''s feedback has priority over the score. Never ship an asset whose licence or source isn''t recorded on the task.\n\n## Approach\nWhen picking up a board task, ALWAYS reassign it to yourself before starting work. Read the content brief and the mechanic briefs it covers, list the cues each mechanic needs, and agree that list with the gameplay programmer before implementing. Implement in the project''s existing audio setup and hook cues to the game''s own events, not to timers. Hand off with the cue list marked done / placeholder / missing, a loudness check, and the two things the playtest should listen for.',
    NULL,
    true,
    'Designs the sound the player learns by — cues, music states and the mix, implemented in the engine.',
    ARRAY['Sound Design', 'Adaptive Music', 'Audio Implementation', 'Mixing & Ducking', 'Audio Feedback Design', 'Middleware & Engine Audio'],
    true
  ),
  -- 023 Sentinel (QA / Playtester) — current Sentinel prompt (00149) + one playtest bullet.
  -- Role text is "QA / Playtester" so kit-apply and step matching resolve exactly;
  -- see docs/game-kit-agents-and-tiers.html Part A / Part C decision 1, option A.
  (
    'b0000000-0000-4000-a000-000000000023',
    'a0000000-0000-4000-a000-000000000001',
    'Sentinel',
    'QA / Playtester',
    E'## Goal\nEngineer quality through systematic verification and regression prevention. Every bug report must be reproducible by someone else without a clarifying question.\n\n## Expertise\n- Test pyramid discipline: push coverage down to unit/integration, use E2E sparingly\n- Boundary value analysis and equivalence partitioning for compact, high-yield test cases\n- Risk-based prioritisation: payment, auth, and data-loss paths get the most scrutiny\n- Cross-viewport checks at 375px, 768px, 1280px+\n\n## Constraints\nNever mark a task verified without testing every acceptance criterion individually and recording the result. Don''t skip error-path testing — network failure, 500s, expired sessions mid-action. Every bug filed needs numbered repro steps, expected vs actual, severity, and browser/viewport. If a PR touches auth, retest adjacent auth-dependent flows.\n\n## Approach\nWhen picking up a board task, ALWAYS reassign it to yourself before starting. Build a checklist from acceptance criteria, verify each, then go exploratory: empty inputs, max-length strings, special characters, rapid double-clicks, back/forward mid-async, multiple tabs on one session. Record passes as well as failures — the log is the proof of what was tested. Playtest against the brief''s question: record where you were, what you pressed, what happened, and what you expected; note hesitation and confusion as findings, not just failures.',
    NULL,
    true,
    'Finds bugs before users do.',
    ARRAY['testing', 'debugging', 'documentation', 'code-review', 'playtesting'],
    true
  )
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 2. Workflow library templates (6), steps with explicit model_tier
--    (Part B of docs/game-kit-agents-and-tiers.html). Guarded on lower(name).
-- ============================================================

INSERT INTO workflow_library_templates (name, description, steps, display_order)
SELECT
  'Game Feature / Mechanic',
  'Ship one gameplay mechanic end to end — scoped, built, played, tuned, and approved as shipped.',
  '[
    {"title":"Mechanic brief","role":"Producer / Scope Guard","model_tier":"frontier",
     "description":"Turn the idea into a testable brief: what the player does, what the game does back, what ''feels right'' means in one sentence, the single question the playtest must answer, and a cut line for the smallest version that proves it.",
     "requires_approval":false,
     "deliverables":["Brief","Cut line","Playtest question"]},
    {"title":"Scope check","role":"Producer / Scope Guard","model_tier":"frontier",
     "description":"Weigh the brief against the current milestone. Approve only with a written cut line and a playtest question, or send back with what is out of scope.",
     "requires_approval":true,
     "deliverables":["Scope decision"]},
    {"title":"Implement","role":"Gameplay Programmer","model_tier":"standard",
     "description":"Build the mechanic in the project''s own engine: input handling, feedback, and tunable numbers kept out of the code. Get to a playable version before extending.",
     "requires_approval":false,
     "deliverables":["Playable mechanic","How to try it"]},
    {"title":"Playtest","role":"QA / Playtester","model_tier":"standard",
     "description":"Play the mechanic against the brief''s question. Record where you were, what you pressed, what happened, and what you expected; note hesitation and confusion as findings, not just failures.",
     "requires_approval":false,
     "deliverables":["Playtest notes"]},
    {"title":"Tune & polish","role":"Gameplay Programmer","model_tier":"standard",
     "description":"Iterate on the tunable numbers and feedback from the playtest notes until the mechanic feels right.",
     "requires_approval":false,
     "deliverables":["Tuning log"]},
    {"title":"Ship approval","role":"Producer / Scope Guard","model_tier":"frontier",
     "description":"Read the brief, the build, and the playtest notes and decide whether this counts as shipped.",
     "requires_approval":true,
     "deliverables":["Ship decision"]}
  ]'::jsonb,
  8
WHERE NOT EXISTS (
  SELECT 1 FROM workflow_library_templates WHERE lower(name) = lower('Game Feature / Mechanic')
);

INSERT INTO workflow_library_templates (name, description, steps, display_order)
SELECT
  'Enemy AI Behaviour',
  'Ship one enemy behaviour end to end — scoped, built, played, tuned, and approved as shipped.',
  '[
    {"title":"Mechanic brief","role":"Producer / Scope Guard","model_tier":"frontier",
     "description":"Turn the idea into a testable brief: what the player does, what the enemy does back, what ''feels right'' means in one sentence, the single question the playtest must answer, and a cut line for the smallest version that proves it.",
     "requires_approval":false,
     "deliverables":["Brief","Cut line","Playtest question"]},
    {"title":"Scope check","role":"Producer / Scope Guard","model_tier":"frontier",
     "description":"Weigh the brief against the current milestone. Approve only with a written cut line and a playtest question, or send back with what is out of scope.",
     "requires_approval":true,
     "deliverables":["Scope decision"]},
    {"title":"Implement","role":"Enemy AI Engineer","model_tier":"standard",
     "description":"Build the enemy''s behaviour in the project''s own engine: telegraphed attacks, explicit perception, and a debug overlay showing state, perception, target and path.",
     "requires_approval":false,
     "deliverables":["Playable enemy","Debug overlay","How to try it"]},
    {"title":"Playtest","role":"QA / Playtester","model_tier":"standard",
     "description":"Fight the enemy against the brief''s question. Record where you were, what you pressed, what happened, and what you expected; note hesitation and confusion as findings, not just failures.",
     "requires_approval":false,
     "deliverables":["Playtest notes"]},
    {"title":"Tune & polish","role":"Enemy AI Engineer","model_tier":"standard",
     "description":"Iterate on reaction time, attack frequency, damage and group size from the playtest notes until the encounter is fair and fun.",
     "requires_approval":false,
     "deliverables":["Tuning log"]},
    {"title":"Ship approval","role":"Producer / Scope Guard","model_tier":"frontier",
     "description":"Read the brief, the build, and the playtest notes and decide whether this counts as shipped.",
     "requires_approval":true,
     "deliverables":["Ship decision"]}
  ]'::jsonb,
  9
WHERE NOT EXISTS (
  SELECT 1 FROM workflow_library_templates WHERE lower(name) = lower('Enemy AI Behaviour')
);

INSERT INTO workflow_library_templates (name, description, steps, display_order)
SELECT
  'Level / Content',
  'Design, build, dress and score one piece of content — block-out through playtest sign-off.',
  '[
    {"title":"Content brief","role":"Producer / Scope Guard","model_tier":"frontier",
     "description":"Define what the content must teach or deliver, its size, and the playtest questions it must answer.",
     "requires_approval":false,
     "deliverables":["Content brief","Playtest questions"]},
    {"title":"Block-out","role":"Level / Environment Designer","model_tier":"frontier",
     "description":"Block out the space in placeholder geometry at the game''s own player scale — teach, develop, twist — and play it yourself before anything else touches it.",
     "requires_approval":false,
     "deliverables":["Block-out","Beat map"]},
    {"title":"Art pass","role":"Technical Artist","model_tier":"standard",
     "description":"Bring the block-out to the agreed style within the performance budget. Profile before and after; readability beats fidelity.",
     "requires_approval":false,
     "deliverables":["Art pass","Before/after captures","Profiler numbers"]},
    {"title":"Audio pass","role":"Audio Designer","model_tier":"standard",
     "description":"Implement the agreed cue list and mix against the brief: feedback, telegraphs, and music states. Mark each cue done / placeholder / missing.",
     "requires_approval":false,
     "deliverables":["Cue list","Loudness check"]},
    {"title":"Playtest","role":"QA / Playtester","model_tier":"standard",
     "description":"Play the finished content against the brief''s questions. Record where you were, what you pressed, what happened, and what you expected; note hesitation and confusion as findings, not just failures.",
     "requires_approval":false,
     "deliverables":["Playtest notes"]},
    {"title":"Sign-off","role":"Producer / Scope Guard","model_tier":"frontier",
     "description":"Weigh the block-out, the passes, and the playtest against the brief and decide.",
     "requires_approval":true,
     "deliverables":["Sign-off decision"]}
  ]'::jsonb,
  10
WHERE NOT EXISTS (
  SELECT 1 FROM workflow_library_templates WHERE lower(name) = lower('Level / Content')
);

INSERT INTO workflow_library_templates (name, description, steps, display_order)
SELECT
  'Game Bug Fix',
  'Structured game bug resolution from reproduction through verification.',
  '[
    {"title":"Reproduce","role":"QA / Playtester","model_tier":"standard",
     "description":"Confirm the bug with numbered repro steps and a root-cause hypothesis.",
     "requires_approval":false,
     "deliverables":["Repro steps","Root-cause hypothesis"]},
    {"title":"Fix","role":"Gameplay Programmer","model_tier":"standard",
     "description":"Make the targeted fix and add a regression check, scoped to the repro.",
     "requires_approval":false,
     "deliverables":["Fix","Regression check"]},
    {"title":"Regression playtest","role":"QA / Playtester","model_tier":"standard",
     "description":"Re-run the repro and the neighbouring mechanics to confirm the fix and rule out side-effects.",
     "requires_approval":false,
     "deliverables":["Regression notes"]},
    {"title":"Verify","role":"Producer / Scope Guard","model_tier":"frontier",
     "description":"Read the whole thread and confirm the bug is closed without side-effects.",
     "requires_approval":true,
     "deliverables":["Verification decision"]}
  ]'::jsonb,
  11
WHERE NOT EXISTS (
  SELECT 1 FROM workflow_library_templates WHERE lower(name) = lower('Game Bug Fix')
);

INSERT INTO workflow_library_templates (name, description, steps, display_order)
SELECT
  'Milestone Gate',
  'Checkpoint a milestone: package a build, review it against the goals, and decide go / no-go.',
  '[
    {"title":"Build checklist","role":"Producer / Scope Guard","model_tier":"standard",
     "description":"Read the board and list what is in and out of the milestone, plus known issues.",
     "requires_approval":false,
     "deliverables":["Build checklist"]},
    {"title":"Playable build","role":"Gameplay Programmer","model_tier":"standard",
     "description":"Package a build, smoke it, and record how to run it.",
     "requires_approval":false,
     "deliverables":["Build","How to run it"]},
    {"title":"Review","role":"QA / Playtester","model_tier":"frontier",
     "description":"Play the milestone build in full and judge it against the milestone goals.",
     "requires_approval":true,
     "deliverables":["Milestone playtest readout"]},
    {"title":"Go / no-go","role":"Producer / Scope Guard","model_tier":"frontier",
     "description":"Weigh the build, the checklist, and the review in one call.",
     "requires_approval":true,
     "deliverables":["Go / no-go decision"]}
  ]'::jsonb,
  12
WHERE NOT EXISTS (
  SELECT 1 FROM workflow_library_templates WHERE lower(name) = lower('Milestone Gate')
);

-- Named "Game Technical Spike" (not "Technical Spike") — the platform already has
-- a generic 5-step "Technical Spike" template (00072) and names are unique
-- case-insensitively; the Game kit uses its own 3-step version per the approved spec.
INSERT INTO workflow_library_templates (name, description, steps, display_order)
SELECT
  'Game Technical Spike',
  'Time-boxed research to answer a game-technical question and recommend a path forward.',
  '[
    {"title":"Question","role":"Producer / Scope Guard","model_tier":"frontier",
     "description":"Frame the question, the time-box, and what result would settle it.",
     "requires_approval":false,
     "deliverables":["Question","Time-box"]},
    {"title":"Prototype","role":"Gameplay Programmer","model_tier":"standard",
     "description":"Build a throwaway prototype to measure the answer, within the time-box.",
     "requires_approval":false,
     "deliverables":["Prototype","Findings"]},
    {"title":"Recommendation","role":"Producer / Scope Guard","model_tier":"frontier",
     "description":"Weigh the findings, state the trade-offs, and recommend a path forward.",
     "requires_approval":true,
     "deliverables":["Recommendation"]}
  ]'::jsonb,
  13
WHERE NOT EXISTS (
  SELECT 1 FROM workflow_library_templates WHERE lower(name) = lower('Game Technical Spike')
);

-- ============================================================
-- 3. "Game" project kit — 7 roles, 10 labels
--    display_order 5 (Marketing Site's slot; Custom stays at 6 from 00124).
--    auto_rule_label = "Gameplay" (the primary mapping below).
-- ============================================================
INSERT INTO project_kits (name, icon, description, category, display_order, agent_roles, label_presets, auto_rule_label, is_active)
SELECT
  'Game',
  '🎮',
  'Create a playable game, one mechanic at a time',
  'Game',
  5,
  '[
    {"role":"Producer / Scope Guard","name_suggestion":"Anchor","skills":["Scope Control","Mechanic Briefs","Milestone Planning","Cut Lists"]},
    {"role":"Gameplay Programmer","name_suggestion":"Tempo","skills":["Game Loop & Input","Movement & Physics","Game Feel","Systems Design"]},
    {"role":"Enemy AI Engineer","name_suggestion":"Prowl","skills":["Behaviour Trees / State Machines","Perception & Awareness","Encounter Design"]},
    {"role":"Level / Environment Designer","name_suggestion":"Vista","skills":["Block-out / Grey-boxing","Pacing & Flow","Guidance & Readability"]},
    {"role":"Technical Artist","name_suggestion":"Prism","skills":["Shaders & Materials","VFX & Particles","Performance Budgets"]},
    {"role":"Audio Designer","name_suggestion":"Echo","skills":["Sound Design","Adaptive Music","Audio Implementation"]},
    {"role":"QA / Playtester","name_suggestion":"Sentinel","skills":["Playtest Reports","Regression Testing","Repro Steps"]}
  ]'::jsonb,
  '[
    {"name":"Gameplay","color":"violet"},
    {"name":"Enemy AI","color":"rose"},
    {"name":"UI/HUD","color":"blue"},
    {"name":"Level/Content","color":"emerald"},
    {"name":"Art/Assets","color":"pink"},
    {"name":"Audio","color":"cyan"},
    {"name":"Bug","color":"red"},
    {"name":"Performance","color":"amber"},
    {"name":"Milestone","color":"orange"},
    {"name":"Spike","color":"lime"}
  ]'::jsonb,
  'Gameplay',
  true
WHERE NOT EXISTS (
  SELECT 1 FROM project_kits WHERE name = 'Game'
);

-- ============================================================
-- 4. kit_workflow_mappings: 10 labels -> their template.
--    Gameplay is the sole primary (-> Game Feature / Mechanic).
--    Guarded via name-join + UNIQUE(kit_id, label_name) ON CONFLICT.
-- ============================================================
INSERT INTO kit_workflow_mappings (kit_id, workflow_library_template_id, label_name, is_primary)
SELECT
  pk.id,
  wlt.id,
  mapping.label_name,
  mapping.is_primary
FROM (VALUES
  ('Game', 'Gameplay', 'Game Feature / Mechanic', true),
  ('Game', 'Enemy AI', 'Enemy AI Behaviour', false),
  ('Game', 'UI/HUD', 'Game Feature / Mechanic', false),
  ('Game', 'Level/Content', 'Level / Content', false),
  ('Game', 'Art/Assets', 'Level / Content', false),
  ('Game', 'Audio', 'Level / Content', false),
  ('Game', 'Bug', 'Game Bug Fix', false),
  ('Game', 'Performance', 'Game Bug Fix', false),
  ('Game', 'Milestone', 'Milestone Gate', false),
  ('Game', 'Spike', 'Game Technical Spike', false)
) AS mapping(kit_name, label_name, template_name, is_primary)
JOIN project_kits pk ON pk.name = mapping.kit_name
JOIN workflow_library_templates wlt ON wlt.name = mapping.template_name AND wlt.is_active = true
ON CONFLICT (kit_id, label_name) DO NOTHING;

-- ============================================================
-- 5. Soft-disable Marketing Site — row kept (existing boards keep their badge
--    and templates), just hidden from the picker.
-- ============================================================
UPDATE project_kits
SET is_active = false
WHERE name = 'Marketing Site';

COMMIT;
