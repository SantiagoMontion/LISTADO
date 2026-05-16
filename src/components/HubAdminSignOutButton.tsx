import { useState } from 'react'
import { hubNavigate } from '../lib/hubNavigate'
import { supabase } from '../lib/supabase'

/** Cerrar sesión (solo visible para admin en la barra del hub). */
export function HubAdminSignOutButton() {
  const [busy, setBusy] = useState(false)

  const onSignOut = async () => {
    if (!supabase || busy) return
    setBusy(true)
    try {
      await supabase.auth.signOut()
      hubNavigate('/entrar')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      className="nm-hub-admin-signout-btn"
      onClick={() => void onSignOut()}
      disabled={busy}
      aria-label="Salir de la cuenta"
    >
      Salir
    </button>
  )
}
