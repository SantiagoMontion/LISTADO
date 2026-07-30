import { useEffect, useMemo, useRef, useState } from 'react'
import { HubBrandBar } from './HubBrandBar'
import { HubDesktopNav } from './HubDesktopNav'
import {
  fetchPrinting3DPrinterConfig,
  savePrinting3DPrinterConfigRemote,
} from '../lib/printing3dConfigApi'
import {
  applySalePriceRounding,
  bedPrintTimeOptionsIncluding,
  bedTimeToTotalMinutes,
  buildBedPrintTimeOptions,
  computePrinting3D,
  DEFAULT_PRINTING_3D_PRINTER_CONFIG,
  DEFAULT_PRINTING_3D_QUOTE_INPUTS,
  DEFAULT_SALE_PRICE_ROUND_STEP,
  loadPrinting3DPrinterConfigLocal,
  mergePrinting3DInputs,
  savePrinting3DPrinterConfig,
  totalMinutesToBedTime,
  type Printing3DPrinterConfig,
  type Printing3DQuoteInputs,
  type Printing3DRoundedSale,
  type Printing3DResults,
} from '../lib/printing3dCalc'
import type { HubUserRole } from '../lib/types'

interface Hub3DAppProps {
  configured?: boolean
  profileId?: string | null
  profileRole?: HubUserRole | null
  adminSignOut?: boolean
}

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const wholeCurrencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const numberFmt = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

function formatMoney(value: number): string {
  return currencyFmt.format(value)
}

