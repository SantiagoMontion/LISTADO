import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type Dispatch, type SetStateAction } from 'react'
import { normalizeCalendarDate, todayIsoLocal } from '../lib/date'
import { formatSupabaseOrError } from '../lib/errors'
import {
  NM_PROD_MATERIAL_FAMILIES,
  NM_PROD_MATERIAL_FAMILY_LABEL,
  parseMaterialFamilyFromFilename,
  uploadMaterialDayImages,
} from '../lib/nmProdMaterialImages'
import type { NmProdMaterialFamily } from '../lib/types'

type PendingRow = { localId: string; file: File; family: NmProdMaterialFamily | null; objectUrl: string }

function appendFilesToRows(files: File[], setRows: Dispatch<SetStateAction<PendingRow[]>>) {
  const picked = files.filter((f) => f.type.startsWith('image/'))
  if (picked.length === 0) return
  setRows((prev) => [
    ...prev,
    ...picked.map((file) => ({
      localId: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
      file,
      family: parseMaterialFamilyFromFilename(file.name),
      objectUrl: URL.createObjectURL(file),
    })),
  ])
}

interface CreadorMaterialImagesModalProps {
  open: boolean
  configured: boolean
  onClose: () => void
  onDone: (message: string) => void
}

export function CreadorMaterialImagesModal({ open, configured, onClose, onDone }: CreadorMaterialImagesModalProps) {
  const titleId = useId()
  const [fecha, setFecha] = useState(todayIsoLocal)
  const [rows, setRows] = useState<PendingRow[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  const handleClose = useCallback(() => {
    setRows((prev) => {
      for (const r of prev) URL.revokeObjectURL(r.objectUrl)
      return []
    })
    onClose()
  }, [onClose])

  useEffect(() => {
    if (!open) return
    setFecha(todayIsoLocal())
    setError(null)
    setBusy(false)
    setRows((prev) => {
      for (const r of prev) URL.revokeObjectURL(r.objectUrl)
      return []
    })
  }, [open])

  const onFileInput = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files ? Array.from(e.target.files) : []
    appendFilesToRows(list, setRows)
    e.target.value = ''
  }, [])

  const setFamily = useCallback((localId: string, family: NmProdMaterialFamily | null) => {
    setRows((prev) => prev.map((r) => (r.localId === localId ? { ...r, family } : r)))
  }, [])

  const removeRow = useCallback((localId: string) => {
    setRows((prev) => {
      const row = prev.find((r) => r.localId === localId)
      if (row) URL.revokeObjectURL(row.objectUrl)
      return prev.filter((r) => r.localId !== localId)
    })
  }, [])

  const submit = useCallback(async () => {
    setError(null)
    const day = normalizeCalendarDate(fecha)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      setError('Elegí una fecha válida.')
      return
    }
    if (rows.length === 0) {
      setError('Agregá al menos una imagen.')
      return
    }
    const missing = rows.filter((r) => !r.family)
    if (missing.length > 0) {
      setError(
        `En ${missing.length} archivo(s) no se detectó el material por nombre. Elegí Classic, PRO, Ultra o Alfombra en la lista de cada uno.`,
      )
      return
    }
    setBusy(true)
    try {
      await uploadMaterialDayImages(
        day,
        rows.map((r) => ({ file: r.file, family: r.family as NmProdMaterialFamily })),
      )
      onDone(`Se subieron ${rows.length} imagen(es) para el ${day}.`)
      for (const r of rows) URL.revokeObjectURL(r.objectUrl)
      setRows([])
      onClose()
    } catch (e: unknown) {
      setError(formatSupabaseOrError(e))
    } finally {
      setBusy(false)
    }
  }, [fecha, rows, onClose, onDone])

  if (!open) return null

  return (
    <div className="nm-prod-modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && handleClose()}>
      <section
        className="nm-prod-modal nm-prod-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h3 className="nm-prod-modal-title" id={titleId}>
          Subir imágenes
        </h3>
        <p className="nm-prod-modal-text" style={{ marginBottom: '0.65rem' }}>
          Todas se guardan para el día elegido. El nombre debe empezar con Classic, PRO, Ultra o Alfombra (el número no importa), o podés elegir el tipo abajo.
        </p>
        <label className="nm-prod-label" htmlFor="nm-prod-material-img-date" style={{ display: 'block', marginBottom: '0.35rem' }}>
          Día
        </label>
        <input
          id="nm-prod-material-img-date"
          type="date"
          className="nm-prod-modal-input"
          style={{ minHeight: '2.5rem', marginBottom: '0.85rem' }}
          value={fecha}
          disabled={!configured || busy}
          onChange={(e) => setFecha(e.target.value)}
        />

        <input
          ref={galleryRef}
          type="file"
          className="nm-hub-sr-only"
          accept="image/*"
          multiple
          disabled={!configured || busy}
          onChange={onFileInput}
        />
        <input
          ref={cameraRef}
          type="file"
          className="nm-hub-sr-only"
          accept="image/*"
          capture="environment"
          disabled={!configured || busy}
          onChange={onFileInput}
        />
        <div className="nm-prod-material-img-modal-actions" role="group" aria-label="Agregar imágenes">
          <button
            type="button"
            className="nm-prod-btn nm-prod-btn-primary"
            disabled={!configured || busy}
            onClick={() => galleryRef.current?.click()}
          >
            Galería
          </button>
          <button type="button" className="nm-prod-btn" disabled={!configured || busy} onClick={() => cameraRef.current?.click()}>
            Cámara
          </button>
        </div>

        {rows.length > 0 ? (
          <ul className="nm-prod-material-img-preview-list" aria-label="Imágenes a subir">
            {rows.map((r) => (
              <li key={r.localId} className="nm-prod-material-img-preview-item">
                <div className="nm-prod-material-img-preview-thumb-wrap">
                  <img src={r.objectUrl} alt="" className="nm-prod-material-img-preview-thumb" />
                </div>
                <div className="nm-prod-material-img-preview-meta">
                  <span className="nm-prod-material-img-preview-name" title={r.file.name}>
                    {r.file.name}
                  </span>
                  <label className="nm-prod-material-img-preview-label">
                    Material
                    <select
                      className="nm-prod-select"
                      value={r.family ?? ''}
                      disabled={busy}
                      onChange={(e) => {
                        const v = e.target.value
                        setFamily(r.localId, v ? (v as NmProdMaterialFamily) : null)
                      }}
                    >
                      <option value="">Detectar por nombre / elegir</option>
                      {NM_PROD_MATERIAL_FAMILIES.map((f) => (
                        <option key={f} value={f}>
                          {NM_PROD_MATERIAL_FAMILY_LABEL[f]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="nm-prod-btn nm-prod-material-img-remove"
                    disabled={busy}
                    onClick={() => removeRow(r.localId)}
                  >
                    Quitar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="nm-prod-task-meta" style={{ marginTop: '0.75rem' }}>
            Todavía no agregaste imágenes.
          </p>
        )}

        {error ? (
          <p className="nm-prod-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="nm-prod-row" style={{ marginTop: '1rem' }}>
          <button type="button" className="nm-prod-btn" disabled={busy} onClick={handleClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="nm-prod-btn nm-prod-btn-primary"
            disabled={busy || !configured || rows.length === 0}
            onClick={() => void submit()}
          >
            {busy ? 'Subiendo…' : 'Subir todas'}
          </button>
        </div>
      </section>
    </div>
  )
}
