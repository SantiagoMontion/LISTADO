import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { CalcNumberField } from './CalcNumberField'
import { HubBrandBar } from './HubBrandBar'
import { HubDesktopNav } from './HubDesktopNav'
import { formatSupabaseOrError } from '../lib/errors'
import {
  createNotmidAndTrack,
  deleteTrackedProduct,
  detectProviderFromUrl,
  fetchVariantMapHealth,
  listTrackedProducts,
  productLinkLabel,
  repairVariantMaps,
  resolveTrackedShopifyAdminUrl,
  syncTrackedProductStock,
  updateTrackedProductRow,
  type TrackedProduct,
  type VariantMapHealthReport,
} from '../lib/trackedProductsApi'
import type { HubUserRole } from '../lib/types'

interface HubImportadosSyncAppProps {
  profileRole?: HubUserRole | null
  adminSignOut?: boolean
}

const emptyForm = {
  product_url: '',
  peso_kg: 0,
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

/** Cadencia automática: <5 unidades ~cada 5 min; >=5 ~30 min. */
function formatCheckCadence(qty: number | null | undefined): string {
  if (qty === null || qty === undefined) return 'Cadencia: pendiente primer snapshot'
  if (qty < 5) return `Cadencia: ~5 min (qty min ${qty})`
  return `Cadencia: ~30 min (qty min ${qty})`
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
  const [mapHealth, setMapHealth] = useState<VariantMapHealthReport | null>(null)
  const [mapHealthBusy, setMapHealthBusy] = useState(false)
  const [mapHealthNote, setMapHealthNote] = useState<string | null>(null)
  const [syncingId, setSyncingId] = useState<string | null>(null)

  const refreshMapHealth = useCallback(async (opts?: { autoRepair?: boolean }) => {
    setMapHealthBusy(true)
    setMapHealthNote(null)
    try {
      let report = await fetchVariantMapHealth()
      if (opts?.autoRepair && report.incomplete > 0) {
        setMapHealthNote(
          `Reparando ${report.incomplete} mapa${report.incomplete === 1 ? '' : 's'} incompleto${report.incomplete === 1 ? '' : 's'}…`,
        )
        const result = await repairVariantMaps()
        report = result.report
        const failN = result.failed.length
        setMapHealthNote(
          failN === 0
            ? `Listo: reparé ${result.repaired} mapa${result.repaired === 1 ? '' : 's'}.`
            : `Reparé ${result.repaired}; ${failN} fallaron. Revisá los incompletos.`,
        )
        if (failN > 0) {
          setError(
            result.failed
              .slice(0, 3)
              .map((f) => `${f.handle || f.id}: ${f.error}`)
              .join(' · '),
          )
        }
      }
      setMapHealth(report)
    } catch (e) {
      setMapHealthNote(formatSupabaseOrError(e))
    } finally {
      setMapHealthBusy(false)
    }
  }, [])

  const reload = useCallback(
    async (opts?: { autoRepairMaps?: boolean }) => {
      setLoading(true)
      setError(null)
      try {
        const rows = await listTrackedProducts()
        setProducts(rows)
        await refreshMapHealth({ autoRepair: opts?.autoRepairMaps ?? true })
      } catch (e) {
        setError(formatSupabaseOrError(e))
      } finally {
        setLoading(false)
      }
    },
    [refreshMapHealth],
  )

  useEffect(() => {
    void reload({ autoRepairMaps: true })
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
      const pesoKg = form.peso_kg
      if (!Number.isFinite(pesoKg) || pesoKg <= 0) {
        throw new Error('Ingresá el peso del paquete en kg (ejemplo: 0,5 o 0.5)')
      }
      const created = await createNotmidAndTrack({
        provider,
        product_url: url,
        peso_kg: pesoKg,
      })
      setForm(emptyForm)
      setSuccess(created.message || 'Producto creado y stock sincronizado')
      await reload({ autoRepairMaps: false })
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

  async function syncNow(product: TrackedProduct) {
    setError(null)
    setSuccess(null)
    setSyncingId(product.id)
    try {
      const result = await syncTrackedProductStock(product.id)
      if (result.error) throw new Error(result.error)
      const qtys = result.detail?.quantities?.filter((q) => q.qty > 0) ?? []
      const preview = qtys
        .slice(0, 5)
        .map((q) => `${q.option} × ${q.qty}`)
        .join(', ')
      setSuccess(
        qtys.length
          ? `Stock actualizado: ${preview}${qtys.length > 5 ? ` +${qtys.length - 5}` : ''}`
          : result.shopifyRestocked
            ? 'Stock escrito en Shopify.'
            : result.shopifyZeroed
              ? 'Sincronizado (sin stock o en 0).'
              : 'Sincronizado. El proveedor no cambió qty.',
      )
      await reload({ autoRepairMaps: false })
    } catch (err) {
      setError(formatSupabaseOrError(err))
    } finally {
      setSyncingId(null)
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
            producto en <strong>borrador</strong> en NotMid y leemos el stock del proveedor
            al toque. El cron sigue corrigiendo después.
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

          <CalcNumberField
            id="importados-sync-peso"
            label="Peso del paquete"
            suffix="kg"
            min={0}
            value={form.peso_kg}
            onChange={(peso_kg) => setForm((f) => ({ ...f, peso_kg }))}
          />

          <div className="importados-sync-actions">
            <button type="submit" className="nm-hub-btn nm-hub-btn-primary" disabled={saving}>
              {saving ? 'Creando y leyendo stock…' : 'Crear en NotMid + sincronizar'}
            </button>
          </div>
        </form>

        <section className="printing3d-panel importados-sync-list">
          <div className="importados-sync-list__head">
            <h2 className="printing3d-output-block__title">Lista ({products.length})</h2>
            <button
              type="button"
              className="nm-hub-btn"
              onClick={() => void reload()}
              disabled={loading || mapHealthBusy}
            >
              Actualizar
            </button>
          </div>

          {mapHealth && mapHealth.incomplete > 0 ? (
            <p className="importados-sync-map-health is-warn" role="status">
              {mapHealth.total} productos · {mapHealth.complete} con mapa completo ·{' '}
              {mapHealth.incomplete} incompletos
              {mapHealth.monitorOnly > 0
                ? ` · ${mapHealth.monitorOnly} solo sync (sin NotMid)`
                : ''}{' '}
              <button
                type="button"
                className="nm-hub-btn nm-hub-btn-primary"
                disabled={mapHealthBusy}
                onClick={() => void refreshMapHealth({ autoRepair: true })}
              >
                {mapHealthBusy ? 'Reparando…' : 'Reparar incompletos'}
              </button>
            </p>
          ) : null}
          {mapHealthNote ? (
            <p className="nm-hub-muted" role="status">
              {mapHealthNote}
            </p>
          ) : null}

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
                    {(() => {
                      const mapStatus = mapHealth?.items.find((i) => i.id === p.id)?.status
                      if (!mapStatus) return null
                      const label =
                        mapStatus === 'complete'
                          ? 'Mapa OK'
                          : mapStatus === 'incomplete'
                            ? 'Mapa incompleto'
                            : 'Solo sync'
                      const cls =
                        mapStatus === 'complete'
                          ? 'is-ok'
                          : mapStatus === 'incomplete'
                            ? 'is-warn'
                            : 'is-muted'
                      return (
                        <span className={`importados-sync-card__map ${cls}`}>{label}</span>
                      )
                    })()}
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
                    <span>{formatCheckCadence(p.last_known_qty)}</span>
                    <span>
                      Vinculado a NotMid:{' '}
                      {p.notmid_shopify_variant_id ? 'Sí' : 'No (solo monitoreo)'}
                    </span>
                  </div>
                  <div className="importados-sync-card__actions">
                    {p.notmid_shopify_variant_id || p.notmid_shopify_product_id ? (
                      <button
                        type="button"
                        className="nm-hub-btn nm-hub-btn-primary"
                        disabled={syncingId === p.id || saving}
                        onClick={() => void syncNow(p)}
                      >
                        {syncingId === p.id ? 'Sincronizando…' : 'Sincronizar ahora'}
                      </button>
                    ) : null}
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
                        className="nm-hub-btn nm-hub-btn-ghost"
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
