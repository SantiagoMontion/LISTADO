-- NOTMID — Permitir leer display_name de otros usuarios del hub
-- Necesario para «Completada por …», notas de tarea, etc.
-- Ejecutar en Supabase SQL Editor (después de nm_hub_profiles.sql).

DROP POLICY IF EXISTS nm_hub_profiles_select ON public.nm_hub_profiles;

CREATE POLICY nm_hub_profiles_select
  ON public.nm_hub_profiles
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.nm_hub_profiles me
      WHERE me.id = auth.uid()
    )
  );

-- Etiquetas para «Completada por …» (evita RLS que solo deja leer el propio perfil).
CREATE OR REPLACE FUNCTION public.nm_hub_profile_display_names(p_user_ids uuid[])
RETURNS TABLE (user_id uuid, label text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    CASE
      WHEN NULLIF(trim(p.display_name), '') IS NOT NULL
           AND lower(trim(p.display_name)) <> 'usuario'
        THEN trim(p.display_name)
      WHEN p.role::text = 'admin' THEN 'Admin'
      WHEN p.role::text = 'taller_1' THEN 'Taller'
      WHEN p.role::text = 'online_1' THEN 'Clientes'
      WHEN p.role::text = 'lista_creator' THEN 'Papel'
      WHEN p.role::text = 'taller_2' THEN 'CORTE - BORDADO'
      ELSE COALESCE(NULLIF(trim(p.display_name), ''), 'Usuario')
    END
  FROM public.nm_hub_profiles p
  WHERE cardinality(COALESCE(p_user_ids, ARRAY[]::uuid[])) > 0
    AND p.id = ANY (p_user_ids);
$$;

REVOKE ALL ON FUNCTION public.nm_hub_profile_display_names(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nm_hub_profile_display_names(uuid[]) TO authenticated;
