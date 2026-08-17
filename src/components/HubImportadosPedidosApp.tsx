import { useCallback, useEffect, useMemo, useState } from 'react'
import { HubBrandBar } from './HubBrandBar'
import { HubDesktopNav } from './HubDesktopNav'
import { HubTasksPillSelect, type HubTasksPillOption } from './HubTasksPillSelect'
import { formatSupabaseOrError } from '../lib/errors'
import {
  listImportadosOrders,
  mergeOrderLines,
  openSupplierOrderTabs,
  type ImportadosOrderRow,
} from '../lib/importadosOrdersApi'
import type { HubUserRole } from '../lib/types'

interface HubImportadosPedidosAppProps {
  profileRole?: HubUserRole | null
  adminSignOut?: boolean
}

type CourierAviso = 'pendiente' | 'completo'
type CourierAvisoFilter = 'all' | CourierAviso
type CompraFilter = 'all' | 'sin_comprar' | 'comprados'
type LineCompraStatus = 'pendiente' | 'realizado'

const COURIER_AVISO_OPTIONS: HubTasksPillOption<CourierAviso>[] = [
  {
    value: 'pendiente',
    label: 'Pendiente',
    toneClass: 'hub-tasks-tracking-sent-select--pendiente',
  },
  {
    value: 'completo',
    label: 'Completo',
    toneClass: 'hub-tasks-tracking-sent-select--enviado',
  },
]

const COURIER_FILTER_OPTIONS: HubTasksPillOption<CourierAvisoFilter>[] = [
  { value: 'all', label: 'Todos', toneClass: 'hub-tasks-type-pill--all' },
  {
    value: 'pendiente',
    label: 'Pendientes',
    toneClass: 'hub-tasks-tracking-sent-select--pendiente',
  },
  {
    value: 'completo',
    label: 'Completo',
    toneClass: 'hub-tasks-tracking-sent-select--enviado',
  },
]

const COMPRA_FILTER_OPTIONS: HubTasksPillOption<CompraFilter>[] = [
  { value: 'all', label: 'Todas', toneClass: 'hub-tasks-type-pill--all' },
  {
    value: 'sin_comprar',
    label: 'Sin comprar',
    toneClass: 'hub-tasks-tracking-sent-select--pendiente',
  },
  {
    value: 'comprados',
    label: 'Comprados',
    toneClass: 'hub-tasks-tracking-sent-select--enviado',
  },
]

const LINE_COMPRA_OPTIONS: HubTasksPillOption<LineCompraStatus>[] = [
  {
    value: 'pendiente',
    label: 'Pendiente',
    toneClass: 'hub-tasks-tracking-sent-select--pendiente',
  },
  {
    value: 'realizado',
    label: 'Realizado',
    toneClass: 'hub-tasks-tracking-sent-select--enviado',
  },
]

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

function providerLabel(provider: 'lethal' | 'mk' | null): string {
  if (provider === 'lethal') return 'Lethal'
  if (provider === 'mk') return 'MK'
  return 'NotMid'
}

function lineKey(orderId: string, lineItemId: string): string {
  return `${orderId}:${lineItemId}`
}

