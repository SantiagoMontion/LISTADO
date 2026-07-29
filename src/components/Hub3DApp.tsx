import { useEffect, useMemo, useState } from 'react'
import { HubBrandBar } from './HubBrandBar'
import { HubDesktopNav } from './HubDesktopNav'
import {
  bedPrintTimeOptionsIncluding,
  bedTimeToTotalMinutes,
  buildBedPrintTimeOptions,
  computePrinting3D,
  DEFAULT_PRINTING_3D_PRINTER_CONFIG,
  DEFAULT_PRINTING_3D_QUOTE_INPUTS,
  loadPrinting3DPrinterConfig,
  mergePrinting3DInputs,
  savePrinting3DPrinterConfig,
  totalMinutesToBedTime,
  type Printing3DPrinterConfig,
  type Printing3DQuoteInputs,
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

interface ProfitFieldProps {
  value: number
  onChange: (value: number) => void
  id?: string
}

function ProfitField({ value, onChange, id = 'porcentaje-ganancia' }: ProfitFieldProps) {
  return (
    <div className="printing3d-field printing3d-field--full">
      <label className="printing3d-field__label" htmlFor={id}>
        Porcentaje de ganancia deseada
      </label>
      <div className="printing3d-slider-row">
        <input
          id={id}
          className="printing3d-slider"
          type="range"
          min={0}
          max={95}
          step={1}
          value={Math.min(95, value)}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <input
          className="nm-hub-input printing3d-slider__number"
          type="number"
          inputMode="decimal"
          min={0}
          max={99}
          step={1}
          value={value}
          aria-label="Porcentaje de ganancia deseada"
          onChange={(e) => {
            const parsed = Number.parseFloat(e.target.value)
            onChange(Number.isFinite(parsed) ? parsed : 0)
          }}
        />
        <span className="printing3d-field__suffix">%</span>
      </div>
    </div>
  )
}

const BED_PRINT_TIME_OPTIONS = buildBedPrintTimeOptions()

interface BedPrintTimeSelectProps {
  horasCama: number
  minutosCama: number
  onChange: (horasCama: number, minutosCama: number) => void
}

function BedPrintTimeSelect({ horasCama, minutosCama, onChange }: BedPrintTimeSelectProps) {
  const options = useMemo(
    () => bedPrintTimeOptionsIncluding(horasCama, minutosCama, BED_PRINT_TIME_OPTIONS),
    [horasCama, minutosCama],
  )
  const totalMinutes = bedTimeToTotalMinutes(horasCama, minutosCama)

  return (
    <label className="printing3d-field" htmlFor="tiempo-cama">
      <span className="printing3d-field__label">Tiempo de impresión de la cama</span>
      <select
        id="tiempo-cama"
        className="nm-hub-input printing3d-select"
        value={totalMinutes}
        onChange={(e) => {
          const { horasCama: h, minutosCama: m } = totalMinutesToBedTime(
            Number(e.target.value),
          )
          onChange(h, m)
        }}
      >
        {options.map((option) => (
          <option key={option.totalMinutes} value={option.totalMinutes}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
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

interface PrinterConfigModalProps {
  open: boolean
  config: Printing3DPrinterConfig
  onChange: (config: Printing3DPrinterConfig) => void
  onClose: () => void
}

function PrinterConfigModal({ open, config, onChange, onClose }: PrinterConfigModalProps) {
  if (!open) return null

  const patch = (partial: Partial<Printing3DPrinterConfig>) => {
    onChange({ ...config, ...partial })
  }

  return (
    <div
      className="upload-images-modal-backdrop printing3d-config-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="upload-images-modal printing3d-config-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="printing3d-config-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="printing3d-config-modal__head">
          <h2 id="printing3d-config-title" className="modal-title-rebel">
            Configurar impresora
          </h2>
          <p className="printing3d-config-modal__lead">
            Estos valores se guardan en este dispositivo y se usan en todas las cotizaciones.
          </p>
        </header>

        <div className="printing3d-config-modal__body">
          <InputSection title="Material (filamento)">
            <NumberField
              id="cfg-precio-rollo"
              label="Precio del rollo"
              value={config.precioRollo}
              onChange={(v) => patch({ precioRollo: v })}
              step={100}
              suffix="$"
            />
            <NumberField
              id="cfg-peso-rollo"
              label="Peso del rollo"
              value={config.pesoRolloGramos}
              onChange={(v) => patch({ pesoRolloGramos: v })}
              min={1}
              step={50}
              suffix="g"
            />
            <NumberField
              id="cfg-peso-purga"
              label="Purga / soportes / desperdicio por cama"
              value={config.pesoPurgaCama}
              onChange={(v) => patch({ pesoPurgaCama: v })}
              step={0.1}
              suffix="g"
            />
          </InputSection>

          <InputSection title="Máquina y energía">
            <NumberField
              id="cfg-valor-impresora"
              label="Valor / costo de la impresora"
              value={config.valorImpresora}
              onChange={(v) => patch({ valorImpresora: v })}
              step={1000}
              suffix="$"
            />
            <NumberField
              id="cfg-vida-util"
              label="Vida útil estimada"
              value={config.vidaUtilHoras}
              onChange={(v) => patch({ vidaUtilHoras: v })}
              min={1}
              step={100}
              suffix="hs"
            />
            <NumberField
              id="cfg-consumo-watts"
              label="Consumo eléctrico promedio"
              value={config.consumoWatts}
              onChange={(v) => patch({ consumoWatts: v })}
              step={5}
              suffix="W"
            />
            <NumberField
              id="cfg-costo-kwh"
              label="Costo del kWh"
              value={config.costoKwh}
              onChange={(v) => patch({ costoKwh: v })}
              step={1}
              suffix="$/kWh"
            />
          </InputSection>

          <InputSection title="Mano de obra e insumos">
            <NumberField
              id="cfg-costo-hora"
              label="Costo hora de trabajo"
              value={config.costoHoraTrabajo}
              onChange={(v) => patch({ costoHoraTrabajo: v })}
              step={100}
              suffix="$/h"
            />
            <NumberField
              id="cfg-minutos-post"
              label="Preparación / post-procesado por pieza"
              value={config.minutosPostproceso}
              onChange={(v) => patch({ minutosPostproceso: v })}
              step={1}
              suffix="min"
            />
            <NumberField
              id="cfg-insumos-extra"
              label="Insumos extra por pieza"
              value={config.insumosExtraPieza}
              onChange={(v) => patch({ insumosExtraPieza: v })}
              step={10}
              suffix="$"
            />
          </InputSection>

          <InputSection title="Márgenes y riesgos">
            <NumberField
              id="cfg-porcentaje-fallos"
              label="Porcentaje de fallos / mermas"
              value={config.porcentajeFallos}
              onChange={(v) => patch({ porcentajeFallos: v })}
              step={0.5}
              suffix="%"
            />
          </InputSection>
        </div>

        <div className="printing3d-config-modal__actions">
          <button type="button" className="printing3d-config-modal__btn" onClick={onClose}>
            Listo
          </button>
        </div>
      </div>
    </div>
  )
}

export function Hub3DApp({ profileRole, adminSignOut = false }: Hub3DAppProps) {
  const [printerConfig, setPrinterConfig] = useState<Printing3DPrinterConfig>(
    DEFAULT_PRINTING_3D_PRINTER_CONFIG,
  )
  const [quote, setQuote] = useState<Printing3DQuoteInputs>(DEFAULT_PRINTING_3D_QUOTE_INPUTS)
  const [configOpen, setConfigOpen] = useState(false)
  const [configReady, setConfigReady] = useState(false)

  useEffect(() => {
    setPrinterConfig(loadPrinting3DPrinterConfig())
    setConfigReady(true)
  }, [])

  useEffect(() => {
    if (!configReady) return
    savePrinting3DPrinterConfig(printerConfig)
  }, [printerConfig, configReady])

  const inputs = useMemo(
    () => mergePrinting3DInputs(printerConfig, quote),
    [printerConfig, quote],
  )
  const result = useMemo(() => computePrinting3D(inputs), [inputs])

  const patchQuote = (partial: Partial<Printing3DQuoteInputs>) => {
    setQuote((prev) => ({ ...prev, ...partial }))
  }

  return (
    <div className="nm-hub-app nm-hub-app--3d">
      <header className="dashboard-navbar dashboard-navbar-clean nm-hub-header">
        <HubBrandBar integratedDashboard integratedSubtitle="3D" adminSignOut={adminSignOut} />
      </header>

      <HubDesktopNav role={profileRole} />

      <div className="printing3d-page">
        <header className="printing3d-page__head">
          <div className="printing3d-page__head-row">
            <div>
              <h1 className="printing3d-page__title">Calculadora de impresión 3D</h1>
              <p className="printing3d-page__lead">
                Ingresá los datos de la pieza y obtené el precio de venta al instante.
              </p>
            </div>
            <button
              type="button"
              className="printing3d-config-btn"
              onClick={() => setConfigOpen(true)}
            >
              Configurar impresora
            </button>
          </div>
        </header>

        <div className="printing3d-layout">
          <div className="printing3d-layout__inputs">
            <InputSection title="Cotización">
              <NumberField
                id="peso-pieza"
                label="Peso de la pieza"
                value={quote.pesoPieza}
                onChange={(v) => patchQuote({ pesoPieza: v })}
                step={0.1}
                suffix="g"
              />
              <BedPrintTimeSelect
                horasCama={quote.horasCama}
                minutosCama={quote.minutosCama}
                onChange={(horasCama, minutosCama) => patchQuote({ horasCama, minutosCama })}
              />
              <NumberField
                id="piezas-cama"
                label="Piezas por cama"
                value={quote.piezasPorCama}
                onChange={(v) =>
                  patchQuote({ piezasPorCama: Math.max(1, Math.floor(v)) })
                }
                min={1}
                step={1}
                suffix="u"
              />
              <NumberField
                id="cantidad-total"
                label="Cantidad total a cotizar"
                value={quote.cantidadTotalUnidades}
                onChange={(v) =>
                  patchQuote({ cantidadTotalUnidades: Math.max(1, Math.floor(v)) })
                }
                min={1}
                step={1}
                suffix="u"
              />
              <ProfitField
                value={quote.porcentajeGanancia}
                onChange={(v) => patchQuote({ porcentajeGanancia: v })}
              />
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

      <PrinterConfigModal
        open={configOpen}
        config={printerConfig}
        onChange={setPrinterConfig}
        onClose={() => setConfigOpen(false)}
      />
    </div>
  )
}
