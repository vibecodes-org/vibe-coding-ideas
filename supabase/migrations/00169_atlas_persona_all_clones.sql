-- Follow-up to 00168: apply the stack-agnostic Atlas persona to EVERY clone.
--
-- 00168 only rewrote clones whose text was byte-identical to the then-current
-- seed (3 of 9). Nick asked for the rest too (6 Sep 2026, task 1ee55156).
-- Checked in prod: the other 6 carry older seed texts (the pre-00149
-- 2,312-char one, or an 876-char early variant) — never owner-edited, they
-- just pre-date later seed rewrites. So every clone now gets the seed's text.
--
-- Copies from the seed row rather than repeating the literal, so this cannot
-- drift from 00168.

UPDATE public.bot_profiles c
SET system_prompt = s.system_prompt, updated_at = now()
FROM public.bot_profiles s
WHERE s.id = 'b0000000-0000-4000-a000-000000000001'
  AND c.cloned_from = s.id
  AND c.system_prompt IS DISTINCT FROM s.system_prompt;
