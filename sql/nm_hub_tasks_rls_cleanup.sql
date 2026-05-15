-- =============================================================================
-- NOTMID — Limpieza RLS en nm_hub_tasks (políticas duplicadas / permisivas viejas)
-- Si en Postgres quedó una política con WITH CHECK (true) junto a la estricta,
-- las políticas PERMISSIVE se combinan con OR: cualquier rol podría insertar.
-- Ejecutar UNA VEZ en SQL Editor (postgres), luego probá de nuevo /tareas.
-- =============================================================================

DO $$
DECLARE
  pol text;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'nm_hub_tasks'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.nm_hub_tasks', pol);
  END LOOP;
END $$;

CREATE POLICY nm_hub_tasks_select
  ON public.nm_hub_tasks FOR SELECT TO authenticated USING (true);

CREATE POLICY nm_hub_tasks_insert
  ON public.nm_hub_tasks FOR INSERT TO authenticated
  WITH CHECK (public.nm_hub_profile_role() = 'taller_1');

CREATE POLICY nm_hub_tasks_update
  ON public.nm_hub_tasks FOR UPDATE TO authenticated
  USING (public.nm_hub_profile_role() = 'taller_1')
  WITH CHECK (public.nm_hub_profile_role() = 'taller_1');

CREATE POLICY nm_hub_tasks_delete
  ON public.nm_hub_tasks FOR DELETE TO authenticated
  USING (public.nm_hub_profile_role() = 'taller_1');
