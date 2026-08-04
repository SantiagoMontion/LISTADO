import { useEffect, useMemo, useState } from 'react'
import { CalcNumberField } from './CalcNumberField'
import { HubBrandBar } from './HubBrandBar'
import { HubDesktopNav } from './HubDesktopNav'
import {
  computeImportados,
  DEFAULT_IMPORTADOS_INPUTS,
  DESTINO_ENVIO_OPTIONS,
  loadImportadosPrefsLocal,
  saveImportadosPrefsLocal,
  type ImportadosDestinoEnvio,
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
}: {
  label: string
  usd: string
  ars: string
  strong?: boolean
}) {
  return (
    <div className={`importados-breakdown__row${strong ? ' importados-breakdown__row--strong' : ''}`}>
      <span className="importados-breakdown__label">{label}</span>
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
  return (
    <section className="printing3d-output-block">
      <h2 className="printing3d-output-block__title">Desglose</h2>
      <div className="importados-breakdown">
        <div className="importados-breakdown__head">
          <span>Concepto</span>
          <span>USD</span>
          <span>ARS</span>
        </div>
        <BreakdownRow
          label="Costo producto"
          usd={formatUsd(costoProductoUsd)}
          ars={formatArs(result.costoProductoArs, true)}
        />
        {fleteInternoUsd > 0 ? (
          <BreakdownRow
            label="Flete interno EE. UU."
            usd={formatUsd(fleteInternoUsd)}
            ars={formatArs(result.fleteInternoArs, true)}
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
          label="Gastos aduana no recuperables (6%)"
          usd={formatUsd(result.gastosNoRecuperablesUsd)}
          ars={formatArs(result.gastosNoRecuperablesArs, true)}
        />
        <BreakdownRow
          label={`Envío domicilio (${DESTINO_ENVIO_OPTIONS.find((o) => o.id === result.destinoEnvio)?.label ?? ''})`}
          usd={formatUsd(result.envioDomicilioUsd)}
          ars={formatArs(result.envioDomicilioArs, true)}
        />
        <BreakdownRow
          label="Costo real operativo"
          usd={formatUsd(result.costoRealOperativoUsd)}
          ars={formatArs(result.costoRealOperativoArs, true)}
          strong
        />
        <BreakdownRow
          label="Subtotal con margen"
          usd={formatUsd(result.subtotalConMargenUsd)}
          ars={formatArs(result.subtotalConMargenArs, true)}
        />
        <BreakdownRow
          label="Percepciones recuperables (26%)"
          usd={formatUsd(result.percepcionesRecuperablesUsd)}
          ars={formatArs(result.percepcionesRecuperablesArs, true)}
        />
        <BreakdownRow
          label="Precio final"
          usd={formatUsd(result.precioContadoUsd)}
          ars={formatArs(result.precioContadoArs, true)}
          strong
        />
      </div>
    </section>
  )
}

function YieldPanel({ result }: { result: ImportadosResults }) {
  return (
    <section className="printing3d-output-block importados-yield">
      <h2 className="printing3d-output-block__title">Rendimiento</h2>
      <div className="importados-yield__grid">
        <div className="importados-yield__stat importados-yield__stat--profit">
          <span className="importados-yield__label">Ganancia neta</span>
          <strong className="importados-yield__value">{formatUsd(result.gananciaNetaUsd)}</strong>
          <span className="importados-yield__sub">{formatArs(result.gananciaNetaArs)}</span>
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

  useEffect(() => {
    saveImportadosPrefsLocal({
      pesoKg: inputs.pesoKg,
      aeroboxUsdPorKg: inputs.aeroboxUsdPorKg,
      fleteInternoUsd: inputs.fleteInternoUsd,
      destinoEnvio: inputs.destinoEnvio,
      dolarArs: inputs.dolarArs,
      recargoCuotasPct: inputs.recargoCuotasPct,
    })
  }, [
    inputs.pesoKg,
    inputs.aeroboxUsdPorKg,
    inputs.fleteInternoUsd,
    inputs.destinoEnvio,
    inputs.dolarArs,
    inputs.recargoCuotasPct,
  ])

  const result = useMemo(() => computeImportados(inputs), [inputs])

  const patch = (partial: Partial<ImportadosInputs>) => {
    setInputs((prev) => ({ ...prev, ...partial }))
  }

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
            Precio B2B + peso → Aerobox + impuestos 32% + envío AR + margen → precio ARS.
          </p>
        </header>

        <div className="printing3d-layout">
          <div className="printing3d-layout__inputs">
            <section className="printing3d-section">
              <h2 className="printing3d-section__title">Entrada</h2>
              <div className="printing3d-section__grid">
                <CalcNumberField
                  id="imp-costo"
                  label="Costo producto"
                  value={inputs.costoProductoUsd}
                  onChange={(v) => patch({ costoProductoUsd: v })}
                  step={0.01}
                  suffix="USD"
                  hint="Campo principal (precio B2B en EE. UU.)"
                />
                <CalcNumberField
                  id="imp-peso"
                  label="Peso del paquete"
                  value={inputs.pesoKg}
                  onChange={(v) => patch({ pesoKg: v })}
                  step={0.01}
                  suffix="kg"
                  hint="Aerobox cobra solo peso real (sin volumen)"
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
                  label="Flete interno EE. UU."
                  value={inputs.fleteInternoUsd}
                  onChange={(v) => patch({ fleteInternoUsd: v })}
                  step={0.01}
                  suffix="USD"
                />
                <div className="printing3d-field printing3d-field--full">
                  <span className="printing3d-field__label" id="imp-destino-label">
                    Envío a domicilio (AR)
                  </span>
                  <div
                    className="importados-destino-pills"
                    role="group"
                    aria-labelledby="imp-destino-label"
                  >
                    {DESTINO_ENVIO_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        className={`importados-destino-pill${inputs.destinoEnvio === opt.id ? ' is-active' : ''}`}
                        aria-pressed={inputs.destinoEnvio === opt.id}
                        onClick={() => patch({ destinoEnvio: opt.id as ImportadosDestinoEnvio })}
                      >
                        <span className="importados-destino-pill__label">{opt.label}</span>
                        <span className="importados-destino-pill__price">${opt.usd}</span>
                      </button>
                    ))}
                  </div>
                  <span className="importados-field-hint">
                    Por guía, una vez que el paquete ya está en Argentina
                  </span>
                </div>
                <CalcNumberField
                  id="imp-dolar"
                  label="Dólar MEP / CCL"
                  value={inputs.dolarArs}
                  onChange={(v) => patch({ dolarArs: v })}
                  step={1}
                  suffix="ARS"
                />
                <CalcNumberField
                  id="imp-cuotas"
                  label="Recargo cuotas"
                  value={inputs.recargoCuotasPct}
                  onChange={(v) => patch({ recargoCuotasPct: v })}
                  step={1}
                  suffix="%"
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
                  <h2 className="printing3d-output-block__title">Precio final sugerido</h2>
                  <div className="importados-hero">
                    <div className="importados-hero__main">
                      <span className="importados-hero__label">Transferencia / Contado</span>
                      <strong className="importados-hero__value">
                        {formatArs(result.precioContadoArs)}
                      </strong>
                      <span className="importados-hero__sub">
                        {formatUsd(result.precioContadoUsd)}
                      </span>
                    </div>
                    <div className="importados-hero__side">
                      <span className="importados-hero__label">Cuotas</span>
                      <strong className="importados-hero__cuotas">
                        {formatArs(result.precioCuotasArs)}
                      </strong>
                    </div>
                  </div>
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
