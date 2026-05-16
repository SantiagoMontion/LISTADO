-- Diagnóstico rápido (ejecutar en SQL Editor estando logueado en la app NO aplica auth.uid;
-- usá el UUID de tu usuario de Authentication → Users)

-- Reemplazá este UUID por el tuyo:
-- \set uid 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'

SELECT id, display_name, role, trim(lower(role::text)) AS role_normalizado
FROM public.nm_hub_profiles
ORDER BY display_name;

SELECT policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'nm_hub_tasks'
ORDER BY policyname;

SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.nm_hub_tasks'::regclass
  AND contype = 'c';
