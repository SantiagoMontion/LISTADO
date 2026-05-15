import { useLayoutEffect } from 'react'
import { hubReplace } from '../lib/hubNavigate'
import { HubLoadingScreen } from './HubLoadingScreen'

/** Sesión activa pero la URL sigue en `/entrar`: pasamos a `/` sin recargar toda la página. */
export function HubEntrarRedirect() {
  useLayoutEffect(() => {
    hubReplace('/')
  }, [])
  return <HubLoadingScreen label="Entrando…" />
}
