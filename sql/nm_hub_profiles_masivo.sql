-- =============================================================================
-- NOTMID — Perfiles en bloque (sin copiar UUIDs uno por uno)
-- Ejecutá esto en el SQL Editor de Supabase con rol postgres.
-- =============================================================================
--
-- QUÉ ES CADA COSA (para no mezclar):
--
-- 1) Authentication → Users: son las cuentas (email, contraseña). Ahí NO existe
--    display_name de la app: eso vive en la tabla public.nm_hub_profiles.
--
-- 2) Table Editor → nm_hub_profiles: una fila por usuario, con display_name y role.
--    Si creaste usuarios en Auth ANTES de correr nm_hub_profiles.sql, puede que no
--    tengan fila acá: por eso "no ves" nombre en esta tabla.
--
-- 3) No hace falta crear usuarios "a mano" en nm_hub_profiles: el trigger del script
--    nm_hub_profiles.sql crea la fila cuando alguien se registra. Para los que ya
--    existían, usá el PASO 1 de abajo (una sola vez).
--
-- =============================================================================

-- PASO 1 — Crear fila de perfil para TODOS los usuarios de Auth que todavía no la tengan
-- (no tenés que pegar ningún id).
INSERT INTO public.nm_hub_profiles (id, display_name, role)
SELECT
  u.id,
  COALESCE(
    NULLIF(trim(u.raw_user_meta_data ->> 'full_name'), ''),
    NULLIF(trim(u.raw_user_meta_data ->> 'name'), ''),
    NULLIF(split_part(COALESCE(u.email, ''), '@', 1), ''),
    'Usuario'
  ),
  'taller_1'
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.nm_hub_profiles p WHERE p.id = u.id)
ON CONFLICT (id) DO NOTHING;

-- PASO 2 — Actualizar el nombre visible de TODAS las filas existentes desde Auth
-- (parte del email antes del @, o nombre en metadata). Un solo comando para todos.
UPDATE public.nm_hub_profiles p
SET
  display_name = COALESCE(
    NULLIF(trim(u.raw_user_meta_data ->> 'full_name'), ''),
    NULLIF(trim(u.raw_user_meta_data ->> 'name'), ''),
    NULLIF(split_part(COALESCE(u.email, ''), '@', 1), ''),
    p.display_name
  ),
  updated_at = now()
FROM auth.users u
WHERE u.id = p.id;

-- (Opcional) Ver resultado: email de Auth + perfil
SELECT u.email, p.display_name, p.role
FROM auth.users u
JOIN public.nm_hub_profiles p ON p.id = u.id
ORDER BY u.created_at DESC;
