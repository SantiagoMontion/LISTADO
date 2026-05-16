import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import {
  getNotificationPermission,
  isHubPushEnabledLocally,
  shouldNotifyUserForNewTask,
  showLocalTaskAssignedNotification,
} from '../lib/hubPushNotifications'
import type { HubUserRole } from '../lib/types'

type Props = {
  profileRole: HubUserRole
  profileId: string
  isAdmin: boolean
}

/** Realtime: aviso + sonido cuando la app está abierta y los avisos están activados. */
export function HubTaskPushListener({ profileRole, profileId, isAdmin }: Props) {
  useEffect(() => {
    const sb = supabase
    if (!sb) return
    if (getNotificationPermission() !== 'granted' || !isHubPushEnabledLocally()) return

    const channel = sb
      .channel(`nm_hub_task_push:${profileId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'nm_hub_tasks' },
        (payload) => {
          const row = payload.new as Record<string, unknown>
          if (!shouldNotifyUserForNewTask(row, profileRole, profileId, isAdmin)) return
          const title = typeof row.title === 'string' ? row.title : 'Nueva tarea'
          const id = typeof row.id === 'string' ? row.id : String(Date.now())
          const forDate = typeof row.for_date === 'string' ? row.for_date : undefined
          showLocalTaskAssignedNotification({ title, taskId: id, forDate })
        },
      )
      .subscribe()

    return () => {
      void sb.removeChannel(channel)
    }
  }, [profileRole, profileId, isAdmin])

  return null
}
