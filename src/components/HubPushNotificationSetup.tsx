import { useCallback, useEffect, useState } from 'react'
import { formatSupabaseOrError } from '../lib/errors'
import {
  disableHubPushNotifications,
  enableHubPushNotifications,
  getHubPushSupport,
  getNotificationPermission,
  isHubPushEnabledLocally,
} from '../lib/hubPushNotifications'

type Props = {
  userId: string
  compact?: boolean
}

export function HubPushNotificationSetup({ userId, compact = false }: Props) {
  const support = getHubPushSupport()
  const [permission, setPermission] = useState(getNotificationPermission())
  const [enabled, setEnabled] = useState(isHubPushEnabledLocally())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    setPermission(getNotificationPermission())
    setEnabled(isHubPushEnabledLocally())
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  if (!support.supported) {
    if (support.reason === 'no-vapid') return null
    return (
      <p className={`nm-hub-push-setup${compact ? ' nm-hub-push-setup--compact' : ''}`}>
        <span className="nm-hub-muted">Este navegador no admite avisos en el celular.</span>
      </p>
    )
  }

  const onEnable = async () => {
    setBusy(true)
    setError(null)
    try {
      const perm = await enableHubPushNotifications(userId)
      setPermission(perm)
      if (perm !== 'granted') {
        setError('Permiso denegado. En Ajustes del teléfono podés habilitar notificaciones para este sitio.')
      }
      refresh()
    } catch (e: unknown) {
      setError(formatSupabaseOrError(e))
    } finally {
      setBusy(false)
    }
  }

  const onDisable = async () => {
    setBusy(true)
    setError(null)
    try {
      await disableHubPushNotifications(userId)
      refresh()
    } catch (e: unknown) {
      setError(formatSupabaseOrError(e))
    } finally {
      setBusy(false)
    }
  }

  const active = permission === 'granted' && enabled

  return (
    <section
      className={`nm-hub-push-setup${compact ? ' nm-hub-push-setup--compact' : ''}`}
      aria-label="Notificaciones de tareas"
    >
      <div className="nm-hub-push-setup__inner">
        <div className="nm-hub-push-setup__copy">
          <p className="nm-hub-push-setup__title">Avisos en el celular</p>
          {!compact ? (
            <p className="nm-hub-muted nm-hub-push-setup__hint">
              Cuando te asignen una tarea, sonará una notificación. En iPhone: agregá el sitio a la pantalla de inicio
              y activá avisos aquí.
            </p>
          ) : null}
        </div>
        <div className="nm-hub-push-setup__actions">
          {active ? (
            <button
              type="button"
              className="nm-hub-btn nm-hub-btn-ghost nm-hub-push-setup__btn"
              disabled={busy}
              onClick={() => void onDisable()}
            >
              {busy ? '…' : 'Desactivar avisos'}
            </button>
          ) : (
            <button
              type="button"
              className="nm-hub-btn nm-hub-btn-primary nm-hub-push-setup__btn"
              disabled={busy || permission === 'denied'}
              onClick={() => void onEnable()}
            >
              {busy ? 'Activando…' : 'Activar avisos'}
            </button>
          )}
        </div>
      </div>
      {permission === 'denied' ? (
        <p className="nm-hub-push-setup__warn" role="status">
          Bloqueadas en el navegador. Abrí la configuración del sitio y permití notificaciones.
        </p>
      ) : null}
      {error ? (
        <p className="nm-hub-error nm-hub-push-setup__error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}
