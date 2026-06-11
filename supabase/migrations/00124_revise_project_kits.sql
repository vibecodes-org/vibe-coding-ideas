-- Revise Project Kits (approved Feature Development design)
-- 1. Soft-disable the Design System kit (is_active=false)
-- 2. Rename "AI / ML Project" kit -> "AI App / Agent" (name + description only)
-- 3. Seed new platform persona "Quill" (Copywriter / Content)
-- 4. Add "Landing Page" workflow library template (6 steps, 2 approval gates)
-- 5. Add "Marketing Site" project kit (Growth) with 5 roles + 6 labels
-- 6. Map Marketing Site kit labels -> Landing Page template (Landing Page primary, Copy, Design)
--
-- Idempotent: every statement is safe to re-run (WHERE NOT EXISTS / ON CONFLICT / name guards),
-- following the precedent in 00062, 00096, 00100, 00103, 00106.
-- Platform owner (VIBECODES_USER_ID): a0000000-0000-4000-a000-000000000001 (see 00062).

BEGIN;

-- ============================================================
-- 1. Soft-disable Design System kit
-- ============================================================
UPDATE project_kits
SET is_active = false
WHERE name = 'Design System';

-- ============================================================
-- 2. Rename AI / ML Project -> AI App / Agent (name + description only)
-- ============================================================
UPDATE project_kits
SET
  name = 'AI App / Agent',
  description = 'Your AI team for building an AI-powered app or agent'
WHERE name = 'AI / ML Project';

-- ============================================================
-- 3. Seed "Quill" — Copywriter / Content platform persona
--    UUID: b0000000-0000-4000-a000-000000000016 (next after 15 in 00062)
--    3-table seed: auth.users -> public.users (trusted-bot guard) -> bot_profiles
-- ============================================================

-- 3a. auth.users (handle_new_user trigger creates the public.users row)
INSERT INTO auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token
) VALUES
  ('b0000000-0000-4000-a000-000000000016', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bot-quill@vibecodes.local', '', now(),
   jsonb_build_object('full_name', 'Quill', 'avatar_url', ''),
   now(), now(), '', '')
ON CONFLICT (id) DO NOTHING;

-- 3b. Mark public.users row as a bot (bypass prevent_privilege_escalation)
SELECT set_config('app.trusted_bot_operation', 'true', true);

UPDATE public.users SET is_bot = true
WHERE id = 'b0000000-0000-4000-a000-000000000016';

SELECT set_config('app.trusted_bot_operation', '', true);

