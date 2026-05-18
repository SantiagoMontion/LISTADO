import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { formatSupabaseOrError } from '../lib/errors'
import {
  createHubTaskNote,
  deleteHubTaskNote,
  fetchHubTaskNotes,
  fetchHubProfileDisplayNames,
  updateHubTaskNote,
} from '../lib/hubTasksApi'
import { supabase } from '../lib/supabase'
import type { NmHubTask, NmHubTaskNote } from '../lib/types'

function formatNoteWhen(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

type TaskNoteItemProps = {
  note: NmHubTaskNote
  authorName: string
  canManage: boolean
  busy: boolean
  onEdit: (noteId: string, body: string) => Promise<void>
  onDelete: (noteId: string) => Promise<void>
}

function TaskNoteItem({ note, authorName, canManage, busy, onEdit, onDelete }: TaskNoteItemProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editDraft, setEditDraft] = useState(note.body)
  const menuWrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const close = (e: MouseEvent) => {
      if (menuWrapRef.current && !menuWrapRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
        setConfirmDelete(false)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpen])

  useEffect(() => {
    if (!editing) setEditDraft(note.body)
  }, [note.body, editing])

  const startEdit = () => {
    setMenuOpen(false)
    setConfirmDelete(false)
    setEditDraft(note.body)
    setEditing(true)
  }

  const cancelEdit = () => {
    setEditing(false)
    setEditDraft(note.body)
  }

  const saveEdit = async (e: FormEvent) => {
    e.preventDefault()
    const text = editDraft.trim()
    if (!text || busy) return
    await onEdit(note.id, text)
    setEditing(false)
  }

  const runDelete = async () => {
    if (busy) return
    setMenuOpen(false)
    setConfirmDelete(false)
    await onDelete(note.id)
  }

  return (
    <article className={`nm-hub-task-note${canManage ? ' nm-hub-task-note--mine' : ''}`}>
      {editing ? (
        <form className="nm-hub-task-note-edit" onSubmit={(e) => void saveEdit(e)}>
          <textarea
            className="nm-hub-input nm-hub-task-notes-input"
            rows={3}
            value={editDraft}
            disabled={busy}
            onChange={(e) => setEditDraft(e.target.value)}
            aria-label="Editar nota"
          />
          <div className="nm-hub-task-note-edit__actions">
            <button type="button" className="nm-hub-btn nm-hub-btn-ghost" disabled={busy} onClick={cancelEdit}>
              Cancelar
            </button>
            <button type="submit" className="nm-hub-btn nm-hub-btn-primary" disabled={busy || !editDraft.trim()}>
              {busy ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="nm-hub-task-note__head">
            <header className="nm-hub-task-note__meta">
              <span className="nm-hub-task-note__author">{authorName}</span>
              <time className="nm-hub-task-note__time" dateTime={note.created_at}>
                {formatNoteWhen(note.created_at)}
              </time>
            </header>
            {canManage ? (
              <div className="nm-hub-task-note__menu-wrap" ref={menuWrapRef}>
                <button
                  type="button"
                  className="nm-hub-task-note__menu-btn"
                  aria-label="Opciones de la nota"
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                  disabled={busy}
                  onClick={() => {
                    setMenuOpen((o) => !o)
                    setConfirmDelete(false)
                  }}
                >
                  ⋯
                </button>
                {menuOpen ? (
                  <div className="nm-hub-task-note-menu" role="menu">
                    {confirmDelete ? (
                      <>
                        <p className="nm-hub-task-note-menu__hint">¿Eliminar esta nota?</p>
                        <button
                          type="button"
                          role="menuitem"
                          className="nm-hub-task-note-menu__item nm-hub-task-note-menu__item--danger"
                          disabled={busy}
                          onClick={() => void runDelete()}
                        >
                          Eliminar
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="nm-hub-task-note-menu__item"
                          disabled={busy}
                          onClick={() => setConfirmDelete(false)}
                        >
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          role="menuitem"
                          className="nm-hub-task-note-menu__item"
                          disabled={busy}
                          onClick={startEdit}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="nm-hub-task-note-menu__item nm-hub-task-note-menu__item--danger"
                          disabled={busy}
                          onClick={() => setConfirmDelete(true)}
                        >
                          Eliminar
                        </button>
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          <p className="nm-hub-task-note__body">{note.body}</p>
        </>
      )}
    </article>
  )
}

export type HubTaskNotesPanelProps = {
  task: NmHubTask
  profileId: string
  onClose: () => void
  onNoteAdded?: () => void
  onNoteRemoved?: () => void
}

export function HubTaskNotesPanel({
  task,
  profileId,
  onClose,
  onNoteAdded,
  onNoteRemoved,
}: HubTaskNotesPanelProps) {
  const [notes, setNotes] = useState<NmHubTaskNote[]>([])
  const [authorNames, setAuthorNames] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const historyPushedRef = useRef(true)

  const scrollToEnd = useCallback(() => {
    const el = threadRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  const loadNotes = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await fetchHubTaskNotes(task.id)
      setNotes(list)
      const ids = [...new Set(list.map((n) => n.author_id))]
      const names = await fetchHubProfileDisplayNames(ids)
      setAuthorNames(names)
    } catch (e: unknown) {
      setError(formatSupabaseOrError(e))
    } finally {
      setLoading(false)
    }
  }, [task.id])

  useEffect(() => {
    void loadNotes()
  }, [loadNotes])

  useEffect(() => {
    if (!loading) scrollToEnd()
  }, [loading, notes.length, scrollToEnd])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  useEffect(() => {
    historyPushedRef.current = true
    history.pushState({ nmHubTaskNotes: task.id }, '')
    const onPop = () => {
      historyPushedRef.current = false
      onClose()
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      if (historyPushedRef.current) {
        historyPushedRef.current = false
        history.back()
      }
    }
  }, [onClose, task.id])

  useEffect(() => {
    const sb = supabase
    if (!sb) return
    const channel = sb
      .channel(`nm_hub_task_notes:${task.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'nm_hub_task_notes', filter: `task_id=eq.${task.id}` },
        () => {
          void loadNotes()
        },
      )
      .subscribe()
    return () => {
      void sb.removeChannel(channel)
    }
  }, [task.id, loadNotes])

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text || saving) return
    setSaving(true)
    setError(null)
    try {
      const created = await createHubTaskNote(task.id, text)
      if (!notes.some((n) => n.id === created.id)) {
        setNotes((prev) => [...prev, created])
      }
      if (!authorNames[created.author_id]) {
        const names = await fetchHubProfileDisplayNames([created.author_id])
        setAuthorNames((prev) => ({ ...prev, ...names }))
      }
      setDraft('')
      onNoteAdded?.()
      requestAnimationFrame(scrollToEnd)
    } catch (err: unknown) {
      setError(formatSupabaseOrError(err))
    } finally {
      setSaving(false)
      textareaRef.current?.focus()
    }
  }

  const handleEdit = async (noteId: string, body: string) => {
    setSaving(true)
    setError(null)
    try {
      const updated = await updateHubTaskNote(noteId, body)
      setNotes((prev) => prev.map((n) => (n.id === noteId ? updated : n)))
    } catch (err: unknown) {
      setError(formatSupabaseOrError(err))
      throw err
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (noteId: string) => {
    setSaving(true)
    setError(null)
    try {
      await deleteHubTaskNote(noteId)
      setNotes((prev) => prev.filter((n) => n.id !== noteId))
      onNoteRemoved?.()
    } catch (err: unknown) {
      setError(formatSupabaseOrError(err))
      throw err
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="nm-hub-task-notes-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="nm-hub-task-notes-panel" role="dialog" aria-modal="true" aria-labelledby="nm-hub-task-notes-title">
        <header className="nm-hub-task-notes-panel__head">
          <button type="button" className="nm-hub-btn nm-hub-btn-ghost nm-hub-task-notes-panel__back" onClick={onClose} aria-label="Volver">
            ←
          </button>
          <div className="nm-hub-task-notes-panel__titles">
            <h2 id="nm-hub-task-notes-title" className="nm-hub-task-notes-panel__title">
              Notas
            </h2>
            <p className="nm-hub-task-notes-panel__subtitle">{task.title}</p>
          </div>
          <button type="button" className="nm-hub-btn nm-hub-btn-primary nm-hub-task-notes-panel__close" onClick={onClose}>
            Cerrar
          </button>
        </header>

        <div ref={threadRef} className="nm-hub-task-notes-thread" aria-live="polite" aria-busy={loading}>
          {loading ? <p className="nm-hub-muted nm-hub-task-notes-empty">Cargando notas…</p> : null}
          {!loading && notes.length === 0 ? (
            <p className="nm-hub-muted nm-hub-task-notes-empty">Todavía no hay notas. Dejá la primera abajo.</p>
          ) : null}
          {!loading
            ? notes.map((n) => (
                <TaskNoteItem
                  key={n.id}
                  note={n}
                  authorName={authorNames[n.author_id] ?? '…'}
                  canManage={n.author_id === profileId}
                  busy={saving}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              ))
            : null}
        </div>

        {error ? (
          <p className="nm-hub-error nm-hub-task-notes-error" role="alert">
            {error}
          </p>
        ) : null}

        <form className="nm-hub-task-notes-compose" onSubmit={(e) => void onSubmit(e)}>
          <label className="nm-hub-sr-only" htmlFor="nm-hub-task-note-draft">
            Nueva nota
          </label>
          <textarea
            id="nm-hub-task-note-draft"
            ref={textareaRef}
            className="nm-hub-input nm-hub-task-notes-input"
            rows={3}
            placeholder="Escribí una nota…"
            value={draft}
            disabled={saving}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="nm-hub-btn nm-hub-btn-primary" disabled={saving || !draft.trim()}>
            {saving ? 'Enviando…' : 'Agregar nota'}
          </button>
        </form>
      </section>
    </div>
  )
}
