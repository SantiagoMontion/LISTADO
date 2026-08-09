import { useCallback, useEffect, useState } from 'react'
import { HubBrandBar } from './HubBrandBar'
import { HubDesktopNav } from './HubDesktopNav'
import { formatSupabaseOrError } from '../lib/errors'
import {
  listImportadosOrders,
  openSupplierOrderTabs,
  type ImportadosOrderRow,
} from '../lib/importadosOrdersApi'
import type { HubUserRole } from '../lib/types'

interface HubImportadosPedidosAppProps {
  profileRole?: HubUserRole | null
  adminSignOut?: boolean
}

function formatWhen(iso: string): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('es-AR', {
      dateStyle: 'short',
      timeStyle: 'short',
    })
  } catch {
    return iso
  }
}

function providerLabel(provider: 'lethal' | 'mk'): string {
  return provider === 'lethal' ? 'Lethal' : 'MK'
}

export function HubImportadosPedidosApp({
  profileRole,
  adminSignOut = false,
}: HubImportadosPedidosAppProps) {
  const [orders, setOrders] = useState<ImportadosOrderRow[]>([])
  const [units, setUnits] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await listImportadosOrders()
      setOrders(data.orders)
      setUnits(data.units)
    } catch (e) {
      setError(formatSupabaseOrError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  function onHacerPedido(urls: string[]) {
    setNotice(null)
    if (!urls.length) {
      setNotice('No hay links de proveedor para este pedido.')
      return
    }
    const { opened, blocked } = openSupplierOrderTabs(urls)
    if (blocked) {
      setNotice(
        `Se abrieron ${opened} de ${urls.length}. El navegador bloqueó el resto: permití popups para este sitio.`,
      )
      return
    }
    setNotice(
      opened === 1
        ? 'Se abrió 1 producto del proveedor.'
        : `Se abrieron ${opened} productos del proveedor (una pestaña por unidad).`,
    )
  }

  return (
    <div className="nm-hub-app nm-hub-app--3d nm-hub-app--importados">
      <header className="dashboard-navbar dashboard-navbar-clean nm-hub-header">
        <HubBrandBar
          integratedDashboard
          integratedSubtitle="Pedidos Importados"
          adminSignOut={adminSignOut}
        />
      </header>
      <HubDesktopNav role={profileRole} />

      <div className="printing3d-page importados-page importados-orders-page">
        <header className="printing3d-page__head">
          <div className="printing3d-page__head-row">
            <h1 className="printing3d-page__title">Pedidos importados</h1>
            <button
              type="button"
              className="importados-orders-refresh"
              onClick={() => void reload()}
              disabled={loading}
            >
              {loading ? 'Actualizando…' : 'Actualizar'}
            </button>
          </div>
          <p className="printing3d-page__lead importados-page__lead">
            Pedidos pagados y sin preparar que incluyen productos Importados. «Hacer pedido»
            abre el link exacto en Lethal/MK — una pestaña por cada unidad.
          </p>
        </header>

        {!loading && (
          <p className="importados-orders-meta">
            {orders.length} pedido{orders.length === 1 ? '' : 's'} · {units} unidad
            {units === 1 ? '' : 'es'} a pedir
          </p>
        )}

        {error ? (
          <p className="nm-hub-error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="importados-sync-success" role="status">
            {notice}
          </p>
        ) : null}

        {loading ? (
          <p className="importados-orders-empty">Cargando pedidos…</p>
        ) : orders.length === 0 ? (
          <p className="importados-orders-empty">
            No hay pedidos pagados con importados pendientes de preparar.
          </p>
        ) : (
          <ul className="importados-orders-list">
            {orders.map((order) => (
              <li key={order.orderId} className="importados-orders-card">
                <div className="importados-orders-card__head">
                  <div>
                    <a
                      className="importados-orders-card__order"
                      href={order.adminUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {order.orderName}
                    </a>
                    <p className="importados-orders-card__when">{formatWhen(order.createdAt)}</p>
                  </div>
                  <button
                    type="button"
                    className="importados-orders-hacer"
                    onClick={() => onHacerPedido(order.allSupplierUrls)}
                  >
                    Hacer pedido
                    {order.allSupplierUrls.length > 1
                      ? ` (${order.allSupplierUrls.length})`
                      : ''}
                  </button>
                </div>

                <ul className="importados-orders-lines">
                  {order.lines.map((line) => (
                    <li key={line.lineItemId} className="importados-orders-line">
                      <div className="importados-orders-line__info">
                        <strong>{line.title}</strong>
                        {line.variantTitle ? (
                          <span className="importados-orders-line__variant">
                            {line.variantTitle}
                          </span>
                        ) : null}
                        <span className="importados-orders-line__meta">
                          ×{line.quantity} · {providerLabel(line.provider)}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="importados-orders-hacer importados-orders-hacer--ghost"
                        onClick={() => onHacerPedido(line.supplierUrls)}
                      >
                        Hacer pedido
                        {line.quantity > 1 ? ` (${line.quantity})` : ''}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
