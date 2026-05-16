import { useCallback, useEffect, useState } from 'react'
import { formatSupabaseOrError } from '../lib/errors'
import {
  disableHubPushNotifications,
  enableHubPushNotifications,
  getHubPushIosInstallSteps,
  getHubPushSupport,
  getHubPushUnsupportedHint,
  getNotificationPermission,
  isHubPushEnabledLocally,
} from '../lib/hubPushNotifications'

type Props = {
  userId: string
  /** Home: enlace discreto al pie. compact: barra en tareas. default: tarjeta completa. */
  variant?: 'default' | 'compact' | 'footer'
}

export function HubPushNotificationSetup({ userId, variant = 'default' }: Props) {
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

  const onEnable = async () => {
    setBusy(true)
    setError(null)
    try {
      const perm = await enableHubPushNotifications(userId)
      setPermission(perm)
      if (perm !== 'granted') {
        setError(null)
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

  const iosSteps =
    support.reason === 'ios-pwa-required' || support.reason === 'ios-pwa-unsupported'
      ? getHubPushIosInstallSteps()
      : null

  if (variant === 'footer') {
    if (!support.supported) {
      return (
        <footer className="nm-hub-push-footer" aria-live="polite">
          <p className="nm-hub-push-footer__muted">{getHubPushUnsupportedHint(support.reason)}</p>
          {iosSteps ? (
            <ol className="nm-hub-push-footer__steps">
              {iosSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          ) : null}
        </footer>
      )
    }

    return (
      <footer className="nm-hub-push-footer" aria-label="Notificaciones de tareas asignadas">
        {active ? (
          <p className="nm-hub-push-footer__row">
            <span className="nm-hub-push-footer__ok">Avisos activos</span>
            <span className="nm-hub-push-footer__sep" aria-hidden="true">
              ·
            </span>
            <button
              type="button"
              className="nm-hub-push-footer__link"
              disabled={busy}
              onClick={() => void onDisable()}
            >
              {busy ? '…' : 'Desactivar'}
            </button>
          </p>
        ) : (
          <button
            type="button"
            className="nm-hub-push-footer__link nm-hub-push-footer__link--cta"
            disabled={busy || permission === 'denied'}
            onClick={() => void onEnable()}
          >
            {busy ? 'Activando…' : 'Permitir avisos cuando te asignen tareas'}
          </button>
        )}
        {permission === 'denied' ? (
          <p className="nm-hub-push-footer__warn" role="status">
            El navegador bloqueó los avisos (en incógnito casi nunca aparece el cartel). Abrí el sitio en una
            ventana normal → candado o ícono junto a la URL → Notificaciones → Permitir → recargá la página y
            tocá de nuevo.
          </p>
        ) : null}
        {error ? (
          <p className="nm-hub-push-footer__error" role="alert">
            {error}
          </p>
        ) : null}
      </footer>
    )
  }

  if (!support.supported) {
    if (support.reason === 'no-vapid') return null
    return (
      <section
        className={`nm-hub-push-setup nm-hub-push-setup--unsupported${variant === 'compact' ? ' nm-hub-push-setup--compact' : ''}`}
        aria-live="polite"
      >
        <p className="nm-hub-muted nm-hub-push-setup__hint">{getHubPushUnsupportedHint(support.reason)}</p>
        {iosSteps ? (
          <ol className="nm-hub-push-setup__steps">
            {iosSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        ) : null}
      </section>
    )
  }

  return (
    <section
      className={`nm-hub-push-setup${variant === 'compact' ? ' nm-hub-push-setup--compact' : ''}`}
      aria-label="Notificaciones de tareas"
    >
      <div className="nm-hub-push-setup__inner">
        <div className="nm-hub-push-setup__copy">
          <p className="nm-hub-push-setup__title">Avisos en el celular</p>
          {variant !== 'compact' ? (
            <p className="nm-hub-muted nm-hub-push-setup__hint">
              Cuando te asignen una tarea, sonará una notificación. En Android: Chrome. En iPhone: solo con Safari →
              agregar a pantalla de inicio → abrir desde el ícono.
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
          Avisos bloqueados. Usá una ventana normal (no incógnito), permití notificaciones en el candado de la URL y
          recargá.
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
