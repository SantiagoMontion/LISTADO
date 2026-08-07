import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { HubBrandBar } from './HubBrandBar'
import { HubDesktopNav } from './HubDesktopNav'
import { formatSupabaseOrError } from '../lib/errors'
import {
  createNotmidAndTrack,
  createTrackedProduct,
  deleteTrackedProduct,
  detectProviderFromUrl,
  extractLethalHandle,
  listTrackedProducts,
  productLinkLabel,
  resolveTrackedShopifyAdminUrl,
  updateTrackedProductRow,
  type TrackedProduct,
} from '../lib/trackedProductsApi'
import type { HubUserRole } from '../lib/types'

interface HubImportadosSyncAppProps {
  profileRole?: HubUserRole | null
  adminSignOut?: boolean
}

const emptyForm = {
  product_url: '',
  peso_kg: '',
}

function formatPrice(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value)
}

function formatChecked(iso: string | null): string {
  if (!iso) return 'Nunca'
  try {
    return new Date(iso).toLocaleString('es-AR', {
      dateStyle: 'short',
      timeStyle: 'short',
    })
  } catch {
    return iso
  }
}

export function HubImportadosSyncApp({
  profileRole,
  adminSignOut = false,
}: HubImportadosSyncAppProps) {
  const [products, setProducts] = useState<TrackedProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await listTrackedProducts()
      setProducts(rows)
    } catch (e) {
      setError(formatSupabaseOrError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  async function onCreateAndTrack(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const url = form.product_url.trim()
      if (!/^https?:\/\//i.test(url)) {
        throw new Error('Pegá el link completo del producto (https://...)')
      }
      const provider = detectProviderFromUrl(url)
      if (!provider) {
        throw new Error(
          'El link tiene que ser de lethal.gg o mechanicalkeyboards.com',
        )
      }
      const pesoKg = Number(String(form.peso_kg).replace(',', '.'))
      if (!Number.isFinite(pesoKg) || pesoKg <= 0) {
        throw new Error('Ingresá el peso del paquete en kg (ejemplo: 0.8)')
      }
      await createNotmidAndTrack({
        provider,
        product_url: url,
        peso_kg: pesoKg,
      })
      setForm(emptyForm)
      setSuccess('Producto creado con éxito')
      await reload()
    } catch (err) {
      setError(formatSupabaseOrError(err))
    } finally {
      setSaving(false)
    }
  }

  async function onTrackOnly() {
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const url = form.product_url.trim()
      if (!/^https?:\/\//i.test(url)) {
        throw new Error('Pegá el link completo del producto (https://...)')
      }
      const provider = detectProviderFromUrl(url)
      if (!provider) {
        throw new Error(
          'El link tiene que ser de lethal.gg o mechanicalkeyboards.com',
        )
      }
      const handle = provider === 'lethal' ? extractLethalHandle(url) : null
      await createTrackedProduct({
        provider,
        product_url: url,
        shopify_handle: handle,
      })
      setForm(emptyForm)
      setSuccess(
        'Agregado al seguimiento. Sin producto NotMid vinculado: solo guarda precio/stock (no puede poner stock 0 en Shopify).',
      )
      await reload()
    } catch (err) {
      setError(formatSupabaseOrError(err))
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(product: TrackedProduct) {
    setError(null)
    try {
      await updateTrackedProductRow(product.id, { is_active: !product.is_active })
      await reload()
    } catch (err) {
      setError(formatSupabaseOrError(err))
    }
  }

  async function removeProduct(product: TrackedProduct) {
    if (!window.confirm(`¿Borrar el seguimiento de\n${product.product_url}?`)) return
    setError(null)
    try {
      await deleteTrackedProduct(product.id)
      await reload()
    } catch (err) {
      setError(formatSupabaseOrError(err))
    }
  }

  async function openInShopify(product: TrackedProduct) {
    setError(null)
    try {
      const url = await resolveTrackedShopifyAdminUrl(product)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      setError(formatSupabaseOrError(err))
    }
  }

  return (
    <div className="nm-hub-app nm-hub-app--3d nm-hub-app--importados">
      <header className="dashboard-navbar dashboard-navbar-clean nm-hub-header">
        <HubBrandBar
          integratedDashboard
          integratedSubtitle="Sync Importados"
          adminSignOut={adminSignOut}
        />
      </header>

      <HubDesktopNav role={profileRole} />

      <div className="printing3d-page importados-page importados-sync-page">
        <header className="printing3d-page__head">
          <h1 className="printing3d-page__title">Productos a sincronizar</h1>
          <p className="printing3d-page__lead importados-page__lead">
            Pegá el link de Lethal o MechanicalKeyboards y el peso del paquete. Creamos el
            producto en <strong>borrador</strong> en NotMid con el precio de tu calculadora
            (Aerobox $20/kg, envío AR $15, flete interno $0, dólar MEP $1530). Si se agota en el
            proveedor, el stock en NotMid pasa a 0.
          </p>
        </header>

        {error ? (
          <p className="nm-hub-error" role="alert">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="importados-sync-success" role="status">
            {success}
          </p>
        ) : null}

        <form className="printing3d-panel importados-sync-form" onSubmit={onCreateAndTrack}>
          <h2 className="printing3d-output-block__title">Agregar producto</h2>

          <label className="printing3d-field">
            <span>Link del producto (Lethal o MechanicalKeyboards)</span>
            <input
              type="url"
              required
              placeholder="https://lethal.gg/products/... o https://mechanicalkeyboards.com/..."
              value={form.product_url}
              onChange={(e) => setForm((f) => ({ ...f, product_url: e.target.value }))}
            />
          </label>

          <label className="printing3d-field">
            <span>Peso del paquete (kg)</span>
            <input
              type="number"
              required
              min="0.01"
              step="0.01"
              inputMode="decimal"
              placeholder="Ej: 0.8"
              value={form.peso_kg}
              onChange={(e) => setForm((f) => ({ ...f, peso_kg: e.target.value }))}
            />
            <span className="importados-field-hint">
              Se usa para Aerobox ($20/kg). El resto de la cotización es fijo: envío AR $15, flete
              interno $0, dólar MEP $1530.
            </span>
          </label>

          <div className="importados-sync-actions">
            <button type="submit" className="nm-hub-btn nm-hub-btn-primary" disabled={saving}>
              {saving ? 'Creando…' : 'Crear en NotMid + sincronizar'}
            </button>
            <button
              type="button"
              className="nm-hub-btn nm-hub-btn-ghost"
              disabled={saving}
              onClick={() => void onTrackOnly()}
            >
              Solo sincronizar (sin crear)
            </button>
          </div>
          <span className="importados-field-hint">
            Siempre se crea en <strong>borrador</strong>. El precio de Shopify es el contado ARS
            de la calculadora de importados.
          </span>
        </form>

        <section className="printing3d-panel importados-sync-list">
          <div className="importados-sync-list__head">
            <h2 className="printing3d-output-block__title">Lista ({products.length})</h2>
            <button type="button" className="nm-hub-btn" onClick={() => void reload()} disabled={loading}>
              Actualizar
            </button>
          </div>

          {loading ? (
            <p className="nm-hub-muted">Cargando…</p>
          ) : products.length === 0 ? (
            <p className="nm-hub-muted">Todavía no hay productos. Agregá el primero arriba.</p>
          ) : (
            <ul className="importados-sync-cards">
              {products.map((p) => (
                <li key={p.id} className={`importados-sync-card${p.is_active ? '' : ' is-inactive'}`}>
                  <div className="importados-sync-card__top">
                    <span className="importados-sync-card__provider">
                      {p.provider === 'lethal' ? 'Lethal' : 'MK'}
                    </span>
                    <span
                      className={`importados-sync-card__stock${
                        p.in_stock === false ? ' is-oos' : p.in_stock ? ' is-ok' : ''
                      }`}
                    >
                      {p.in_stock === null ? 'Sin chequear' : p.in_stock ? 'En stock' : 'Sin stock'}
                    </span>
                  </div>
                  <a
                    className="importados-sync-card__url"
                    href={p.product_url}
                    target="_blank"
                    rel="noreferrer"
                    title={p.product_url}
                  >
                    {productLinkLabel(p)}
                  </a>
                  <div className="importados-sync-card__meta">
                    <span>Precio proveedor: {formatPrice(p.current_price)}</span>
                    <span>Último check: {formatChecked(p.last_checked)}</span>
                    <span>
                      Vinculado a NotMid:{' '}
                      {p.notmid_shopify_variant_id ? 'Sí' : 'No (solo monitoreo)'}
                    </span>
                  </div>
                  <div className="importados-sync-card__actions">
                    <button type="button" className="nm-hub-btn" onClick={() => void toggleActive(p)}>
                      {p.is_active ? 'Pausar' : 'Activar'}
                    </button>
                    <button
                      type="button"
                      className="nm-hub-btn nm-hub-btn-ghost"
                      onClick={() => void removeProduct(p)}
                    >
                      Borrar
                    </button>
                    {p.notmid_shopify_variant_id || p.notmid_shopify_product_id ? (
                      <button
                        type="button"
                        className="nm-hub-btn nm-hub-btn-primary"
                        onClick={() => void openInShopify(p)}
                      >
                        Ver en Shopify
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
