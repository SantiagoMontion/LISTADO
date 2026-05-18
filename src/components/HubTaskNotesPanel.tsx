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
            className="field-textarea nm-hub-textarea nm-hub-task-notes-field"
            rows={3}
            value={editDraft}
            disabled={busy}
            onChange={(e) => setEditDraft(e.target.value)}
            aria-label="Editar nota"
          />
          <div className="modal-actions-row nm-hub-task-note-edit__actions">
            <button type="button" className="btn-modal-cancel" disabled={busy} onClick={cancelEdit}>
              Cancelar
            </button>
            <button type="submit" className="btn-modal-submit-active" disabled={busy || !editDraft.trim()}>
              {busy ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="nm-hub-task-note__head">
            <p className="nm-hub-task-note__meta-line task-meta-log">
              <span className="task-assignee-chip nm-hub-task-note__author">{authorName}</span>
              <span className="nm-hub-task-note__time-sep" aria-hidden="true">
                {' · '}
              </span>
              <time className="nm-hub-task-note__time" dateTime={note.created_at}>
                {formatNoteWhen(note.created_at)}
              </time>
            </p>
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
          <p className="nm-hub-task-note__body task-description-text">{note.body}</p>
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
  const initialLoadDoneRef = useRef(false)
  const skipRealtimeUntilRef = useRef(0)

  const scrollToEnd = useCallback(() => {
    const el = threadRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  const markLocalNoteMutation = useCallback(() => {
    skipRealtimeUntilRef.current = Date.now() + 2500
  }, [])

  const loadNotes = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? initialLoadDoneRef.current
      const el = threadRef.current
      const prevScrollTop = el?.scrollTop ?? 0
      const wasNearEnd = el ? el.scrollHeight - el.scrollTop - el.clientHeight < 80 : true

      if (!silent) setLoading(true)
      setError(null)
      try {
        const list = await fetchHubTaskNotes(task.id)
        setNotes(list)
        const ids = [...new Set(list.map((n) => n.author_id))]
        const names = await fetchHubProfileDisplayNames(ids)
        setAuthorNames(names)
        initialLoadDoneRef.current = true

        requestAnimationFrame(() => {
          const box = threadRef.current
          if (!box) return
          if (!silent) {
            scrollToEnd()
            return
          }
          if (wasNearEnd) {
            box.scrollTop = box.scrollHeight
          } else {
            box.scrollTop = prevScrollTop
          }
        })
      } catch (e: unknown) {
        setError(formatSupabaseOrError(e))
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [task.id, scrollToEnd],
  )

  useEffect(() => {
    initialLoadDoneRef.current = false
    void loadNotes({ silent: false })
  }, [task.id, loadNotes])

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
          if (Date.now() < skipRealtimeUntilRef.current) return
          void loadNotes({ silent: true })
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
      markLocalNoteMutation()
      const created = await createHubTaskNote(task.id, text)
      setNotes((prev) => (prev.some((n) => n.id === created.id) ? prev : [...prev, created]))
      if (!authorNames[created.author_id]) {
        const names = await fetchHubProfileDisplayNames([created.author_id])
        setAuthorNames((prev) => ({ ...prev, ...names }))
      }
      setDraft('')
      onNoteAdded?.()
      requestAnimationFrame(() => {
        scrollToEnd()
        textareaRef.current?.focus({ preventScroll: true })
      })
    } catch (err: unknown) {
      setError(formatSupabaseOrError(err))
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = async (noteId: string, body: string) => {
    setSaving(true)
    setError(null)
    try {
      markLocalNoteMutation()
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
      markLocalNoteMutation()
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
    <div
      className="upload-images-modal-backdrop nm-hub-task-notes-backdrop"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        className="upload-images-modal nm-hub-task-notes-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nm-hub-task-notes-title"
      >
        <header className="nm-hub-task-notes-panel__head">
          <div className="nm-hub-task-notes-panel__titles">
            <h2 id="nm-hub-task-notes-title" className="modal-title-rebel">
              Notas
            </h2>
            <p className="nm-hub-task-notes-panel__subtitle">{task.title}</p>
          </div>
          <button
            type="button"
            className="pager-tactic-btn nm-hub-task-notes-panel__close-icon"
            onClick={onClose}
            aria-label="Cerrar"
          >
            ×
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

        <form className="nm-hub-task-notes-compose modal-field-group" onSubmit={(e) => void onSubmit(e)}>
          <label className="modal-field-label" htmlFor="nm-hub-task-note-draft">
            Nueva nota
          </label>
          <textarea
            id="nm-hub-task-note-draft"
            ref={textareaRef}
            className="field-textarea nm-hub-textarea nm-hub-task-notes-field"
            rows={3}
            placeholder="Escribí una nota…"
            value={draft}
            disabled={saving}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="modal-actions-row">
            <button type="button" className="btn-modal-cancel" disabled={saving} onClick={onClose}>
              Cerrar
            </button>
            <button type="submit" className="btn-modal-submit-active" disabled={saving || !draft.trim()}>
              {saving ? 'Enviando…' : 'Agregar nota'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
