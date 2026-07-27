import { type FormEvent, useEffect, useId, useState } from 'react'
import {
  deleteMayoristaClient,
  fetchMayoristaClients,
  normalizeMayoristaPhone,
  saveMayoristaClient,
  type MayoristaClientInput,
} from '../lib/hubMayoristaClientsApi'
import type { NmHubMayoristaClient } from '../lib/types'

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
  const [clients, setClients] = useState<NmHubMayoristaClient[]>([])
  const [loadingClients, setLoadingClients] = useState(false)
  const [selectedClientId, setSelectedClientId] = useState<string>('')
  const [fullName, setFullName] = useState('')
  const [dni, setDni] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!open) return
    setSelectedClientId('')
    setFullName('')
    setDni('')
    setPhone('')
    setEmail('')
    setAddress('')
    setLocalError(null)
    setSaving(false)
    setDeleting(false)
    setConfirmDelete(false)
    setLoadingClients(true)
    void fetchMayoristaClients()
      .then((rows) => setClients(rows))
      .catch(() => setClients([]))
      .finally(() => setLoadingClients(false))
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const applyClientToForm = (client: NmHubMayoristaClient) => {
    setSelectedClientId(client.id)
    setFullName(client.full_name)
    setDni(client.dni)
    setPhone(client.phone)
    setEmail(client.email)
    setAddress(client.address)
    setLocalError(null)
  }

  const onSelectClient = (id: string) => {
    setSelectedClientId(id)
    setConfirmDelete(false)
    if (!id) {
      setFullName('')
      setDni('')
      setPhone('')
      setEmail('')
      setAddress('')
      setLocalError(null)
      return
    }
    const hit = clients.find((c) => c.id === id)
    if (hit) applyClientToForm(hit)
  }

  if (!open) return null

  const onDelete = async () => {
    if (!selectedClientId) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      setLocalError(null)
      return
    }
    setDeleting(true)
    setLocalError(null)
    try {
      await deleteMayoristaClient(selectedClientId)
      onSaved()
      onClose()
    } catch (err: unknown) {
      setLocalError(err instanceof Error ? err.message : 'No se pudo eliminar el cliente.')
      setConfirmDelete(false)
    } finally {
      setDeleting(false)
    }
  }

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
      await saveMayoristaClient(payload, selectedClientId || null)
      onSaved()
      onClose()
    } catch (err: unknown) {
      setLocalError(err instanceof Error ? err.message : 'No se pudo guardar el cliente.')
    } finally {
      setSaving(false)
    }
  }

  const displayError = localError ?? error
  const disabled = busy || saving || deleting
  const isEditing = Boolean(selectedClientId)

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
          {isEditing ? 'Modificar cliente mayorista' : 'Nuevo cliente mayorista'}
        </h3>

        <div className="modal-input-section">
          <label className="modal-section-label" htmlFor={`${titleId}-pick`}>
            Cliente
          </label>
          <select
            id={`${titleId}-pick`}
            className="modal-numeric-input"
            value={selectedClientId}
            onChange={(e) => onSelectClient(e.target.value)}
            disabled={disabled || loadingClients}
          >
            <option value="">— Nuevo cliente —</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.full_name}
              </option>
            ))}
          </select>
        </div>

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
          {isEditing ? (
            <button
              type="button"
              className="btn-modal-cancel hub-mayorista-client-modal__delete"
              disabled={disabled}
              onClick={() => void onDelete()}
            >
              {deleting
                ? 'Eliminando…'
                : confirmDelete
                  ? 'Confirmar eliminar'
                  : 'Eliminar cliente'}
            </button>
          ) : null}
          <button type="submit" className="btn-modal-add" disabled={disabled}>
            {saving ? 'Guardando…' : isEditing ? 'Guardar cambios' : 'Crear cliente'}
          </button>
        </div>
      </form>
    </div>
  )
}
