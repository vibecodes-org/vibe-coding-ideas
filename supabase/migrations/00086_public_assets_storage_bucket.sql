-- Public assets bucket for landing page media (demo video, etc.)
-- Public bucket — no auth required for reads
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'public-assets',
  'public-assets',
  true,
  52428800, -- 50MB limit
  ARRAY['video/mp4', 'video/webm', 'image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE SET
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Anyone can read public assets
CREATE POLICY "Anyone can view public assets"
ON storage.objects FOR SELECT
USING (bucket_id = 'public-assets');

-- Only admins can upload (service role or admin users)
CREATE POLICY "Admins can upload public assets"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'public-assets'
  AND EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = true)
);

-- Only admins can update (replace files)
CREATE POLICY "Admins can update public assets"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'public-assets'
  AND EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = true)
);

-- Only admins can delete
CREATE POLICY "Admins can delete public assets"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'public-assets'
  AND EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = true)
);
