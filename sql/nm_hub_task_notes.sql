-- =============================================================================
-- NOTMID — Notas de texto en tareas del hub
-- Ejecutar en SQL Editor después de sql/nm_hub_tasks_assigned_admin.sql
-- (requiere nm_hub_task_row_visible).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.nm_hub_task_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.nm_hub_tasks (id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES public.nm_hub_profiles (id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(trim(body)) > 0 AND char_length(body) <= 8000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nm_hub_task_notes_task_created
  ON public.nm_hub_task_notes (task_id, created_at ASC);

COMMENT ON TABLE public.nm_hub_task_notes IS
  'Notas de texto en tareas; visibles para quien puede ver la tarea.';

-- -----------------------------------------------------------------------------
-- Visibilidad = misma que la tarea padre
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nm_hub_task_note_task_visible(p_task_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.nm_hub_tasks t
    WHERE t.id = p_task_id
      AND public.nm_hub_task_row_visible(t.assigned_role::text, t.created_by)
  );
$$;

REVOKE ALL ON FUNCTION public.nm_hub_task_note_task_visible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nm_hub_task_note_task_visible(uuid) TO authenticated;

ALTER TABLE public.nm_hub_task_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nm_hub_task_notes_select ON public.nm_hub_task_notes;
CREATE POLICY nm_hub_task_notes_select
  ON public.nm_hub_task_notes FOR SELECT TO authenticated
  USING (public.nm_hub_task_note_task_visible(task_id));

DROP POLICY IF EXISTS nm_hub_task_notes_insert ON public.nm_hub_task_notes;
CREATE POLICY nm_hub_task_notes_insert
  ON public.nm_hub_task_notes FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND public.nm_hub_task_note_task_visible(task_id)
  );

DROP POLICY IF EXISTS nm_hub_task_notes_update ON public.nm_hub_task_notes;
CREATE POLICY nm_hub_task_notes_update
  ON public.nm_hub_task_notes FOR UPDATE TO authenticated
  USING (author_id = auth.uid() AND public.nm_hub_task_note_task_visible(task_id))
  WITH CHECK (
    author_id = auth.uid()
    AND public.nm_hub_task_note_task_visible(task_id)
    AND char_length(trim(body)) > 0
    AND char_length(body) <= 8000
  );

DROP POLICY IF EXISTS nm_hub_task_notes_delete ON public.nm_hub_task_notes;
CREATE POLICY nm_hub_task_notes_delete
  ON public.nm_hub_task_notes FOR DELETE TO authenticated
  USING (author_id = auth.uid() AND public.nm_hub_task_note_task_visible(task_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.nm_hub_task_notes TO authenticated;

-- Realtime opcional (actualización entre dispositivos con el panel abierto)
ALTER TABLE public.nm_hub_task_notes REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.nm_hub_task_notes;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
