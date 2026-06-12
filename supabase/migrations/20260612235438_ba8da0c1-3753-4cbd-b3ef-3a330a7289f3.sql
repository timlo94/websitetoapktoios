CREATE TABLE public.generated_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  prompt text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'generated',
  storage_path text NOT NULL,
  image_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.generated_images TO authenticated;
GRANT ALL ON public.generated_images TO service_role;

ALTER TABLE public.generated_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own images" ON public.generated_images
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX generated_images_user_created_idx ON public.generated_images(user_id, created_at DESC);