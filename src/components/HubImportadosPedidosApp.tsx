import { useCallback, useEffect, useMemo, useState } from 'react'
import { HubBrandBar } from './HubBrandBar'
import { HubDesktopNav } from './HubDesktopNav'
import { HubTasksPillSelect, type HubTasksPillOption } from './HubTasksPillSelect'
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

type CourierAviso = 'pendiente' | 'cargado'

const COURIER_AVISO_OPTIONS: HubTasksPillOption<CourierAviso>[] = [
  {
    value: 'pendiente',
    label: 'Pendiente',
    toneClass: 'hub-tasks-tracking-sent-select--pendiente',
  },
  {
    value: 'cargado',
    label: 'Cargado',
    toneClass: 'hub-tasks-tracking-sent-select--enviado',
  },
]

/** Solo front: no se crea en Shopify. Sirve para ver layout y el dropdown. */
const DEMO_ORDER: ImportadosOrderRow = {
  orderId: 'demo-importados-1',
  orderName: '#15999',
  createdAt: new Date().toISOString(),
  financialStatus: 'paid',
  fulfillmentStatus: null,
  adminUrl: '#',
  lines: [
    {
      lineItemId: 'demo-line-1',
      title: 'Teclado 60% | Importados',
      variantTitle: 'Negro / 60%',
      quantity: 2,
      supplierUrls: [
        'https://lethal.gg/products/demo-60-keyboard?variant=111',
        'https://lethal.gg/products/demo-60-keyboard?variant=111',
      ],
      provider: 'lethal',
      trackedProductId: 'demo-tracked-1',
      notmidVariantId: 'demo-variant-1',
      supplierVariantId: '111',
    },
    {
      lineItemId: 'demo-line-2',
      title: 'Mousepad PRO Custom | Importados',
      variantTitle: null,
      quantity: 1,
      supplierUrls: ['https://mechanicalkeyboards.com/products/demo-mousepad'],
      provider: 'mk',
      trackedProductId: 'demo-tracked-2',
      notmidVariantId: 'demo-variant-2',
      supplierVariantId: null,
    },
  ],
  allSupplierUrls: [
    'https://lethal.gg/products/demo-60-keyboard?variant=111',
    'https://lethal.gg/products/demo-60-keyboard?variant=111',
    'https://mechanicalkeyboards.com/products/demo-mousepad',
  ],
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

function isDemoOrder(order: ImportadosOrderRow): boolean {
  return order.orderId === DEMO_ORDER.orderId
}

export function HubImportadosPedidosApp({
  profileRole,
  adminSignOut = false,
}: HubImportadosPedidosAppProps) {
  const [orders, setOrders] = useState<ImportadosOrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [courierAvisoByOrder, setCourierAvisoByOrder] = useState<Record<string, CourierAviso>>({
    [DEMO_ORDER.orderId]: 'pendiente',
  })

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await listImportadosOrders()
      setOrders(data.orders)
    } catch (e) {
      setError(formatSupabaseOrError(e))
      setOrders([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const displayOrders = useMemo(() => {
    const withoutDemo = orders.filter((o) => o.orderId !== DEMO_ORDER.orderId)
    return [DEMO_ORDER, ...withoutDemo]
  }, [orders])

  const units = useMemo(
    () => displayOrders.reduce((sum, o) => sum + o.allSupplierUrls.length, 0),
    [displayOrders],
  )

  function onHacerPedido(order: ImportadosOrderRow, urls: string[]) {
    setNotice(null)
    if (isDemoOrder(order)) {
      setNotice(
        'Este es un pedido de ejemplo (solo preview). No se abre nada en el proveedor.',
      )
      return
    }
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

  function courierAvisoFor(orderId: string): CourierAviso {
    return courierAvisoByOrder[orderId] ?? 'pendiente'
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
            {displayOrders.length} pedido{displayOrders.length === 1 ? '' : 's'} · {units}{' '}
            unidad{units === 1 ? '' : 'es'} a pedir
            <span className="importados-orders-meta__demo"> · 1 ejemplo en preview</span>
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
        ) : (
          <ul className="importados-orders-list">
            {displayOrders.map((order) => {
              const demo = isDemoOrder(order)
              return (
                <li
                  key={order.orderId}
                  className={`importados-orders-card${demo ? ' importados-orders-card--demo' : ''}`}
                >
                  <div className="importados-orders-card__head">
                    <div>
                      <div className="importados-orders-card__title-row">
                        {demo ? (
                          <span className="importados-orders-card__order">
                            {order.orderName}
                          </span>
                        ) : (
                          <a
                            className="importados-orders-card__order"
                            href={order.adminUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {order.orderName}
                          </a>
                        )}
                        {demo ? (
                          <span className="importados-orders-demo-badge">Ejemplo</span>
                        ) : null}
                      </div>
                      <p className="importados-orders-card__when">
                        {formatWhen(order.createdAt)}
                      </p>
                    </div>
                    <div className="importados-orders-card__actions">
                      <div className="importados-orders-aviso">
                        <span className="importados-orders-aviso__label">Aviso Currier</span>
                        <HubTasksPillSelect
                          value={courierAvisoFor(order.orderId)}
                          options={COURIER_AVISO_OPTIONS}
                          aria-label={`Aviso Currier ${order.orderName}`}
                          pillClassName="hub-tasks-status-select"
                          onChange={(value) => {
                            setCourierAvisoByOrder((prev) => ({
                              ...prev,
                              [order.orderId]: value,
                            }))
                          }}
                        />
                      </div>
                      <button
                        type="button"
                        className="importados-orders-hacer"
                        onClick={() => onHacerPedido(order, order.allSupplierUrls)}
                      >
                        Hacer pedido
                        {order.allSupplierUrls.length > 1
                          ? ` (${order.allSupplierUrls.length})`
                          : ''}
                      </button>
                    </div>
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
                          onClick={() => onHacerPedido(order, line.supplierUrls)}
                        >
                          Hacer pedido
                          {line.quantity > 1 ? ` (${line.quantity})` : ''}
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
