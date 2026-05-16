-- =============================================================================
-- NOTMID — Permitir assigned_role = 'admin' (solo admin puede insertar admin)
-- Ejecutar en SQL Editor (Supabase) tras nm_hub_online_1_roles_task_assign.sql
-- =============================================================================

ALTER TABLE public.nm_hub_tasks DROP CONSTRAINT IF EXISTS nm_hub_tasks_assigned_role_check;
ALTER TABLE public.nm_hub_tasks
  ADD CONSTRAINT nm_hub_tasks_assigned_role_check
  CHECK (assigned_role IN ('online_1', 'taller_1', 'lista_creator', 'admin'));

COMMENT ON COLUMN public.nm_hub_tasks.assigned_role IS
  'Rol hub destinatario. admin = bandeja del administrador (solo él puede asignarse).';

DROP POLICY IF EXISTS nm_hub_tasks_insert ON public.nm_hub_tasks;
CREATE POLICY nm_hub_tasks_insert
  ON public.nm_hub_tasks FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.nm_hub_profiles p
      WHERE p.id = auth.uid()
        AND p.role::text IN ('admin', 'lista_creator', 'taller_1', 'online_1')
    )
    AND (
      assigned_role IN ('online_1', 'taller_1', 'lista_creator')
      OR (
        assigned_role = 'admin'
        AND EXISTS (
          SELECT 1 FROM public.nm_hub_profiles p
          WHERE p.id = auth.uid() AND p.role::text = 'admin'
        )
      )
    )
  );

DROP POLICY IF EXISTS nm_hub_tasks_update ON public.nm_hub_tasks;
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
  WITH CHECK (
    assigned_role IN ('online_1', 'taller_1', 'lista_creator')
    OR (
      assigned_role = 'admin'
      AND EXISTS (
        SELECT 1 FROM public.nm_hub_profiles p
        WHERE p.id = auth.uid() AND p.role::text = 'admin'
      )
    )
  );
