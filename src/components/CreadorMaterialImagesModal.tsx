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

type PendingRow = {
  localId: string
  file: File
  family: NmProdMaterialFamily
  objectUrl: string
  inferred: boolean
}

function appendFilesToRows(
  files: File[],
  defaultFamily: NmProdMaterialFamily,
  setRows: Dispatch<SetStateAction<PendingRow[]>>,
  setError: Dispatch<SetStateAction<string | null>>,
) {
  const picked = files.filter((f) => f.type.startsWith('image/'))
  if (picked.length === 0) return
  const manualNames: string[] = []
  const toAdd: PendingRow[] = []
  for (const file of picked) {
    const inferred = parseMaterialFamilyFromFilename(file.name)
    const fam = inferred ?? defaultFamily
    if (!inferred) manualNames.push(file.name)
    toAdd.push({
      localId: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
      file,
      family: fam,
      objectUrl: URL.createObjectURL(file),
      inferred: inferred !== null,
    })
  }
  if (manualNames.length > 0) {
    setError(
      manualNames.length === 1
        ? `«${manualNames[0]}» se asignó a ${NM_PROD_MATERIAL_FAMILY_LABEL[defaultFamily]}. Cambiá el material abajo si hace falta.`
        : `${manualNames.length} archivos sin material en el nombre se asignaron a ${NM_PROD_MATERIAL_FAMILY_LABEL[defaultFamily]}. Revisá o cambiá el material de cada uno.`,
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
  const defaultFamilyId = useId()
  const [fecha, setFecha] = useState(todayIsoLocal)
  const [defaultFamily, setDefaultFamily] = useState<NmProdMaterialFamily>('classic')
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
    setDefaultFamily('classic')
    setError(null)
    setBusy(false)
    setRows((prev) => {
      for (const r of prev) URL.revokeObjectURL(r.objectUrl)
      return []
    })
  }, [open])

  const onFileInput = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const list = e.target.files ? Array.from(e.target.files) : []
      appendFilesToRows(list, defaultFamily, setRows, setError)
      e.target.value = ''
    },
    [defaultFamily],
  )

  const setRowFamily = useCallback((localId: string, family: NmProdMaterialFamily) => {
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

  const canSubmit = configured && rows.length > 0 && !busy

  if (!open) return null

  return (
    <div
      className="upload-images-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && handleClose()}
    >
      <section
        className="upload-images-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h3 className="modal-title-rebel" id={titleId}>
          Subir imágenes
        </h3>

        <div className="modal-field-group">
          <label className="modal-field-label" htmlFor="nm-prod-material-img-date">
            Día
          </label>
          <input
            id="nm-prod-material-img-date"
            type="date"
            className="modal-date-input"
            value={fecha}
            disabled={!configured || busy}
            onChange={(e) => setFecha(e.target.value)}
          />
        </div>

        <input
          ref={fileInputRef}
          type="file"
          className="nm-hub-sr-only"
          accept="image/*"
          multiple
          disabled={!configured || busy}
          onChange={onFileInput}
        />
        <button
          type="button"
          className="btn-browse-rebel"
          disabled={!configured || busy}
          onClick={() => fileInputRef.current?.click()}
        >
          Examinar
        </button>

        <div className="modal-field-group">
          <label className="modal-field-label" htmlFor={defaultFamilyId}>
            Material por defecto
          </label>
          <p className="upload-images-hint">
            Si el nombre no incluye Classic, PRO, Ultra, Alfombra o FALTAS, se usa este material.
          </p>
          <select
            id={defaultFamilyId}
            className="modal-family-select"
            value={defaultFamily}
            disabled={!configured || busy}
            onChange={(e) => setDefaultFamily(e.target.value as NmProdMaterialFamily)}
          >
            {NM_PROD_MATERIAL_FAMILIES.map((fam) => (
              <option key={fam} value={fam}>
                {NM_PROD_MATERIAL_FAMILY_LABEL[fam]}
              </option>
            ))}
          </select>
        </div>

        {rows.length > 0 ? (
          <>
            <p className="upload-status-text upload-status-text--active">
              {rows.length} imagen{rows.length === 1 ? '' : 'es'} lista{rows.length === 1 ? '' : 's'} para subir
            </p>
            <ul className="upload-images-preview-list" aria-label="Imágenes a subir">
              {rows.map((r) => (
                <li key={r.localId} className="upload-images-preview-item">
                  <div className="upload-images-preview-thumb-wrap">
                    <img src={r.objectUrl} alt="" className="upload-images-preview-thumb" />
                  </div>
                  <div className="upload-images-preview-meta">
                    <label className="upload-images-preview-family-label">
                      <span className="nm-hub-sr-only">Material de {r.file.name}</span>
                      <select
                        className="upload-images-preview-family-select"
                        value={r.family}
                        disabled={busy}
                        aria-label={`Material de ${r.file.name}`}
                        onChange={(e) => setRowFamily(r.localId, e.target.value as NmProdMaterialFamily)}
                      >
                        {NM_PROD_MATERIAL_FAMILIES.map((fam) => (
                          <option key={fam} value={fam}>
                            {NM_PROD_MATERIAL_FAMILY_LABEL[fam]}
                          </option>
                        ))}
                      </select>
                    </label>
                    {!r.inferred ? (
                      <span className="upload-images-preview-manual" title="Material asignado manualmente">
                        Manual
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className="upload-images-preview-remove"
                      disabled={busy}
                      onClick={() => removeRow(r.localId)}
                    >
                      Quitar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="upload-status-text">Todavía no agregaste imágenes.</p>
        )}

        {error ? (
          <p className="upload-images-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="modal-actions-row">
          <button type="button" className="btn-modal-cancel" disabled={busy} onClick={handleClose}>
            Cancelar
          </button>
          <button
            type="button"
            className={canSubmit ? 'btn-modal-submit-active' : 'btn-modal-submit-inactive'}
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {busy ? 'Subiendo…' : 'Subir todas'}
          </button>
        </div>
      </section>
    </div>
  )
}
