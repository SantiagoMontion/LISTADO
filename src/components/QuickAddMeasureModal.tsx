import { useEffect, useId, useState } from 'react'
import type { MaterialTab } from '../lib/types'

export const QUICK_ADD_MATERIAL_OPTIONS = [
  'Classic',
  'PRO',
  'Alfombra',
  'Falta',
  'Rectos',
  'Mayorista',
] as const
export type QuickAddMaterialOption = (typeof QUICK_ADD_MATERIAL_OPTIONS)[number]

export function mapQuickAddOption(option: QuickAddMaterialOption): {
  materialType: MaterialTab
  from_faltas: boolean
  is_priority: boolean
} {
  switch (option) {
    case 'Classic':
      return { materialType: 'classic', from_faltas: false, is_priority: false }
    case 'PRO':
      return { materialType: 'pro', from_faltas: false, is_priority: false }
    case 'Alfombra':
      return { materialType: 'alfombras', from_faltas: false, is_priority: false }
    case 'Rectos':
      return { materialType: 'bordes_rectos', from_faltas: false, is_priority: false }
    case 'Mayorista':
      return { materialType: 'mayorista', from_faltas: false, is_priority: false }
    case 'Falta':
      return { materialType: 'classic', from_faltas: true, is_priority: true }
  }
}

export function sanitizeQuickDimensionInput(value: string): string {
  let out = ''
  for (const ch of value) {
    if (ch >= '0' && ch <= '9') out += ch
    else if ((ch === 'x' || ch === 'X' || ch === '×') && out.length > 0 && !out.endsWith('x')) out += 'x'
  }
  return out
}

export function sanitizeQuickQuantityInput(value: string): string {
  return value.replace(/\D/g, '').slice(0, 4)
}

export function parseQuickDimensions(raw: string): string | null {
  const m = raw.trim().match(/^(\d+)x(\d+)$/)
  if (!m) return null
  const width = Number(m[1])
  const height = Number(m[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  return `${width}x${height}`
}

export function parseQuickQuantity(raw: string): number | null {
  const n = Number(raw.trim())
  if (!Number.isFinite(n) || n < 1 || n > 9999 || !Number.isInteger(n)) return null
  return n
}

interface QuickAddMeasureModalProps {
  open: boolean
  dayLabel: string
  loading: boolean
  error: string | null
  onClose: () => void
  onConfirm: (payload: {
    dimensions: string
    materialType: MaterialTab
    from_faltas: boolean
    is_priority: boolean
    total_qty: number
  }) => void
}

export function QuickAddMeasureModal({
  open,
  dayLabel,
  loading,
  error,
  onClose,
  onConfirm,
}: QuickAddMeasureModalProps) {
  const titleId = useId()
  const inputId = useId()
  const qtyInputId = useId()
  const [selectedType, setSelectedType] = useState<QuickAddMaterialOption | null>(null)
  const [dimensionInput, setDimensionInput] = useState('')
  const [quantityInput, setQuantityInput] = useState('')

  const isMayorista = selectedType === 'Mayorista'

  useEffect(() => {
    if (!open) return
    setSelectedType(null)
    setDimensionInput('')
    setQuantityInput('')
  }, [open])

  if (!open) return null

  const dimensions = parseQuickDimensions(dimensionInput)
  const parsedQty = isMayorista ? parseQuickQuantity(quantityInput) : 1
  const canSubmit = selectedType !== null && dimensions !== null && parsedQty !== null && !loading

  return (
    <div
      className="upload-images-modal-backdrop quick-add-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && !loading && onClose()}
    >
      <section
        className="modal-rebel-box quick-add-measure-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h3 className="modal-rebel-title" id={titleId}>
          Agregar medida al día {dayLabel}
        </h3>

        <div className="modal-filter-section">
          <span className="modal-section-label">Seleccionar tipo</span>
          <div className="modal-pill-grid" role="group" aria-label="Tipo de material">
            {QUICK_ADD_MATERIAL_OPTIONS.map((type) => (
              <button
                key={type}
                type="button"
                className={`modal-type-pill${selectedType === type ? ' active' : ''}`}
                aria-pressed={selectedType === type}
                disabled={loading}
                onClick={() => {
                  setSelectedType(type)
                  if (type !== 'Mayorista') setQuantityInput('')
                }}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        <div className="modal-input-section">
          <label className="modal-section-label" htmlFor={inputId}>
            Medida (ancho x alto)
          </label>
          <input
            id={inputId}
            type="text"
            inputMode="numeric"
            className="modal-numeric-input"
            placeholder="Ej: 90x40"
            value={dimensionInput}
            disabled={loading}
            autoFocus
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setDimensionInput(sanitizeQuickDimensionInput(e.target.value))}
          />
        </div>

        {isMayorista ? (
          <div className="modal-input-section">
            <label className="modal-section-label" htmlFor={qtyInputId}>
              Cantidad
            </label>
            <input
              id={qtyInputId}
              type="text"
              inputMode="numeric"
              className="modal-numeric-input"
              placeholder="Ej: 5"
              value={quantityInput}
              disabled={loading}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setQuantityInput(sanitizeQuickQuantityInput(e.target.value))}
            />
          </div>
        ) : null}

        {error ? (
          <p className="quick-add-measure-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="modal-actions-footer">
          <button type="button" className="btn-modal-cancel" disabled={loading} onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn-modal-add"
            disabled={!canSubmit}
            onClick={() => {
              if (!selectedType || !dimensions || parsedQty === null) return
              const mapped = mapQuickAddOption(selectedType)
              onConfirm({
                dimensions,
                materialType: mapped.materialType,
                from_faltas: mapped.from_faltas,
                is_priority: mapped.is_priority,
                total_qty: parsedQty,
              })
            }}
          >
            {loading ? 'Guardando…' : 'Agregar'}
          </button>
        </div>
      </section>
    </div>
  )
}
