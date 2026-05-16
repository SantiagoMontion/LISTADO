import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import {
  HUB_PUSH_ENABLED_EVENT,
  getNotificationPermission,
  isHubPushEnabledLocally,
  shouldNotifyUserForNewTask,
  showTaskAssignedNotification,
} from '../lib/hubPushNotifications'
import type { HubUserRole } from '../lib/types'

type Props = {
  profileRole: HubUserRole
  profileId: string
  isAdmin: boolean
}

/** Realtime + sonido cuando la app está abierta y los avisos están activados. */
export function HubTaskPushListener({ profileRole, profileId, isAdmin }: Props) {
  useEffect(() => {
    const sb = supabase
    if (!sb) return

    const subscribe = () => {
      if (getNotificationPermission() !== 'granted' || !isHubPushEnabledLocally()) {
        return null
      }

      const changeConfig: {
        event: 'INSERT'
        schema: 'public'
        table: string
        filter?: string
      } = {
        event: 'INSERT',
        schema: 'public',
        table: 'nm_hub_tasks',
      }
      if (!isAdmin) {
        changeConfig.filter = `assigned_role=eq.${profileRole}`
      }

      return sb
        .channel(`nm_hub_task_push:${profileId}`)
        .on('postgres_changes', changeConfig, (payload) => {
          const row = payload.new as Record<string, unknown>
          if (!shouldNotifyUserForNewTask(row, profileRole, profileId)) return
          const title = typeof row.title === 'string' ? row.title : 'Nueva tarea'
          const id = typeof row.id === 'string' ? row.id : String(Date.now())
          const forDate = typeof row.for_date === 'string' ? row.for_date : undefined
          void showTaskAssignedNotification({ title, taskId: id, forDate })
        })
        .subscribe()
    }

    let channel = subscribe()

    const resubscribe = () => {
      if (channel) void sb.removeChannel(channel)
      channel = subscribe()
    }

    window.addEventListener(HUB_PUSH_ENABLED_EVENT, resubscribe)

    return () => {
      window.removeEventListener(HUB_PUSH_ENABLED_EVENT, resubscribe)
      if (channel) void sb.removeChannel(channel)
    }
  }, [profileRole, profileId, isAdmin])

  return null
}
