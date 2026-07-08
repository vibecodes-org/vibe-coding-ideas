-- P2: Seed advisory model_tier defaults into the platform library templates.
--
-- Scope (v1): workflow_library_templates only. Per-idea templates and user
-- templates default every step to Auto (absent). This is a one-time fill of the
-- select's default value — it NEVER overwrites a step that already carries a
-- model_tier, and users can change any value afterwards.
--
-- Role -> tier map (design §06), matched on each step's role AND title, tolerant
-- of role-name variants and case:
--   QA / mechanical  (QA Engineer, verify / run-tests / lint / format steps) -> cheap
--   Design / UX      (UX Designer, design & design-review steps)             -> frontier
--   Product / review (Product Owner, Business Analyst, PM, decision/review)  -> frontier
--   Build engineers  (Full Stack / Front End / Back End Engineer/Developer)  -> standard
--   everything else                                                          -> absent (Auto)

DO $$
DECLARE
  tpl RECORD;
  new_steps jsonb;
  step jsonb;
  role_txt text;
  title_txt text;
  tier text;
BEGIN
  FOR tpl IN SELECT id, steps FROM workflow_library_templates LOOP
    -- Skip malformed / empty step arrays defensively.
    IF tpl.steps IS NULL OR jsonb_typeof(tpl.steps) <> 'array' THEN
      CONTINUE;
    END IF;

    new_steps := '[]'::jsonb;

    FOR step IN SELECT * FROM jsonb_array_elements(tpl.steps) LOOP
      -- Never overwrite an explicit choice already present on the step.
      IF (step ? 'model_tier') AND (step->>'model_tier') IS NOT NULL THEN
        new_steps := new_steps || step;
        CONTINUE;
      END IF;

      role_txt := lower(coalesce(step->>'role', ''));
      title_txt := lower(coalesce(step->>'title', ''));
      tier := NULL;

      IF role_txt ~ '\yqa\y|quality assurance|\ytest'
         OR title_txt ~ '\yqa\y|verify|run tests|\ylint|\yformat|changelog' THEN
        tier := 'cheap';
      ELSIF role_txt ~ '\yux\y|\yui\y|design'
         OR title_txt ~ 'design' THEN
        tier := 'frontier';
      ELSIF role_txt ~ 'product|owner|analyst|\ypm\y|\yba\y|founder|\yceo\y'
         OR title_txt ~ 'review|approv|decision|requirement' THEN
        tier := 'frontier';
      ELSIF role_txt ~ 'engineer|developer|\ydev\y|programmer|architect|full.?stack|front|back' THEN
        tier := 'standard';
      END IF;

      IF tier IS NOT NULL THEN
        step := jsonb_set(step, '{model_tier}', to_jsonb(tier), true);
      END IF;

      new_steps := new_steps || step;
    END LOOP;

    UPDATE workflow_library_templates SET steps = new_steps WHERE id = tpl.id;
  END LOOP;
END $$;
