-- =============================================================================
-- NOTMID — Rol online_1 + nm_hub_tasks.assigned_role + RLS por asignación
-- Ejecutar en SQL Editor (Supabase) tras backup. Orden: 1→2→3.
--
-- assigned_role ∈ (online_1, taller_1, lista_creator): “Dani / Juancruz / Tomas”
-- Visibilidad SELECT/UPDATE: admin | rol = assigned_role | creador (seguimiento)
-- =============================================================================

-- 1) Perfiles ---------------------------------------------------------------
ALTER TABLE public.nm_hub_profiles DROP CONSTRAINT IF EXISTS nm_hub_profiles_role_check;

ALTER TABLE public.nm_hub_profiles
  ADD CONSTRAINT nm_hub_profiles_role_check
  CHECK (role IN ('admin', 'lista_creator', 'taller_1', 'taller_2', 'online_1'));


-- 2) Tareas ----------------------------------------------------------------
ALTER TABLE public.nm_hub_tasks
  ADD COLUMN IF NOT EXISTS assigned_role text;

UPDATE public.nm_hub_tasks
SET assigned_role = 'taller_1'
WHERE assigned_role IS NULL;

ALTER TABLE public.nm_hub_tasks
  ALTER COLUMN assigned_role SET NOT NULL;

ALTER TABLE public.nm_hub_tasks DROP CONSTRAINT IF EXISTS nm_hub_tasks_assigned_role_check;
ALTER TABLE public.nm_hub_tasks
  ADD CONSTRAINT nm_hub_tasks_assigned_role_check
  CHECK (assigned_role IN ('online_1', 'taller_1', 'lista_creator'));

CREATE INDEX IF NOT EXISTS idx_nm_hub_tasks_assigned_role ON public.nm_hub_tasks (assigned_role);

COMMENT ON COLUMN public.nm_hub_tasks.assigned_role IS
  'Rol hub destinatario (Dani=online_1, Juancruz=taller_1, Tomas=lista_creator). Obligatorio.';

COMMENT ON COLUMN public.nm_hub_profiles.role IS
  'admin · lista_creator (PDF CREATOR) · taller_1 (TALLER OPERATOR) · online_1 (CLIENTES OPERATOR) · taller_2 (CORTE - BORDADO)';


-- 3) RLS ------------------------------------------------------------------
DROP POLICY IF EXISTS nm_hub_tasks_select ON public.nm_hub_tasks;
DROP POLICY IF EXISTS nm_hub_tasks_insert ON public.nm_hub_tasks;
DROP POLICY IF EXISTS nm_hub_tasks_update ON public.nm_hub_tasks;
DROP POLICY IF EXISTS nm_hub_tasks_delete ON public.nm_hub_tasks;

CREATE POLICY nm_hub_tasks_select
  ON public.nm_hub_tasks FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.nm_hub_profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role::text = 'admin'
          OR nm_hub_tasks.assigned_role = p.role::text
          OR nm_hub_tasks.created_by = auth.uid()
        )
    )
  );

CREATE POLICY nm_hub_tasks_insert
  ON public.nm_hub_tasks FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.nm_hub_profiles p
      WHERE p.id = auth.uid()
        AND p.role::text IN ('admin', 'lista_creator', 'taller_1', 'online_1')
    )
    AND assigned_role IN ('online_1', 'taller_1', 'lista_creator')
  );

CREATE POLICY nm_hub_tasks_update
  ON public.nm_hub_tasks FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.nm_hub_profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role::text = 'admin'
          OR nm_hub_tasks.assigned_role = p.role::text
          OR nm_hub_tasks.created_by = auth.uid()
        )
    )
  )
  WITH CHECK (assigned_role IN ('online_1', 'taller_1', 'lista_creator'));

CREATE POLICY nm_hub_tasks_delete
  ON public.nm_hub_tasks FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.nm_hub_profiles p
      WHERE p.id = auth.uid()
        AND (p.role::text = 'admin' OR nm_hub_tasks.created_by = auth.uid())
    )
  );