-- 3c. bot_profiles row
INSERT INTO bot_profiles (
  id, owner_id, name, role, system_prompt, avatar_url, is_active,
  bio, skills, is_published
) VALUES
  (
    'b0000000-0000-4000-a000-000000000016',
    'a0000000-0000-4000-a000-000000000001',
    'Quill',
    'Copywriter / Content',
    E'## Goal\nWrite marketing copy that turns product features into clear, compelling outcomes\nvisitors actually care about. Every headline, value proposition, and CTA should be\ntruthful, on-brand, and written to move the reader one step closer to acting. Good\ncopy earns trust — it never tricks.\n\n## Expertise\n- Lead with the outcome, not the mechanism. Apply Jobs-to-be-Done: people don''t want\n  the feature, they want the result. "Go from idea to a working board in 60 seconds,"\n  not "AI-powered task generation."\n- Write headlines that pass the "so what?" test. A headline must state a specific\n  benefit or a specific audience — if it could sit on any competitor''s page, rewrite it.\n  Always offer 2-3 options so the approver can choose voice and angle.\n- Structure value props with the feature → benefit → outcome chain, and back claims\n  with proof (a number, a testimonial, a concrete example) wherever one exists.\n- Write CTAs that describe the value of clicking, not the mechanics. "Start building\n  free" beats "Submit." First person ("Start my project") often outperforms second.\n- Apply plain-language principles: short sentences, active voice, concrete nouns,\n  cut filler ("very," "really," "in order to"). Aim for a grade 7-9 reading level for\n  broad audiences; match the audience''s vocabulary for technical ones.\n- Know SEO basics: write a unique meta title (~55 chars) and description (~155 chars)\n  that read naturally and include the primary term; use one clear H1; write descriptive\n  link text; never keyword-stuff.\n- Adapt to brand voice. If a voice/tone guide or existing copy exists, mirror it. If not,\n  infer it from the product and confirm the intended tone (e.g. confident vs. friendly)\n  in the brief before writing at length.\n\n## Constraints\nNever make a claim the product cannot currently deliver — roadmap features are not live\nfeatures, and "fastest/best/only" needs evidence or it gets cut. Do not use dark patterns:\nno fake urgency, no manipulative scarcity, no hidden costs in the fine print. Never write\ninaccessible copy — avoid ALL-CAPS for emphasis (screen readers spell it out), don''t rely\non copy that only makes sense alongside an image, and keep link text meaningful out of\ncontext. Do not bury the primary CTA or write more than one competing primary action per\nsection. Never ship copy with unverified stats, typos, or claims you haven''t checked\nagainst the actual product.\n\n## Approach\nWhen picking up a board task, ALWAYS reassign it to yourself before starting work. Start\nfrom the brief: who is the audience, what is the single conversion goal, and what is the\ncore value proposition? If any of those is missing, ask before writing. Draft the headline\nand CTA first — they anchor everything else — and provide options. Write section copy that\nflows toward the CTA. Read it aloud to catch clunky phrasing. Fact-check every claim against\nthe product before handing off. Hand the approver clear choices (headline variants) and a\none-line note on the tone you aimed for, so review is fast and specific.',
    NULL,
    true,
    'Marketing copywriter who turns features into outcomes — headlines, value props, and CTAs that convert without overpromising.',
    ARRAY['Landing Copy', 'Headlines & Value Props', 'CTAs', 'Brand Voice', 'SEO Copy', 'Conversion Messaging'],
    true
  )
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 4. "Landing Page" workflow library template (6 steps, 2 approval gates)
--    Guarded on case-insensitive name uniqueness (matches the unique index in 00072).
-- ============================================================
INSERT INTO workflow_library_templates (name, description, steps, display_order)
SELECT
  'Landing Page',
  'Ship a landing page that converts — brief, copy, design, build, and QA sign-off.',
  '[
    {"title":"Brief & Goals","role":"Product Owner",
     "description":"Define the page''s single conversion goal (the one action a visitor should take), the target audience, and the core value proposition. List the must-have sections and any proof points (testimonials, metrics, logos). This brief is the contract for copy and design.",
     "requires_approval":false,
     "deliverables":["Conversion goal","Target audience","Value proposition","Section outline","Proof points"]},
    {"title":"Write Copy","role":"Copywriter / Content",
     "description":"Write the page copy from the brief: headline, subhead, section copy, and CTA labels. Lead with the outcome, match the brand voice, keep claims truthful, and write a clear primary CTA. Provide 2-3 headline options for the approver to choose from.",
     "requires_approval":false,
     "deliverables":["Headline (2-3 options)","Subhead","Section copy","CTA copy","Meta title & description"]},
    {"title":"Copy Approval","role":"Product Owner",
     "description":"Review the copy against the brief: does the headline land, is the value prop clear, are claims accurate, is the CTA compelling? Pick the headline option. Approve or send back with specific feedback before design starts.",
     "requires_approval":true,
     "deliverables":["Copy approval or feedback","Chosen headline"]},
    {"title":"Design Layout","role":"UX Designer",
     "description":"Design the page layout around the approved copy: visual hierarchy that guides toward the CTA, responsive behaviour (mobile-first), and accessibility (contrast, focus order, headings). Specify spacing, sections, and the hero treatment.",
     "requires_approval":false,
     "deliverables":["Layout / wireframe (HTML)","Responsive specs","Accessibility notes"]},
    {"title":"Build Page","role":"Front End Engineer",
     "description":"Build the page to the approved copy and design. Mobile-first, semantic HTML, accessible. Hit Core Web Vitals (LCP < 2.5s, CLS ~0), wire up the primary CTA and any analytics/conversion tracking. Add the meta title/description and Open Graph tags.",
     "requires_approval":false,
     "deliverables":["Page implementation","Responsive build","Meta + OG tags","Analytics/CTA wiring"]},
    {"title":"QA & Launch Sign-off","role":"QA Engineer",
     "description":"Verify every CTA and form works, copy is proofread (no typos), links resolve, the page renders cross-browser and on mobile, contrast/keyboard pass WCAG 2.1 AA, and performance is within budget. Then confirm the page is ready and approve for launch.",
     "requires_approval":true,
     "deliverables":["QA report","Cross-browser/mobile check","Accessibility audit","Launch approval"]}
  ]'::jsonb,
  7
