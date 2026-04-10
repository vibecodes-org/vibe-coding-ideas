-- Agent Skills: reusable capabilities (SKILL.md open standard) attached to agents
-- Skills give agents domain-specific knowledge loaded on demand via progressive disclosure

CREATE TABLE IF NOT EXISTS public.agent_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id UUID NOT NULL REFERENCES public.bot_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) <= 64),
  description TEXT NOT NULL CHECK (char_length(description) <= 1024),
  content TEXT NOT NULL CHECK (char_length(content) <= 200000),
  source_url TEXT CHECK (source_url IS NULL OR char_length(source_url) <= 2048),
  category TEXT CHECK (category IS NULL OR char_length(category) <= 64),
  source_type TEXT NOT NULL DEFAULT 'file' CHECK (source_type IN ('github', 'file', 'url')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bot_id, name)
);

-- Index for fast lookups by bot
CREATE INDEX IF NOT EXISTS idx_agent_skills_bot_id ON public.agent_skills(bot_id);

-- RLS
ALTER TABLE public.agent_skills ENABLE ROW LEVEL SECURITY;

-- SELECT: all authenticated users can read skills
CREATE POLICY "agent_skills_select" ON public.agent_skills
  FOR SELECT TO authenticated
  USING (true);

-- INSERT: only the bot owner can add skills
CREATE POLICY "agent_skills_insert" ON public.agent_skills
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bot_profiles
      WHERE id = agent_skills.bot_id AND owner_id = auth.uid()
    )
  );

-- UPDATE: only the bot owner can update skills
CREATE POLICY "agent_skills_update" ON public.agent_skills
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bot_profiles
      WHERE id = agent_skills.bot_id AND owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bot_profiles
      WHERE id = agent_skills.bot_id AND owner_id = auth.uid()
    )
  );

-- DELETE: only the bot owner can remove skills
CREATE POLICY "agent_skills_delete" ON public.agent_skills
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bot_profiles
      WHERE id = agent_skills.bot_id AND owner_id = auth.uid()
    )
  );
