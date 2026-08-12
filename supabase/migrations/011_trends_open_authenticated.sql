-- Tendencias: acceso abierto a cualquier usuario autenticado del hub
-- Pegá TODO en Supabase → SQL Editor → Run

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.trend_sources,
  public.trend_search_tasks,
  public.trend_raw_items,
  public.trend_analyzed_items,
  public.trend_clusters,
  public.trend_alerts,
  public.trend_quota_usage,
  public.trend_runs
TO authenticated;

GRANT ALL ON TABLE
  public.trend_sources,
  public.trend_search_tasks,
  public.trend_raw_items,
  public.trend_analyzed_items,
  public.trend_clusters,
  public.trend_alerts,
  public.trend_quota_usage,
  public.trend_runs
TO service_role;

DO $$
DECLARE
  t text;
  pol text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'trend_sources',
    'trend_search_tasks',
    'trend_raw_items',
    'trend_analyzed_items',
    'trend_clusters',
    'trend_alerts',
    'trend_quota_usage',
    'trend_runs'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol, t);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
      t || '_select_authenticated', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (true)',
      t || '_insert_authenticated', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)',
      t || '_update_authenticated', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (true)',
      t || '_delete_authenticated', t
    );
  END LOOP;
END $$;
