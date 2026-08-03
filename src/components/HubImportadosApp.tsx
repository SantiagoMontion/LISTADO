import { useEffect, useMemo, useState } from 'react'
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

interface NumberFieldProps {
  id: string
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  step?: number
  suffix?: string
  hint?: string
}

function NumberField({
  id,
  label,
  value,
  onChange,
  min = 0,
  step = 1,
  suffix,
  hint,
}: NumberFieldProps) {
  return (
    <label className="printing3d-field" htmlFor={id}>
      <span className="printing3d-field__label">{label}</span>
      <div className="printing3d-field__control">
        <input
          id={id}
          className="nm-hub-input printing3d-field__input"
          type="number"
          inputMode="decimal"
          min={min}
          step={step}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => {
            const parsed = Number.parseFloat(e.target.value)
            onChange(Number.isFinite(parsed) ? parsed : 0)
          }}
        />
        {suffix ? <span className="printing3d-field__suffix">{suffix}</span> : null}
      </div>
      {hint ? <span className="importados-field-hint">{hint}</span> : null}
    </label>
  )
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
}: {
  result: ImportadosResults
  costoProductoUsd: number
}) {
  return (
    <section className="printing3d-output-block">
      <h2 className="printing3d-output-block__title">Desglose de costos</h2>
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
        <BreakdownRow
          label="Flete Miami (Aerobox)"
          usd={formatUsd(result.fleteAeroboxUsd)}
          ars={formatArs(result.fleteAeroboxArs, true)}
        />
        <BreakdownRow
          label="Impuestos aduana / S.A."
          usd={formatUsd(result.impuestosSaUsd)}
          ars={formatArs(result.impuestosSaArs, true)}
        />
        <BreakdownRow
          label="Costo landed total"
          usd={formatUsd(result.costoLandedUsd)}
          ars={formatArs(result.costoLandedArs, true)}
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
      fleteInternoUsd: inputs.fleteInternoUsd,
      dolarArs: inputs.dolarArs,
      recargoCuotasPct: inputs.recargoCuotasPct,
    })
  }, [inputs.pesoKg, inputs.fleteInternoUsd, inputs.dolarArs, inputs.recargoCuotasPct])

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
            Nacionalización B2B EE. UU. → precio sugerido en ARS (contado y cuotas).
          </p>
        </header>

        <div className="printing3d-layout">
          <div className="printing3d-layout__inputs">
            <section className="printing3d-section">
              <h2 className="printing3d-section__title">Entrada</h2>
              <div className="printing3d-section__grid">
                <NumberField
                  id="imp-costo"
                  label="Costo producto"
                  value={inputs.costoProductoUsd}
                  onChange={(v) => patch({ costoProductoUsd: v })}
                  step={0.01}
                  suffix="USD"
                  hint="Campo principal (precio B2B en EE. UU.)"
                />
                <NumberField
                  id="imp-peso"
                  label="Peso del paquete"
                  value={inputs.pesoKg}
                  onChange={(v) => patch({ pesoKg: v })}
                  step={0.01}
                  suffix="kg"
                />
                <NumberField
                  id="imp-flete"
                  label="Flete interno EE. UU."
                  value={inputs.fleteInternoUsd}
                  onChange={(v) => patch({ fleteInternoUsd: v })}
                  step={0.01}
                  suffix="USD"
                />
                <NumberField
                  id="imp-dolar"
                  label="Dólar MEP / CCL"
                  value={inputs.dolarArs}
                  onChange={(v) => patch({ dolarArs: v })}
                  step={1}
                  suffix="ARS"
                />
                <NumberField
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

                <CostBreakdown result={result} costoProductoUsd={inputs.costoProductoUsd} />
                <YieldPanel result={result} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
