import { type FormEvent, useEffect, useId, useState } from 'react'
import {
  normalizeMayoristaPhone,
  upsertMayoristaClient,
  type MayoristaClientInput,
} from '../lib/hubMayoristaClientsApi'

export interface HubMayoristaClientModalProps {
  open: boolean
  busy: boolean
  error: string | null
  onClose: () => void
  onSaved: () => void
}

export function HubMayoristaClientModal({
  open,
  busy,
  error,
  onClose,
  onSaved,
}: HubMayoristaClientModalProps) {
  const titleId = useId()
  const [fullName, setFullName] = useState('')
  const [dni, setDni] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setFullName('')
    setDni('')
    setPhone('')
    setEmail('')
    setAddress('')
    setLocalError(null)
    setSaving(false)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLocalError(null)
    const payload: MayoristaClientInput = {
      full_name: fullName,
      dni: dni.trim(),
      phone,
      email: email.trim(),
      address: address.trim(),
    }
    if (!payload.full_name.trim()) {
      setLocalError('El nombre completo es obligatorio.')
      return
    }
    if (!payload.dni || !payload.phone.trim() || !payload.email || !payload.address) {
      setLocalError('Completá DNI, teléfono, email y dirección.')
      return
    }
    setSaving(true)
    try {
      await upsertMayoristaClient(payload)
      onSaved()
      onClose()
    } catch (err: unknown) {
      setLocalError(err instanceof Error ? err.message : 'No se pudo guardar el cliente.')
    } finally {
      setSaving(false)
    }
  }

  const displayError = localError ?? error
  const disabled = busy || saving

  return (
    <div
      className="upload-images-modal-backdrop quick-add-modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !disabled) onClose()
      }}
    >
      <form
        className="modal-rebel-box quick-add-measure-modal hub-mayorista-client-modal"
        aria-labelledby={titleId}
        aria-modal="true"
        role="dialog"
        onSubmit={(e) => void onSubmit(e)}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="modal-rebel-title" id={titleId}>
          Crear cliente mayorista
        </h3>

        <div className="modal-input-section">
          <label className="modal-section-label" htmlFor={`${titleId}-name`}>
            Nombre completo
          </label>
          <input
            id={`${titleId}-name`}
            className="modal-numeric-input"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="name"
            disabled={disabled}
            required
          />
        </div>

        <div className="modal-input-section">
          <label className="modal-section-label" htmlFor={`${titleId}-dni`}>
            DNI
          </label>
          <input
            id={`${titleId}-dni`}
            className="modal-numeric-input"
            value={dni}
            onChange={(e) => setDni(e.target.value)}
            inputMode="numeric"
            disabled={disabled}
            required
          />
        </div>

        <div className="modal-input-section">
          <label className="modal-section-label" htmlFor={`${titleId}-phone`}>
            Teléfono
          </label>
          <input
            id={`${titleId}-phone`}
            className="modal-numeric-input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={() => setPhone(normalizeMayoristaPhone(phone))}
            inputMode="tel"
            disabled={disabled}
            required
          />
        </div>

        <div className="modal-input-section">
          <label className="modal-section-label" htmlFor={`${titleId}-email`}>
            Email
          </label>
          <input
            id={`${titleId}-email`}
            className="modal-numeric-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            disabled={disabled}
            required
          />
        </div>

        <div className="modal-input-section">
          <label className="modal-section-label" htmlFor={`${titleId}-address`}>
            Dirección de domicilio
          </label>
          <input
            id={`${titleId}-address`}
            className="modal-numeric-input"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            autoComplete="street-address"
            disabled={disabled}
            required
          />
        </div>

        {displayError ? (
          <p className="nm-hub-error" role="alert">
            {displayError}
          </p>
        ) : null}

        <div className="modal-actions-footer">
          <button type="button" className="btn-modal-cancel" disabled={disabled} onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn-modal-add" disabled={disabled}>
            {saving ? 'Guardando…' : 'Guardar cliente'}
          </button>
        </div>
      </form>
    </div>
  )
}