export function HubImportadosPedidosApp({
  profileRole,
  adminSignOut = false,
}: HubImportadosPedidosAppProps) {
  const [orders, setOrders] = useState<ImportadosOrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [courierAvisoByOrder, setCourierAvisoByOrder] = useState<Record<string, CourierAviso>>(
    {},
  )
  const [realizadoByLine, setRealizadoByLine] = useState<Record<string, boolean>>({})
  const [avisoFilter, setAvisoFilter] = useState<CourierAvisoFilter>('all')
  const [compraFilter, setCompraFilter] = useState<CompraFilter>('all')

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    setNotice(null)
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

  function courierAvisoFor(orderId: string): CourierAviso {
    return courierAvisoByOrder[orderId] || 'pendiente'
  }

  function lineRealizado(orderId: string, memberIds: string[]): boolean {
    return memberIds.every((id) => Boolean(realizadoByLine[lineKey(orderId, id)]))
  }

  function orderAllRealizado(order: ImportadosOrderRow): boolean {
    const lines = mergeOrderLines(order)
    if (!lines.length) return false
    return lines.every((line) => lineRealizado(order.orderId, line.memberIds))
  }

  function orderAnyRealizado(order: ImportadosOrderRow): boolean {
    const lines = mergeOrderLines(order)
    return lines.some((line) => lineRealizado(order.orderId, line.memberIds))
  }

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      const aviso = courierAvisoFor(order.orderId)
      if (avisoFilter !== 'all' && aviso !== avisoFilter) return false
      const allDone = orderAllRealizado(order)
      const anyDone = orderAnyRealizado(order)
      if (compraFilter === 'sin_comprar' && allDone) return false
      if (compraFilter === 'comprados' && !anyDone) return false
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- helpers use state maps
  }, [orders, avisoFilter, compraFilter, courierAvisoByOrder, realizadoByLine])

  function onHacerPedido(urls: string[]) {
    setNotice(null)
    if (!urls.length) {
      setNotice('No hay links de proveedor para este ítem.')
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
    <div className="nm-hub-app nm-hub-app--importados">
      <header className="dashboard-navbar dashboard-navbar-clean nm-hub-header">
        <HubBrandBar
          integratedDashboard
          integratedSubtitle="Pedidos Importados"
          adminSignOut={adminSignOut}
        />
      </header>

      <HubDesktopNav role={profileRole} />

      <div className="printing3d-page importados-page importados-orders-page">
        <header className="printing3d-page__head importados-orders-head">
          <h1 className="printing3d-page__title">Pedidos importados</h1>
          <button
            type="button"
            className="importados-orders-refresh"
            onClick={() => void reload()}
            disabled={loading}
          >
            {loading ? 'Actualizando…' : 'Actualizar'}
          </button>
        </header>

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

        <div className="importados-orders-filters" role="search">
          <div className="importados-orders-filter">
            <span className="importados-orders-filter__label">Aviso de Currier</span>
            <HubTasksPillSelect
              value={avisoFilter}
              options={COURIER_FILTER_OPTIONS}
              aria-label="Filtrar por aviso de Currier"
              className="importados-orders-filter__select"
              onChange={setAvisoFilter}
            />
          </div>
          <div className="importados-orders-filter">
            <span className="importados-orders-filter__label">Compra pendiente</span>
            <HubTasksPillSelect
              value={compraFilter}
              options={COMPRA_FILTER_OPTIONS}
              aria-label="Filtrar por compra"
              className="importados-orders-filter__select"
              onChange={setCompraFilter}
            />
          </div>
        </div>

        {loading ? (
          <p className="importados-orders-empty">Cargando pedidos…</p>
        ) : filteredOrders.length === 0 ? (
          <p className="importados-orders-empty">No hay pedidos con esos filtros.</p>
        ) : (
          <ul className="importados-orders-list">
            {filteredOrders.map((order) => {
              const allDone = orderAllRealizado(order)
              return (
                <li
                  key={order.orderId}
                  className={`importados-orders-card${
                    allDone ? ' importados-orders-card--realizado' : ''
                  }`}
                >
                  <div className="importados-orders-card__head">
                    <div>
                      <div className="importados-orders-card__title-row">
                        <a
                          className="importados-orders-card__order"
                          href={order.adminUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {order.orderName}
                        </a>
                      </div>
                      <p className="importados-orders-card__when">
                        {formatWhen(order.createdAt)} · {order.lines.length} producto
                        {order.lines.length === 1 ? '' : 's'}
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
                      {order.allSupplierUrls.length > 0 ? (
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
                      ) : null}
                    </div>
                  </div>

                  <ul className="importados-orders-lines">
                    {mergeOrderLines(order).map((line) => {
                      const done = lineRealizado(order.orderId, line.memberIds)
                      return (
                        <li key={line.memberIds.join('-')} className="importados-orders-line">
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
                            {line.trackedProductId && line.unmatchedVariant ? (
                              <span className="importados-orders-line__warn">
                                Sin variante de proveedor — no se abre el link
                              </span>
                            ) : null}
                          </div>
                          <div className="importados-orders-line__actions">
                            {line.supplierUrls.length > 0 ? (
                              <button
                                type="button"
                                className="importados-orders-hacer importados-orders-hacer--ghost"
                                onClick={() => onHacerPedido(line.supplierUrls)}
                              >
                                Hacer pedido
                                {line.supplierUrls.length > 1
                                  ? ` (${line.supplierUrls.length})`
                                  : ''}
                              </button>
                            ) : null}
                            <HubTasksPillSelect
                              value={done ? 'realizado' : 'pendiente'}
                              options={LINE_COMPRA_OPTIONS}
                              aria-label={`Estado compra ${line.title}`}
                              pillClassName="hub-tasks-status-select"
                              onChange={(value) => {
                                const checked = value === 'realizado'
                                setRealizadoByLine((prev) => {
                                  const next = { ...prev }
                                  for (const id of line.memberIds) {
                                    next[lineKey(order.orderId, id)] = checked
                                  }
                                  return next
                                })
                              }}
                            />
                          </div>
                        </li>
                      )
                    })}
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
