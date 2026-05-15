import { useState } from 'react'
import { HubBrandBar } from './HubBrandBar'
import { supabase } from '../lib/supabase'
import { formatSupabaseOrError } from '../lib/errors'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase) {
      setError('Supabase no está configurado.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { error: e1 } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (e1) throw e1
    } catch (err: unknown) {
      setError(formatSupabaseOrError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="nm-hub-app">
      <header className="nm-hub-header">
        <HubBrandBar />
      </header>

      <form className="nm-hub-card" onSubmit={(e) => void onSubmit(e)}>
        <label className="nm-hub-label" htmlFor="nm-hub-login-email">
          Correo
        </label>
        <input
          id="nm-hub-login-email"
          className="nm-hub-input"
          type="email"
          autoComplete="username"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <label className="nm-hub-label" htmlFor="nm-hub-login-pass" style={{ marginTop: '0.75rem' }}>
          Contraseña
        </label>
        <input
          id="nm-hub-login-pass"
          className="nm-hub-input"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        {error ? (
          <p className="nm-hub-error" role="alert">
            {error}
          </p>
        ) : null}

        <button type="submit" className="nm-hub-btn nm-hub-btn-primary" disabled={busy} style={{ marginTop: '1rem', width: '100%' }}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>

      <p className="nm-hub-footnote">Solo personal autorizado</p>
    </div>
  )
}
