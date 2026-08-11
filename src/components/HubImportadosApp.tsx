import { useEffect, useMemo, useState } from 'react'
import { CalcNumberField } from './CalcNumberField'
import { HubBrandBar } from './HubBrandBar'
import { HubDesktopNav } from './HubDesktopNav'
import {
  computeImportados,
  DEFAULT_IMPORTADOS_INPUTS,
  loadImportadosPrefsLocal,
  saveImportadosPrefsLocal,
  type ImportadosInputs,
  type ImportadosResults,
} from '../lib/importadosCalc'
import type { HubUserRole } from '../lib/types'

interface HubImportadosAppProps {
  profileRole?: HubUserRole | null
  adminSignOut?: boolean
}

const usdFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const arsFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const arsExactFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function formatUsd(value: number): string {
  return usdFmt.format(value)
}

function formatArs(value: number, exact = false): string {
  return (exact ? arsExactFmt : arsFmt).format(value)
}

function formatPct(rate: number): string {
  return `${(rate * 100).toLocaleString('es-AR', { maximumFractionDigits: 1 })}%`
}

function BreakdownRow({
  label,
  usd,
  ars,
  strong = false,
  hint,
}: {
  label: string
  usd: string
  ars: string
  strong?: boolean
  hint?: string
}) {
  return (
    <div className={`importados-breakdown__row${strong ? ' importados-breakdown__row--strong' : ''}`}>
      <span className="importados-breakdown__label">
        {label}
        {hint ? <span className="importados-breakdown__hint">{hint}</span> : null}
      </span>
      <span className="importados-breakdown__usd">{usd}</span>
      <span className="importados-breakdown__ars">{ars}</span>
    </div>
  )
}

function CostBreakdown({
  result,
  costoProductoUsd,
  fleteInternoUsd,
}: {
  result: ImportadosResults
  costoProductoUsd: number
  fleteInternoUsd: number
}) {
  const multi = result.cantidad > 1
  const qtyHint = multi ? `lote · ${result.cantidad} u.` : undefined

  return (
    <section className="printing3d-output-block">
      <h2 className="printing3d-output-block__title">
        Desglose{multi ? ` del lote (${result.cantidad} u.)` : ''}
      </h2>
      <div className="importados-breakdown">
        <div className="importados-breakdown__head">
          <span>Concepto</span>
          <span>USD</span>
          <span>ARS</span>
        </div>
        <BreakdownRow
          label={multi ? `Costo producto (${result.cantidad} × ${formatUsd(costoProductoUsd)})` : 'Costo producto'}
          usd={formatUsd(costoProductoUsd * result.cantidad)}
          ars={formatArs(result.costoProductoArs, true)}
        />
        {fleteInternoUsd > 0 ? (
          <BreakdownRow
            label="Flete interno EE. UU."
            usd={formatUsd(fleteInternoUsd)}
            ars={formatArs(result.fleteInternoArs, true)}
            hint={qtyHint}
          />
        ) : null}
        <BreakdownRow
          label="Flete Miami (Aerobox)"
          usd={formatUsd(result.fleteAeroboxUsd)}
          ars={formatArs(result.fleteAeroboxArs, true)}
        />
        <BreakdownRow
          label="Base imponible"
          usd={formatUsd(result.baseImponibleUsd)}
          ars={formatArs(result.baseImponibleArs, true)}
        />
        <BreakdownRow
          label="Handling Aerobox"
          usd={formatUsd(result.handlingAeroboxUsd)}
          ars={formatArs(result.handlingAeroboxArs, true)}
          hint={
            multi
              ? `1 guía · ${formatUsd(result.handlingAeroboxUnitUsd)} c/u`
              : undefined
          }
        />
        <BreakdownRow
          label="Gastos aduana no recuperables (6%)"
          usd={formatUsd(result.gastosNoRecuperablesUsd)}
          ars={formatArs(result.gastosNoRecuperablesArs, true)}
        />
        <BreakdownRow
          label="Envío domicilio (AR)"
          usd={formatUsd(result.envioDomicilioUsd)}
          ars={formatArs(result.envioDomicilioArs, true)}
          hint={
            multi ? `1 guía · ${formatUsd(result.envioDomicilioUnitUsd)} c/u` : undefined
          }
        />
        <BreakdownRow
          label="Costo landed"
          usd={formatUsd(result.costoLandedUsd)}
          ars={formatArs(result.costoLandedArs, true)}
          strong
        />
        <BreakdownRow
          label="Impuestos transaccionales (6.5%)"
          usd={formatUsd(result.impuestosTransaccionalesUsd)}
          ars={formatArs(result.impuestosTransaccionalesArs, true)}
        />
        <BreakdownRow
          label="Costo con fricción"
          usd={formatUsd(result.costoConFriccionUsd)}
          ars={formatArs(result.costoConFriccionArs, true)}
        />
        <BreakdownRow
          label="Subtotal con margen"
          usd={formatUsd(result.subtotalConMargenUsd)}
          ars={formatArs(result.subtotalConMargenArs, true)}
        />
        <BreakdownRow
          label="Buffer financiero percepciones (7.5%)"
          usd={formatUsd(result.bufferFinancieroUsd)}
          ars={formatArs(result.bufferFinancieroArs, true)}
        />
        <BreakdownRow
          label={multi ? 'Precio final del lote' : 'Precio final'}
          usd={formatUsd(result.precioContadoLoteUsd)}
          ars={formatArs(result.precioContadoLoteArs)}
          strong
        />
        {multi ? (
          <BreakdownRow
            label="Precio final por unidad"
            usd={formatUsd(result.precioContadoUsd)}
            ars={formatArs(result.precioContadoArs)}
            strong
          />
        ) : null}
      </div>
    </section>
  )
}

