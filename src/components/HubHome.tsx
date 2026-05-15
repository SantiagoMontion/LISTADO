import type { User } from '@supabase/supabase-js'
import { DashboardContainer } from './dashboard/DashboardContainer'
import type { NmHubProfile } from '../lib/types'

interface HubHomeProps {
  user?: User | null
  profile?: NmHubProfile | null
  profileError?: string | null
  guestMode?: boolean
}

/** Home: dashboard por rol (sin submenús Crear / Ver). */
export function HubHome(props: HubHomeProps) {
  return <DashboardContainer {...props} />
}