WHERE NOT EXISTS (
  SELECT 1 FROM workflow_library_templates WHERE lower(name) = lower('Landing Page')
);

-- ============================================================
-- 5. "Marketing Site" project kit (Growth) — 5 roles, 6 labels
--    Guarded on name; display_order 5 (after AI=4); Custom bumped to 6 below.
--    auto_rule_label = "Landing Page" (the primary mapping below).
-- ============================================================
INSERT INTO project_kits (name, icon, description, category, display_order, agent_roles, label_presets, auto_rule_label, is_active)
SELECT
  'Marketing Site',
  '📣',
  'Your AI team for shipping a landing page that converts',
  'Growth',
  5,
  '[
    {"role":"Product Owner","name_suggestion":"Horizon","skills":["Positioning Briefs","Conversion Goals","Acceptance Criteria","Audience Definition"]},
    {"role":"Copywriter / Content","name_suggestion":"Quill","skills":["Landing Copy","Headlines & Value Props","CTAs","Brand Voice","SEO Copy"]},
    {"role":"UX Designer","name_suggestion":"Compass","skills":["Landing Page Layout","Visual Hierarchy","Responsive Design","Accessibility (WCAG 2.1)","Conversion UX"]},
    {"role":"Front End Engineer","name_suggestion":"Pixel","skills":["Next.js / React","Tailwind CSS","Core Web Vitals","Responsive Build","Analytics Wiring"]},
    {"role":"QA Engineer","name_suggestion":"Sentinel","skills":["Cross-browser","Link/Form Testing","Accessibility Audit","Performance Budget","Copy Proofing"]}
  ]'::jsonb,
  '[
    {"name":"Landing Page","color":"violet"},
    {"name":"Copy","color":"emerald"},
    {"name":"SEO","color":"cyan"},
    {"name":"Design","color":"pink"},
    {"name":"Content Update","color":"amber"},
    {"name":"Bug","color":"red"}
  ]'::jsonb,
  'Landing Page',
  true
WHERE NOT EXISTS (
  SELECT 1 FROM project_kits WHERE name = 'Marketing Site'
);

-- 5b. Keep Custom last: bump it past Marketing Site (idempotent — re-run sets 6 again).
UPDATE project_kits SET display_order = 6 WHERE name = 'Custom';

-- ============================================================
-- 6. kit_workflow_mappings: Marketing Site -> Landing Page template
--    Landing Page (primary), Copy, Design all map to "Landing Page".
--    No Bug Fix / Technical Spike secondaries (per Design Review guidance).
--    Guarded via name-join + UNIQUE(kit_id, label_name) ON CONFLICT.
-- ============================================================
INSERT INTO kit_workflow_mappings (kit_id, workflow_library_template_id, label_name, is_primary)
SELECT
  pk.id,
  wlt.id,
  mapping.label_name,
  mapping.is_primary
FROM (VALUES
  ('Marketing Site', 'Landing Page', 'Landing Page', true),
  ('Marketing Site', 'Copy', 'Landing Page', false),
  ('Marketing Site', 'Design', 'Landing Page', false)
) AS mapping(kit_name, label_name, template_name, is_primary)
JOIN project_kits pk ON pk.name = mapping.kit_name
JOIN workflow_library_templates wlt ON wlt.name = mapping.template_name AND wlt.is_active = true
ON CONFLICT (kit_id, label_name) DO NOTHING;

COMMIT;
