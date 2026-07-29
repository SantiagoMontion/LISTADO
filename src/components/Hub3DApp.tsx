import { useMemo, useState } from 'react'
import { HubBrandBar } from './HubBrandBar'
import { HubDesktopNav } from './HubDesktopNav'
import {
  computePrinting3D,
  DEFAULT_PRINTING_3D_INPUTS,
  type Printing3DInputs,
} from '../lib/printing3dCalc'
import type { HubUserRole } from '../lib/types'

interface Hub3DAppProps {
  profileRole?: HubUserRole | null
  adminSignOut?: boolean
}

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const numberFmt = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

function formatMoney(value: number): string {
  return currencyFmt.format(value)
}

function formatNumber(value: number, decimals = 2): string {
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(value)
}

function formatHours(value: number): string {
  const hours = Math.floor(value)
  const minutes = Math.round((value - hours) * 60)
  if (minutes === 0) return `${hours} h`
  return `${hours} h ${minutes} min`
}

interface NumberFieldProps {
  id: string
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  step?: number
  suffix?: string
}

function NumberField({
  id,
  label,
  value,
  onChange,
  min = 0,
  step = 1,
  suffix,
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
    </label>
  )
}

interface InputSectionProps {
  title: string
  children: React.ReactNode
}

function InputSection({ title, children }: InputSectionProps) {
  return (
    <section className="printing3d-section">
      <h2 className="printing3d-section__title">{title}</h2>
      <div className="printing3d-section__grid">{children}</div>
    </section>
  )
}

interface ResultCardProps {
  label: string
  value: string
  sub?: string
  highlight?: boolean
}

function ResultCard({ label, value, sub, highlight }: ResultCardProps) {
  return (
    <div className={`printing3d-result-card${highlight ? ' printing3d-result-card--highlight' : ''}`}>
      <span className="printing3d-result-card__label">{label}</span>
      <strong className="printing3d-result-card__value">{value}</strong>
      {sub ? <span className="printing3d-result-card__sub">{sub}</span> : null}
    </div>
  )
}

interface BreakdownRowProps {
  label: string
  value: string
}

