import { useCallback, useEffect, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { HubUserRole, NmHubProfile } from './types'

function pickStr(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'string') return v
  return String(v)
}

function normalizeHubRole(raw: string | undefined): HubUserRole {
  const s = (raw ?? '').trim().toLowerCase()
  if (s === 'admin') return 'admin'
  if (s === 'lista_creator' || s === 'creador_lista' || s === 'lista') return 'lista_creator'
  if (s === 'taller_1' || s === 'operario') return 'taller_1'
  if (s === 'taller_2' || s === 'vista') return 'taller_2'
  return 'taller_1'
}

function parseProfile(row: unknown): NmHubProfile | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  const id = pickStr(r.id)
  if (!id) return null
  const display_name = (pickStr(r.display_name) ?? '').trim()
  const roleRaw = pickStr(r.role)
  const role = normalizeHubRole(roleRaw ?? undefined)
  return {
    id,
    display_name,
    role,
    created_at: pickStr(r.created_at) ?? '',
    updated_at: pickStr(r.updated_at) ?? '',
  }
}

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [profile, setProfile] = useState<NmHubProfile | null>(null)
  const [profileReady, setProfileReady] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)

  const fetchProfile = useCallback(async (): Promise<NmHubProfile | null> => {
    if (!supabase || !session?.user?.id) {
      setProfileError(null)
      return null
    }
    const { data, error } = await supabase
      .from('nm_hub_profiles')
      .select('id, display_name, role, created_at, updated_at')
      .eq('id', session.user.id)
      .maybeSingle()

    if (error) {
      const msg = [error.message, error.code, error.details].filter(Boolean).join(' — ')
      console.warn('[useAuth] nm_hub_profiles:', msg)
      setProfileError(msg)
      return null
    }
    setProfileError(null)
    return parseProfile(data)
  }, [session?.user?.id])

  useEffect(() => {
    if (!supabase) {
      setSession(null)
      setReady(true)
      return
    }

    let cancelled = false
    void supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) {
        setSession(data.session ?? null)
        setReady(true)
      }
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!supabase || !session?.user) {
      setProfile(null)
      setProfileError(null)
      setProfileReady(true)
      return
    }

    let cancelled = false
    setProfileReady(false)

    void fetchProfile().then((p) => {
      if (!cancelled) {
        setProfile(p)
        setProfileReady(true)
      }
    })

    return () => {
      cancelled = true
    }
  }, [fetchProfile, session?.user?.id])

  useEffect(() => {
    if (!supabase || !session?.user?.id) return

    const onVis = () => {
      if (document.visibilityState !== 'visible') return
      void fetchProfile().then((p) => setProfile(p))
    }

    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [fetchProfile, session?.user?.id])

  const user: User | null = session?.user ?? null

  return { session, user, profile, profileReady, profileError, ready }
}
