-- =============================================================================
-- NOTMID — Diagnóstico: perfil visible en Table Editor pero la app no lo lee
-- Ejecutar en SQL Editor (rol postgres). No modifica nada hasta los bloques UPDATE.
-- =============================================================================

-- 1) ¿Cada usuario de Auth tiene fila en nm_hub_profiles con el MISMO id?
SELECT u.id AS auth_user_id, u.email, p.id AS profile_id, p.display_name, p.role
FROM auth.users u
LEFT JOIN public.nm_hub_profiles p ON p.id = u.id
ORDER BY u.created_at DESC
LIMIT 20;

-- Si profile_id es NULL: falta fila (corré el INSERT de abajo).
-- Si profile_id = auth_user_id y aun así la app no lee: revisá RLS + GRANT (bloque 3).

-- 2) Poner nombre a gusto (cambiá email y el nombre entre comillas)
UPDATE public.nm_hub_profiles p
SET display_name = 'Julian'
FROM auth.users u
WHERE p.id = u.id
  AND u.email ILIKE '%julitombesi22%';

-- 3) Asegurar lectura de la propia fila con JWT (por si faltó GRANT o la política)
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, UPDATE ON TABLE public.nm_hub_profiles TO authenticated;

DROP POLICY IF EXISTS nm_hub_profiles_select ON public.nm_hub_profiles;
CREATE POLICY nm_hub_profiles_select
  ON public.nm_hub_profiles FOR SELECT TO authenticated
  USING (id = auth.uid());

-- 4) Crear perfiles que falten para usuarios ya existentes en Auth
INSERT INTO public.nm_hub_profiles (id, display_name, role)
SELECT
  u.id,
  COALESCE(
    NULLIF(trim(u.raw_user_meta_data ->> 'full_name'), ''),
    NULLIF(split_part(COALESCE(u.email, ''), '@', 1), ''),
    'Usuario'
  ),
  'taller_1'
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.nm_hub_profiles p WHERE p.id = u.id)
ON CONFLICT (id) DO NOTHING;
