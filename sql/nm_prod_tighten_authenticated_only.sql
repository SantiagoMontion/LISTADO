-- Opcional: dejar nm_prod_* solo para usuarios autenticados (recomendado si ya usás login en la app).
-- Ejecutar solo cuando todos los clientes usen sesión Supabase Auth.
-- Hace falta que el front use el mismo proyecto con usuario logueado (JWT).

DROP POLICY IF EXISTS nm_prod_reports_all_anon ON public.nm_prod_reports;
DROP POLICY IF EXISTS nm_prod_tasks_all_anon ON public.nm_prod_tasks;
