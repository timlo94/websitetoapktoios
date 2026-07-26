
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE TABLE public.visitor_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid,
  ip_address text,
  user_agent text,
  country text,
  city text,
  path text,
  referrer text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.visitor_logs TO authenticated;
GRANT ALL ON public.visitor_logs TO service_role;

ALTER TABLE public.visitor_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read visitor logs"
ON public.visitor_logs FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX visitor_logs_created_at_idx ON public.visitor_logs (created_at DESC);
CREATE INDEX visitor_logs_user_id_idx ON public.visitor_logs (user_id);

SELECT cron.schedule(
  'visitor-logs-cleanup',
  '0 3 * * *',
  $$ DELETE FROM public.visitor_logs WHERE created_at < now() - interval '90 days'; $$
);
