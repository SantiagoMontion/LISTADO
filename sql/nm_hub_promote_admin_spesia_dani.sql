-- =============================================================================
-- NOTMID — Listar usuarios y promover Spesia + Dani a admin
-- Ejecutar en Supabase → SQL Editor (rol postgres).
-- =============================================================================

-- 1) Lista resumida (email + nombre visible + rol)
SELECT
  p.display_name AS nombre,
  u.email,
  p.role AS rol_codigo,
  CASE p.role
    WHEN 'admin' THEN 'Admin — todo'
    WHEN 'lista_creator' THEN 'Papel — subir lista, tareas'
    WHEN 'taller_1' THEN 'Taller — tareas, impresos, despachos'
    WHEN 'online_1' THEN 'Clientes — tareas'
    WHEN 'taller_2' THEN 'CORTE — solo lista de corte'
    ELSE p.role
  END AS rol_descripcion
FROM auth.users u
JOIN public.nm_hub_profiles p ON p.id = u.id
ORDER BY p.display_name;

-- 2) Promover a admin (mantiene email, contraseña y display_name)
UPDATE public.nm_hub_profiles
SET role = 'admin', updated_at = now()
WHERE lower(trim(display_name)) IN ('dani', 'spesia')
   OR lower(trim(display_name)) = 'spesia taller'
   OR lower(trim(display_name)) LIKE 'spesia taller%';

-- 3) Verificar
SELECT display_name, role, updated_at
FROM public.nm_hub_profiles
WHERE lower(trim(display_name)) LIKE '%dani%'
   OR lower(trim(display_name)) LIKE '%spesia%'
ORDER BY display_name;
