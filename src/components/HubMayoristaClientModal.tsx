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
      if (e.key === 'Escape' && !busy && !saving && !deleting) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose, busy, saving, deleting])

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
      className="hub-mayorista-client-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !disabled) onClose()
      }}
    >
      <form
        className="hub-mayorista-client-modal"
        aria-labelledby={titleId}
        aria-modal="true"
        role="dialog"
        onSubmit={(e) => void onSubmit(e)}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="hub-mayorista-client-modal__head">
          <div className="hub-mayorista-client-modal__titles">
            <h2 className="hub-mayorista-client-modal__title" id={titleId}>
              {isEditing ? 'Editar cliente' : 'Nuevo cliente'}
            </h2>
            <p className="hub-mayorista-client-modal__subtitle">Mayorista</p>
          </div>
          <button
            type="button"
            className="hub-mayorista-client-modal__close"
            onClick={onClose}
            disabled={disabled}
            aria-label="Cerrar"
          >
            ✕
          </button>
        </header>

        <div className="hub-mayorista-client-modal__body">
          <div className="hub-mayorista-client-modal__field">
            <label className="hub-mayorista-client-modal__label" htmlFor={`${titleId}-pick`}>
              Cliente
            </label>
            <select
              id={`${titleId}-pick`}
              className="hub-mayorista-client-modal__input"
              value={selectedClientId}
              onChange={(e) => onSelectClient(e.target.value)}
              disabled={disabled || loadingClients}
            >
              <option value="">Nuevo cliente</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.full_name}
                </option>
              ))}
            </select>
          </div>

          <div className="hub-mayorista-client-modal__field">
            <label className="hub-mayorista-client-modal__label" htmlFor={`${titleId}-name`}>
              Nombre completo
            </label>
            <input
              id={`${titleId}-name`}
              className="hub-mayorista-client-modal__input"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoComplete="name"
              disabled={disabled}
              placeholder="Nombre y apellido"
            />
          </div>

          <div className="hub-mayorista-client-modal__row">
            <div className="hub-mayorista-client-modal__field">
              <label className="hub-mayorista-client-modal__label" htmlFor={`${titleId}-dni`}>
                DNI
              </label>
              <input
                id={`${titleId}-dni`}
                className="hub-mayorista-client-modal__input"
                value={dni}
                onChange={(e) => setDni(e.target.value)}
                inputMode="numeric"
                disabled={disabled}
                placeholder="Sin puntos"
              />
            </div>
            <div className="hub-mayorista-client-modal__field">
              <label className="hub-mayorista-client-modal__label" htmlFor={`${titleId}-phone`}>
                Teléfono
              </label>
              <input
                id={`${titleId}-phone`}
                className="hub-mayorista-client-modal__input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onBlur={() => setPhone(normalizeMayoristaPhone(phone))}
                inputMode="tel"
                disabled={disabled}
                placeholder="11 2345 6789"
              />
            </div>
          </div>

          <div className="hub-mayorista-client-modal__field">
            <label className="hub-mayorista-client-modal__label" htmlFor={`${titleId}-email`}>
              Email
            </label>
            <input
              id={`${titleId}-email`}
              className="hub-mayorista-client-modal__input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              disabled={disabled}
              placeholder="correo@ejemplo.com"
            />
          </div>

          <div className="hub-mayorista-client-modal__field">
            <label className="hub-mayorista-client-modal__label" htmlFor={`${titleId}-address`}>
              Dirección
            </label>
            <input
              id={`${titleId}-address`}
              className="hub-mayorista-client-modal__input"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              autoComplete="street-address"
              disabled={disabled}
              placeholder="Calle, número, localidad"
            />
          </div>

          {displayError ? (
            <p className="hub-mayorista-client-modal__error" role="alert">
              {displayError}
            </p>
          ) : null}
        </div>

        <footer className="hub-mayorista-client-modal__actions">
          {isEditing ? (
            <button
              type="button"
              className="hub-mayorista-client-modal__btn-delete"
              disabled={disabled}
              onClick={() => void onDelete()}
            >
              {deleting ? 'Eliminando…' : confirmDelete ? 'Confirmar' : 'Eliminar'}
            </button>
          ) : (
            <span className="hub-mayorista-client-modal__actions-spacer" aria-hidden />
          )}
          <div className="hub-mayorista-client-modal__actions-end">
            <button
              type="button"
              className="hub-mayorista-client-modal__btn-cancel"
              disabled={disabled}
              onClick={onClose}
            >
              Cancelar
            </button>
            <button type="submit" className="hub-mayorista-client-modal__btn-submit" disabled={disabled}>
              {saving ? 'Guardando…' : isEditing ? 'Guardar' : 'Crear'}
            </button>
          </div>
        </footer>
      </form>
    </div>
  )
}
