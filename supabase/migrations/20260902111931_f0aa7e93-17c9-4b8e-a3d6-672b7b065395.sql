CREATE TABLE public.ai_generation_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  mode TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX ai_generation_log_user_day_idx ON public.ai_generation_log (user_id, created_at DESC);

GRANT SELECT, INSERT ON public.ai_generation_log TO authenticated;
GRANT ALL ON public.ai_generation_log TO service_role;

ALTER TABLE public.ai_generation_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own generation log"
  ON public.ai_generation_log FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can add their own generation log rows"
  ON public.ai_generation_log FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.count_generations_today(_user_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::int
  FROM public.ai_generation_log
  WHERE user_id = _user_id
    AND created_at >= (now() - interval '24 hours')
$$;

GRANT EXECUTE ON FUNCTION public.count_generations_today(UUID) TO authenticated, service_role;