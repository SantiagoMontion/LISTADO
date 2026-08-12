-- Parche acceso Tendencias (admin)
-- Corré esto en Supabase → SQL Editor si /trends falla por permisos RLS.

-- Reusa el helper ya existente del hub
CREATE OR REPLACE FUNCTION public.nm_hub_profile_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT trim(lower(p.role::text))
  FROM public.nm_hub_profiles p
  WHERE p.id = auth.uid()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.nm_hub_profile_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nm_hub_profile_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.nm_hub_profile_role() TO service_role;

CREATE OR REPLACE FUNCTION public.is_hub_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(public.nm_hub_profile_role() = 'admin', false);
$$;

REVOKE ALL ON FUNCTION public.is_hub_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_hub_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_hub_admin() TO service_role;

-- Grants de tabla (sin esto PostgREST dice "permission denied")
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

-- Políticas admin con helper del hub
DO $$
DECLARE
  t text;
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
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_all', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_hub_admin()) WITH CHECK (public.is_hub_admin())',
      t || '_admin_all',
      t
    );
  END LOOP;
END $$;

-- Diagnóstico rápido (debería devolver admin / true estando logueado como Montion)
-- SELECT public.nm_hub_profile_role() AS role, public.is_hub_admin() AS is_admin;
