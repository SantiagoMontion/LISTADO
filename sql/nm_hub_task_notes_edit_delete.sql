-- =============================================================================
-- NOTMID — Editar / eliminar notas de tarea (solo el autor)
-- Ejecutar después de sql/nm_hub_task_notes.sql
-- =============================================================================

DROP POLICY IF EXISTS nm_hub_task_notes_update ON public.nm_hub_task_notes;
CREATE POLICY nm_hub_task_notes_update
  ON public.nm_hub_task_notes FOR UPDATE TO authenticated
  USING (
    author_id = auth.uid()
    AND public.nm_hub_task_note_task_visible(task_id)
  )
  WITH CHECK (
    author_id = auth.uid()
    AND public.nm_hub_task_note_task_visible(task_id)
    AND char_length(trim(body)) > 0
    AND char_length(body) <= 8000
  );

DROP POLICY IF EXISTS nm_hub_task_notes_delete ON public.nm_hub_task_notes;
CREATE POLICY nm_hub_task_notes_delete
  ON public.nm_hub_task_notes FOR DELETE TO authenticated
  USING (
    author_id = auth.uid()
    AND public.nm_hub_task_note_task_visible(task_id)
  );

GRANT UPDATE, DELETE ON public.nm_hub_task_notes TO authenticated;
