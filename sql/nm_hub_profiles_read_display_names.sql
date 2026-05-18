-- NOTMID — Permitir leer display_name de otros usuarios del hub
-- Necesario para «Completada por …», notas de tarea, etc.
-- Ejecutar en Supabase SQL Editor (después de nm_hub_profiles.sql).

DROP POLICY IF EXISTS nm_hub_profiles_select ON public.nm_hub_profiles;

CREATE POLICY nm_hub_profiles_select
  ON public.nm_hub_profiles
  FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.nm_hub_profiles me
      WHERE me.id = auth.uid()
    )
  );
