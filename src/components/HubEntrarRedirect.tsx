import { useLayoutEffect } from 'react'
import { defaultHubPathForRole } from '../lib/hubPermissions'
import { hubReplace } from '../lib/hubNavigate'
import type { HubUserRole } from '../lib/types'
import { HubLoadingScreen } from './HubLoadingScreen'

/** Tras login: pantalla principal según rol (menos clics). */
export function HubEntrarRedirect({ role }: { role?: HubUserRole | null }) {
  useLayoutEffect(() => {
    hubReplace(defaultHubPathForRole(role))
  }, [role])

  return <HubLoadingScreen label="Entrando…" />
}