function formatWholeMoney(value: number): string {
  return wholeCurrencyFmt.format(value)
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

interface SummaryStatProps {
  label: string
  value: string
  hint: string
  totalLabel?: string
}

function SummaryStat({ label, value, hint, totalLabel }: SummaryStatProps) {
  return (
    <div className="printing3d-summary-stat">
      <span className="printing3d-summary-stat__label">{label}</span>
      <strong className="printing3d-summary-stat__value">{value}</strong>
      <span className="printing3d-summary-stat__hint">{hint}</span>
      {totalLabel ? <span className="printing3d-summary-stat__total">{totalLabel}</span> : null}
    </div>
  )
}

interface ResultAccordionProps {
  title: string
  children: React.ReactNode
}

function ResultAccordion({ title, children }: ResultAccordionProps) {
  return (
    <details className="printing3d-accordion">
      <summary className="printing3d-accordion__summary">{title}</summary>
      <div className="printing3d-accordion__body">{children}</div>
    </details>
  )
}

interface MainSummaryProps {
  result: Printing3DResults
  sale: Printing3DRoundedSale
  quantity: number
}

function MainSummary({ result, sale, quantity }: MainSummaryProps) {
  const showTotal = quantity > 1
  const totalLabel = (total: number, format: (value: number) => string = formatWholeMoney) =>
    `Total del pedido (${quantity} u.): ${format(total)}`

  return (
    <section className="printing3d-output-block printing3d-summary">
      <h2 className="printing3d-output-block__title">Resumen principal</h2>
      <div className="printing3d-summary__layout">
        <div className="printing3d-summary__side">
          <SummaryStat
            label="Costo de producción"
            value={formatMoney(result.costoUnitarioFinal)}
            hint="por unidad"
            totalLabel={showTotal ? totalLabel(result.costoTotalProduccion, formatMoney) : undefined}
          />
          <SummaryStat
            label="Ganancia neta"
            value={formatWholeMoney(sale.gananciaNetaUnitaria)}
            hint={`por unidad · margen ${formatNumber(sale.margenRealPorcentaje, 1)}%`}
            totalLabel={showTotal ? totalLabel(sale.gananciaNetaTotal) : undefined}
          />
        </div>
        <div className="printing3d-summary__hero">
          <span className="printing3d-summary__hero-label">Precio de venta sugerido</span>
          <strong className="printing3d-summary__hero-value">
            {formatWholeMoney(sale.precioVentaUnitario)}
          </strong>
          <span className="printing3d-summary__hero-hint">por unidad</span>
          {showTotal ? (
            <span className="printing3d-summary__hero-total">
              {totalLabel(sale.precioVentaTotal)}
            </span>
          ) : null}
        </div>
      </div>
    </section>
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
  cloudSync?: boolean
}

function PrinterConfigModal({
  open,
  config,
  onChange,
  onClose,
  cloudSync = false,
}: PrinterConfigModalProps) {
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
            {cloudSync
              ? 'Estos valores se guardan en la nube y los comparte todo el equipo.'
              : 'Estos valores se guardan en este dispositivo hasta conectar Supabase.'}
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

          <InputSection title="Mano de obra">
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

export function Hub3DApp({
  configured = false,
  profileId = null,
  profileRole,
  adminSignOut = false,
}: Hub3DAppProps) {
  const [printerConfig, setPrinterConfig] = useState<Printing3DPrinterConfig>(
    DEFAULT_PRINTING_3D_PRINTER_CONFIG,
  )
  const [quote, setQuote] = useState<Printing3DQuoteInputs>(DEFAULT_PRINTING_3D_QUOTE_INPUTS)
  const [configOpen, setConfigOpen] = useState(false)
  const [configLoading, setConfigLoading] = useState(configured)
  const [configSaveError, setConfigSaveError] = useState<string | null>(null)
  const configHydratedRef = useRef(false)

  useEffect(() => {
    let cancelled = false

    async function hydrateConfig() {
      setConfigLoading(true)
      setConfigSaveError(null)

      let nextConfig = loadPrinting3DPrinterConfigLocal()

      if (configured) {
        try {
          const remoteConfig = await fetchPrinting3DPrinterConfig()
          if (remoteConfig) nextConfig = remoteConfig
        } catch (error) {
          console.warn('[Hub3D] No se pudo cargar config desde Supabase:', error)
          if (!cancelled) {
            setConfigSaveError('No se pudo cargar la config desde la nube. Usando copia local.')
          }
        }
      }

      if (!cancelled) {
        setPrinterConfig(nextConfig)
        savePrinting3DPrinterConfig(nextConfig)
        configHydratedRef.current = true
        setConfigLoading(false)
      }
    }

    void hydrateConfig()
    return () => {
      cancelled = true
    }
  }, [configured])

  useEffect(() => {
    if (!configHydratedRef.current) return

    savePrinting3DPrinterConfig(printerConfig)

    if (!configured) return

    const timer = window.setTimeout(() => {
      void savePrinting3DPrinterConfigRemote(printerConfig, profileId)
        .then(() => setConfigSaveError(null))
        .catch((error) => {
          console.warn('[Hub3D] No se pudo guardar config en Supabase:', error)
          setConfigSaveError('No se pudo guardar en la nube. Quedó guardada solo en este dispositivo.')
        })
    }, 600)

    return () => window.clearTimeout(timer)
  }, [printerConfig, configured, profileId])

  const inputs = useMemo(
    () => mergePrinting3DInputs(printerConfig, quote),
    [printerConfig, quote],
  )
  const result = useMemo(() => computePrinting3D(inputs), [inputs])
  const roundedSale = useMemo(
    () =>
      result.valid
        ? applySalePriceRounding(
            result,
            quote.cantidadTotalUnidades,
            DEFAULT_SALE_PRICE_ROUND_STEP,
          )
        : null,
    [result, quote.cantidadTotalUnidades],
  )

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
              disabled={configLoading}
            >
              {configLoading ? 'Cargando config…' : 'Configurar impresora'}
            </button>
          </div>
          {configSaveError ? (
            <p className="printing3d-config-status printing3d-config-status--warn" role="status">
              {configSaveError}
            </p>
          ) : configured ? (
            <p className="printing3d-config-status" role="status">
              Config compartida del taller (guardada en la nube).
            </p>
          ) : null}
        </header>

        <div className="printing3d-layout">
          <div className="printing3d-layout__inputs">
            <InputSection title="Cotización">
              <NumberField
                id="peso-filamento-cama"
                label="Peso total de filamento de la cama (slicer)"
                value={quote.pesoFilamentoCama}
                onChange={(v) => patchQuote({ pesoFilamentoCama: v })}
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
              <NumberField
                id="insumos-extra"
                label="Insumos extra por pieza (opcional)"
                value={quote.insumosExtraPieza}
                onChange={(v) => patchQuote({ insumosExtraPieza: v })}
                step={10}
                suffix="$"
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
                <MainSummary
                  result={result}
                  sale={roundedSale!}
                  quantity={quote.cantidadTotalUnidades}
                />

                <ResultAccordion title="Desglose del costo unitario">
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
                </ResultAccordion>

                <ResultAccordion title="Datos logísticos de producción">
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
                </ResultAccordion>
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
        cloudSync={configured}
      />
    </div>
  )
}
