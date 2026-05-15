import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type Dispatch, type SetStateAction } from 'react'
import { normalizeCalendarDate, todayIsoLocal } from '../lib/date'
import { formatSupabaseOrError } from '../lib/errors'
import { NM_PROD_MATERIAL_FAMILY_LABEL, parseMaterialFamilyFromFilename, uploadMaterialDayImages } from '../lib/nmProdMaterialImages'
import type { NmProdMaterialFamily } from '../lib/types'

type PendingRow = { localId: string; file: File; family: NmProdMaterialFamily; objectUrl: string }

function appendFilesToRows(
  files: File[],
  setRows: Dispatch<SetStateAction<PendingRow[]>>,
  setError: Dispatch<SetStateAction<string | null>>,
) {
  const picked = files.filter((f) => f.type.startsWith('image/'))
  if (picked.length === 0) return
  const invalid: string[] = []
  const toAdd: PendingRow[] = []
  for (const file of picked) {
    const fam = parseMaterialFamilyFromFilename(file.name)
    if (!fam) invalid.push(file.name)
    else {
      toAdd.push({
        localId: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
        file,
        family: fam,
        objectUrl: URL.createObjectURL(file),
      })
    }
  }
  if (invalid.length > 0) {
    setError(
      invalid.length === 1
        ? `No se reconoce el material en «${invalid[0]}». El nombre debe empezar con Classic, PRO, Ultra o Alfombra (ej. Classic1, PRO2).`
        : `No se reconoce el material en ${invalid.length} archivos. Ejemplos: Classic1, PRO1, Ultra1, Alfombra1.`,
    )
  } else {
    setError(null)
  }
  if (toAdd.length > 0) setRows((prev) => [...prev, ...toAdd])
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
  const fileInputRef = useRef<HTMLInputElement>(null)

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
    appendFilesToRows(list, setRows, setError)
    e.target.value = ''
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
      setError('Agregá al menos una imagen con Examinar.')
      return
    }
    setBusy(true)
    try {
      await uploadMaterialDayImages(
        day,
        rows.map((r) => ({ file: r.file, family: r.family })),
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
          ref={fileInputRef}
          type="file"
          className="nm-hub-sr-only"
          accept="image/*"
          multiple
          disabled={!configured || busy}
          onChange={onFileInput}
        />
        <div className="nm-prod-material-img-modal-actions">
          <button
            type="button"
            className="nm-prod-btn nm-prod-btn-primary nm-prod-material-img-examinar"
            disabled={!configured || busy}
            onClick={() => fileInputRef.current?.click()}
          >
            Examinar
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
                  <span className="nm-prod-material-img-preview-family">{NM_PROD_MATERIAL_FAMILY_LABEL[r.family]}</span>
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