function BreakdownRow({ label, value }: BreakdownRowProps) {
  return (
    <div className="printing3d-breakdown__row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export function Hub3DApp({ profileRole, adminSignOut = false }: Hub3DAppProps) {
  const [inputs, setInputs] = useState<Printing3DInputs>(DEFAULT_PRINTING_3D_INPUTS)

  const result = useMemo(() => computePrinting3D(inputs), [inputs])

  const patch = (partial: Partial<Printing3DInputs>) => {
    setInputs((prev) => ({ ...prev, ...partial }))
  }

  return (
    <div className="nm-hub-app nm-hub-app--3d">
      <header className="dashboard-navbar dashboard-navbar-clean nm-hub-header">
        <HubBrandBar integratedDashboard integratedSubtitle="3D" adminSignOut={adminSignOut} />
      </header>

      <HubDesktopNav role={profileRole} />

      <div className="printing3d-page">
        <header className="printing3d-page__head">
          <h1 className="printing3d-page__title">Calculadora de impresión 3D</h1>
          <p className="printing3d-page__lead">
            Cotizá piezas individuales o lotes completos con costos reales de material, energía,
            máquina y mano de obra.
          </p>
        </header>

        <div className="printing3d-layout">
          <div className="printing3d-layout__inputs">
            <InputSection title="A. Material (filamento)">
              <NumberField
                id="precio-rollo"
                label="Precio del rollo"
                value={inputs.precioRollo}
                onChange={(v) => patch({ precioRollo: v })}
                step={100}
                suffix="$"
              />
              <NumberField
                id="peso-rollo"
                label="Peso del rollo"
                value={inputs.pesoRolloGramos}
                onChange={(v) => patch({ pesoRolloGramos: v })}
                min={1}
                step={50}
                suffix="g"
              />
              <NumberField
                id="peso-pieza"
                label="Peso de la pieza"
                value={inputs.pesoPieza}
                onChange={(v) => patch({ pesoPieza: v })}
                step={0.1}
                suffix="g"
              />
              <NumberField
                id="peso-purga"
                label="Purga / soportes / desperdicio por cama"
                value={inputs.pesoPurgaCama}
                onChange={(v) => patch({ pesoPurgaCama: v })}
                step={0.1}
                suffix="g"
              />
            </InputSection>

            <InputSection title="B. Máquina y energía">
              <NumberField
                id="valor-impresora"
                label="Valor / costo de la impresora"
                value={inputs.valorImpresora}
                onChange={(v) => patch({ valorImpresora: v })}
                step={1000}
                suffix="$"
              />
              <NumberField
                id="vida-util"
                label="Vida útil estimada"
                value={inputs.vidaUtilHoras}
                onChange={(v) => patch({ vidaUtilHoras: v })}
                min={1}
                step={100}
                suffix="hs"
              />
              <NumberField
                id="consumo-watts"
                label="Consumo eléctrico promedio"
                value={inputs.consumoWatts}
                onChange={(v) => patch({ consumoWatts: v })}
                step={5}
                suffix="W"
              />
              <NumberField
                id="costo-kwh"
                label="Costo del kWh"
                value={inputs.costoKwh}
                onChange={(v) => patch({ costoKwh: v })}
                step={1}
                suffix="$/kWh"
              />
            </InputSection>

            <InputSection title="C. Tiempos y producción en lote">
              <NumberField
                id="horas-cama"
                label="Tiempo de impresión de la cama"
                value={inputs.horasCama}
                onChange={(v) => patch({ horasCama: v })}
                suffix="hs"
              />
              <NumberField
                id="minutos-cama"
                label="Minutos adicionales de la cama"
                value={inputs.minutosCama}
                onChange={(v) => patch({ minutosCama: v })}
                step={1}
                suffix="min"
              />
              <NumberField
                id="piezas-cama"
                label="Piezas por cama"
                value={inputs.piezasPorCama}
                onChange={(v) => patch({ piezasPorCama: Math.max(1, Math.floor(v)) })}
                min={1}
                step={1}
                suffix="u"
              />
              <NumberField
                id="cantidad-total"
                label="Cantidad total a cotizar"
                value={inputs.cantidadTotalUnidades}
                onChange={(v) => patch({ cantidadTotalUnidades: Math.max(1, Math.floor(v)) })}
                min={1}
                step={1}
                suffix="u"
              />
            </InputSection>

            <InputSection title="D. Mano de obra e insumos">
              <NumberField
                id="costo-hora"
                label="Costo hora de trabajo"
                value={inputs.costoHoraTrabajo}
                onChange={(v) => patch({ costoHoraTrabajo: v })}
                step={100}
                suffix="$/h"
              />
              <NumberField
                id="minutos-post"
                label="Preparación / post-procesado por pieza"
                value={inputs.minutosPostproceso}
                onChange={(v) => patch({ minutosPostproceso: v })}
                step={1}
                suffix="min"
              />
              <NumberField
                id="insumos-extra"
                label="Insumos extra por pieza"
                value={inputs.insumosExtraPieza}
                onChange={(v) => patch({ insumosExtraPieza: v })}
                step={10}
                suffix="$"
              />
            </InputSection>

            <InputSection title="E. Márgenes y riesgos">
              <NumberField
                id="porcentaje-fallos"
                label="Porcentaje de fallos / mermas"
                value={inputs.porcentajeFallos}
                onChange={(v) => patch({ porcentajeFallos: v })}
                step={0.5}
                suffix="%"
              />
              <div className="printing3d-field printing3d-field--full">
                <label className="printing3d-field__label" htmlFor="porcentaje-ganancia">
                  Porcentaje de ganancia deseada
                </label>
                <div className="printing3d-slider-row">
                  <input
                    id="porcentaje-ganancia"
                    className="printing3d-slider"
                    type="range"
                    min={0}
                    max={95}
                    step={1}
                    value={Math.min(95, inputs.porcentajeGanancia)}
                    onChange={(e) => patch({ porcentajeGanancia: Number(e.target.value) })}
                  />
                  <input
                    className="nm-hub-input printing3d-slider__number"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={99}
                    step={1}
                    value={inputs.porcentajeGanancia}
                    onChange={(e) => {
                      const parsed = Number.parseFloat(e.target.value)
                      patch({ porcentajeGanancia: Number.isFinite(parsed) ? parsed : 0 })
                    }}
                  />
                  <span className="printing3d-field__suffix">%</span>
                </div>
              </div>
            </InputSection>
          </div>

          <div className="printing3d-layout__results">
            {!result.valid ? (
              <div className="printing3d-errors" role="alert">
                <p className="printing3d-errors__title">Revisá estos datos:</p>
                <ul>
                  {result.errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <>
                <section className="printing3d-output-block">
                  <h2 className="printing3d-output-block__title">Resumen principal</h2>
                  <div className="printing3d-result-grid">
                    <ResultCard
                      label="Precio de venta sugerido"
                      value={formatMoney(result.precioVentaUnitario)}
                      sub={`Lote: ${formatMoney(result.precioVentaTotal)}`}
                      highlight
                    />
                    <ResultCard
                      label="Costo total de producción"
                      value={formatMoney(result.costoUnitarioFinal)}
                      sub={`Lote: ${formatMoney(result.costoTotalProduccion)}`}
                    />
                    <ResultCard
                      label="Ganancia neta obtenida"
                      value={formatMoney(result.gananciaNetaTotal)}
                      sub={`Margen real: ${formatNumber(result.margenRealPorcentaje, 1)}%`}
                      highlight
                    />
                  </div>
                </section>

                <section className="printing3d-output-block">
                  <h2 className="printing3d-output-block__title">Desglose del costo unitario</h2>
                  <div className="printing3d-breakdown">
                    <BreakdownRow
                      label="Filamento"
                      value={formatMoney(result.breakdown.costoFilamento)}
                    />
                    <BreakdownRow
                      label="Electricidad"
                      value={formatMoney(result.breakdown.costoElectricidad)}
                    />
                    <BreakdownRow
                      label="Desgaste de máquina"
                      value={formatMoney(result.breakdown.costoDepreciacion)}
                    />
                    <BreakdownRow
                      label="Mano de obra"
                      value={formatMoney(result.breakdown.costoManoObra)}
                    />
                    <BreakdownRow
                      label="Insumos extra"
                      value={formatMoney(result.breakdown.insumosExtra)}
                    />
                    <BreakdownRow
                      label="Reserva fallos / mermas"
                      value={formatMoney(result.breakdown.reservaFallos)}
                    />
                  </div>
                </section>

                <section className="printing3d-output-block">
                  <h2 className="printing3d-output-block__title">Datos logísticos de producción</h2>
                  <div className="printing3d-logistics">
                    <div className="printing3d-logistics__item">
                      <span>Camas / platos necesarios</span>
                      <strong>{numberFmt.format(result.camasTotales)}</strong>
                    </div>
                    <div className="printing3d-logistics__item">
                      <span>Tiempo total de impresión</span>
                      <strong>{formatHours(result.horasTotalesMaquinado)}</strong>
                    </div>
                    <div className="printing3d-logistics__item">
                      <span>Filamento total</span>
                      <strong>
                        {formatNumber(result.filamentoTotalGramos, 1)} g
                        <span className="printing3d-logistics__detail">
                          ({formatNumber(result.rollosRequeridos, 2)} rollos)
                        </span>
                      </strong>
                    </div>
                  </div>
                </section>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