function YieldPanel({ result }: { result: ImportadosResults }) {
  const multi = result.cantidad > 1
  return (
    <section className="printing3d-output-block importados-yield">
      <h2 className="printing3d-output-block__title">Rendimiento</h2>
      <div className="importados-yield__grid">
        <div className="importados-yield__stat importados-yield__stat--profit">
          <span className="importados-yield__label">
            {multi ? 'Ganancia neta (lote)' : 'Ganancia neta'}
          </span>
          <strong className="importados-yield__value">{formatUsd(result.gananciaNetaUsd)}</strong>
          <span className="importados-yield__sub">
            {formatArs(result.gananciaNetaArs)}
            {multi ? ` · ${formatUsd(result.gananciaNetaUnitUsd)} c/u` : ''}
          </span>
        </div>
        <div className="importados-yield__stat">
          <span className="importados-yield__label">Margen aplicado</span>
          <strong className="importados-yield__value">{formatPct(result.margin.marginRate)}</strong>
          <span className="importados-yield__sub">{result.margin.label}</span>
        </div>
      </div>
    </section>
  )
}

export function HubImportadosApp({
  profileRole,
  adminSignOut = false,
}: HubImportadosAppProps) {
  const prefs = useMemo(() => loadImportadosPrefsLocal(), [])
  const [inputs, setInputs] = useState<ImportadosInputs>({
    ...DEFAULT_IMPORTADOS_INPUTS,
    ...prefs,
  })
  const [mepStatus, setMepStatus] = useState<'loading' | 'live' | 'fallback'>('loading')

  useEffect(() => {
    let cancelled = false
    void fetch('/api/importados-sync/dolar-mep', {
      headers: { Accept: 'application/json' },
    })
      .then(async (resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        return (await resp.json()) as {
          venta?: number
          source?: 'dolarapi' | 'fallback'
        }
      })
      .then((quote) => {
        if (cancelled) return
        const venta = Number(quote.venta)
        if (quote.source === 'dolarapi' && Number.isFinite(venta) && venta > 0) {
          setInputs((prev) => ({ ...prev, dolarArs: venta }))
          setMepStatus('live')
          return
        }
        setMepStatus('fallback')
      })
      .catch(() => {
        if (!cancelled) setMepStatus('fallback')
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    saveImportadosPrefsLocal({
      pesoKg: inputs.pesoKg,
      aeroboxUsdPorKg: inputs.aeroboxUsdPorKg,
      fleteInternoUsd: inputs.fleteInternoUsd,
      envioDomicilioUsd: inputs.envioDomicilioUsd,
      dolarArs: inputs.dolarArs,
      cotizarEnCantidad: inputs.cotizarEnCantidad,
      cantidad: inputs.cantidad,
    })
  }, [
    inputs.pesoKg,
    inputs.aeroboxUsdPorKg,
    inputs.fleteInternoUsd,
    inputs.envioDomicilioUsd,
    inputs.dolarArs,
    inputs.cotizarEnCantidad,
    inputs.cantidad,
  ])

  const result = useMemo(() => computeImportados(inputs), [inputs])

  const patch = (partial: Partial<ImportadosInputs>) => {
    setInputs((prev) => ({ ...prev, ...partial }))
  }

  const multi = inputs.cotizarEnCantidad

  return (
    <div className="nm-hub-app nm-hub-app--3d nm-hub-app--importados">
      <header className="dashboard-navbar dashboard-navbar-clean nm-hub-header">
        <HubBrandBar
          integratedDashboard
          integratedSubtitle="Calculadora Importados"
          adminSignOut={adminSignOut}
        />
      </header>

      <HubDesktopNav role={profileRole} />

      <div className="printing3d-page importados-page">
        <header className="printing3d-page__head">
          <div className="printing3d-page__head-row">
            <h1 className="printing3d-page__title">Importados</h1>
          </div>
          <p className="printing3d-page__lead importados-page__lead">
            Contado (MEP +2%) y cuotas blindadas al peor caso Mercado Pago 6 cuotas.
          </p>
        </header>

        <div className="printing3d-layout">
          <div className="printing3d-layout__inputs">
            <section className="printing3d-section">
              <h2 className="printing3d-section__title">Entrada</h2>
              <div className="printing3d-section__grid">
                <CalcNumberField
                  id="imp-costo"
                  label="Costo producto (c/u)"
                  value={inputs.costoProductoUsd}
                  onChange={(v) => patch({ costoProductoUsd: v })}
                  step={0.01}
                  suffix="USD"
                  hint="Precio unitario B2B en EE. UU. (el margen usa este valor)"
                />

                <div className="printing3d-field printing3d-field--full">
                  <label className="importados-qty-toggle">
                    <input
                      type="checkbox"
                      className="importados-qty-toggle__input"
                      checked={inputs.cotizarEnCantidad}
                      onChange={(e) =>
                        patch({
                          cotizarEnCantidad: e.target.checked,
                          cantidad:
                            e.target.checked && inputs.cantidad < 2 ? 10 : inputs.cantidad,
                        })
                      }
                    />
                    <span className="importados-qty-toggle__box" aria-hidden="true" />
                    <span className="importados-qty-toggle__text">
                      <strong>Cotizar en cantidad</strong>
                      <span>
                        Prorratea handling y envío AR en el lote; el margen sigue el costo
                        unitario.
                      </span>
                    </span>
                  </label>
                </div>

                {multi ? (
                  <CalcNumberField
                    id="imp-cantidad"
                    label="Cantidad"
                    value={inputs.cantidad}
                    onChange={(v) => patch({ cantidad: v })}
                    min={2}
                    step={1}
                    suffix="u."
                    hint="Mínimo 2 · mismo producto en un solo envío"
                  />
                ) : null}

                <CalcNumberField
                  id="imp-peso"
                  label={multi ? 'Peso del paquete (total)' : 'Peso del paquete'}
                  value={inputs.pesoKg}
                  onChange={(v) => patch({ pesoKg: v })}
                  step={0.01}
                  suffix="kg"
                  hint={
                    multi
                      ? 'Peso real de todo el envío (Aerobox, sin volumen)'
                      : 'Aerobox cobra solo peso real (sin volumen)'
                  }
                />
                <CalcNumberField
                  id="imp-aerobox"
                  label="Tarifa Aerobox"
                  value={inputs.aeroboxUsdPorKg}
                  onChange={(v) => patch({ aeroboxUsdPorKg: v })}
                  step={0.5}
                  suffix="USD/kg"
                  hint="Cotización actual ~$17–20 / kg"
                />
                <CalcNumberField
                  id="imp-flete"
                  label={multi ? 'Flete interno EE. UU. (total)' : 'Flete interno EE. UU.'}
                  value={inputs.fleteInternoUsd}
                  onChange={(v) => patch({ fleteInternoUsd: v })}
                  step={0.01}
                  suffix="USD"
                  hint={multi ? 'Costo de llevar todo el pedido a Miami' : undefined}
                />
                <CalcNumberField
                  id="imp-envio"
                  label={multi ? 'Envío domicilio AR (1 guía)' : 'Envío a domicilio (AR)'}
                  value={inputs.envioDomicilioUsd}
                  onChange={(v) => patch({ envioDomicilioUsd: v })}
                  step={0.5}
                  suffix="USD"
                  hint={
                    multi
                      ? 'Una sola guía; se divide entre las unidades'
                      : 'Monto fijo por guía en Argentina (editable)'
                  }
                />
                <CalcNumberField
                  id="imp-dolar"
                  label="Dólar MEP"
                  value={inputs.dolarArs}
                  onChange={(v) => patch({ dolarArs: v })}
                  step={1}
                  suffix="ARS"
                  hint={
                    mepStatus === 'loading'
                      ? 'Consultando DólarAPI…'
                      : mepStatus === 'live'
                        ? 'Cotización automática de DólarAPI; se aplica +2%'
                        : 'Fallback manual: DólarAPI no disponible; se aplica +2%'
                  }
                />
              </div>
            </section>
          </div>

          <div className="printing3d-layout__results">
            {!result.valid ? (
              <div className="printing3d-errors" role="status">
                <p className="printing3d-errors__title">Completá los datos</p>
                <ul>
                  {result.errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <>
                <section className="printing3d-output-block printing3d-summary importados-hero-card">
                  <h2 className="printing3d-output-block__title">
                    {result.cantidad > 1
                      ? `Precios · ${result.cantidad} unidades`
                      : 'Precios finales'}
                  </h2>
                  <div className="importados-hero">
                    <div className="importados-hero__main">
                      <span className="importados-hero__label">
                        {result.cantidad > 1
                          ? 'Contado / Transferencia · c/u'
                          : 'Contado / Transferencia'}
                      </span>
                      <strong className="importados-hero__value">
                        {formatArs(result.precioContadoArs)}
                      </strong>
                      <span className="importados-hero__sub">
                        {formatUsd(result.precioContadoUsd)} · MEP{' '}
                        {formatArs(result.dolarMepConvertido, true)} (+2%)
                      </span>
                    </div>
                    <div className="importados-hero__side">
                      <span className="importados-hero__label">
                        {result.cantidad > 1 ? 'Cuotas / Tarjeta · c/u' : 'Cuotas / Tarjeta'}
                      </span>
                      <strong className="importados-hero__cuotas">
                        {formatArs(result.precioCuotasArs)}
                      </strong>
                      <span className="importados-hero__sub">Blindado MP 6 cuotas</span>
                    </div>
                  </div>
                  {result.cantidad > 1 ? (
                    <div className="importados-hero-lote">
                      <div className="importados-hero-lote__item">
                        <span>Lote contado</span>
                        <strong>{formatArs(result.precioContadoLoteArs)}</strong>
                        <span>{formatUsd(result.precioContadoLoteUsd)}</span>
                      </div>
                      <div className="importados-hero-lote__item">
                        <span>Lote cuotas</span>
                        <strong>{formatArs(result.precioCuotasLoteArs)}</strong>
                      </div>
                    </div>
                  ) : null}
                </section>

                <CostBreakdown
                  result={result}
                  costoProductoUsd={inputs.costoProductoUsd}
                  fleteInternoUsd={inputs.fleteInternoUsd}
                />
                <YieldPanel result={result} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
