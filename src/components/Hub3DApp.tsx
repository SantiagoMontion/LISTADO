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
        Ganancia
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
          aria-label="Ganancia"
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
      <span className="printing3d-field__label">Tiempo</span>
      <div className="printing3d-field__control">
        <select
          id="tiempo-cama"
          className="nm-hub-input printing3d-select printing3d-field__input"
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
        <span className="printing3d-field__suffix printing3d-field__suffix--spacer" aria-hidden="true">
          u
        </span>
      </div>
    </label>
  )
}

interface SummaryStatProps {
  label: string
  value: string
  hint?: string
  totalLabel?: string
}

function SummaryStat({ label, value, hint, totalLabel }: SummaryStatProps) {
  return (
    <div className="printing3d-summary-stat">
      <span className="printing3d-summary-stat__label">{label}</span>
      <strong className="printing3d-summary-stat__value">{value}</strong>
      {hint ? <span className="printing3d-summary-stat__hint">{hint}</span> : null}
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
  piezasPorCama: number
}

function MainSummary({ result, sale, piezasPorCama }: MainSummaryProps) {
  const showPerUnit = piezasPorCama > 1

  return (
    <section className="printing3d-output-block printing3d-summary">
      <h2 className="printing3d-output-block__title">Resumen</h2>
      <div className="printing3d-summary__layout">
        <div className="printing3d-summary__side">
          <SummaryStat label="Costo" value={formatMoney(result.costoUnitarioFinal)} />
          <SummaryStat
            label="Ganancia"
            value={formatWholeMoney(sale.gananciaNetaUnitaria)}
            hint={`${formatNumber(sale.margenRealPorcentaje, 1)}%`}
          />
        </div>
        <div className="printing3d-summary__hero">
          <span className="printing3d-summary__hero-label">Precio</span>
          <strong className="printing3d-summary__hero-value">
            {formatWholeMoney(sale.precioVentaUnitario)}
            {showPerUnit ? (
              <span className="printing3d-summary__hero-unit"> c/u</span>
            ) : null}
          </strong>
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
}: Omit<PrinterConfigModalProps, 'cloudSync'> & { cloudSync?: boolean }) {
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
            Impresora
          </h2>
        </header>

        <div className="printing3d-config-modal__body">
          <InputSection title="Filamento">
            <NumberField
              id="cfg-precio-rollo"
              label="Precio rollo"
              value={config.precioRollo}
              onChange={(v) => patch({ precioRollo: v })}
              step={100}
              suffix="$"
            />
            <NumberField
              id="cfg-peso-rollo"
              label="Peso rollo"
              value={config.pesoRolloGramos}
              onChange={(v) => patch({ pesoRolloGramos: v })}
              min={1}
              step={50}
              suffix="g"
            />
            <NumberField
              id="cfg-peso-purga"
              label="Purga"
              value={config.pesoPurgaCama}
              onChange={(v) => patch({ pesoPurgaCama: v })}
              step={0.1}
              suffix="g"
            />
          </InputSection>

          <InputSection title="Máquina">
            <NumberField
              id="cfg-valor-impresora"
              label="Valor"
              value={config.valorImpresora}
              onChange={(v) => patch({ valorImpresora: v })}
              step={1000}
              suffix="$"
            />
            <NumberField
              id="cfg-vida-util"
              label="Vida útil"
              value={config.vidaUtilHoras}
              onChange={(v) => patch({ vidaUtilHoras: v })}
              min={1}
              step={100}
              suffix="hs"
            />
            <NumberField
              id="cfg-consumo-watts"
              label="Consumo"
              value={config.consumoWatts}
              onChange={(v) => patch({ consumoWatts: v })}
              step={5}
              suffix="W"
            />
            <NumberField
              id="cfg-costo-kwh"
              label="kWh"
              value={config.costoKwh}
              onChange={(v) => patch({ costoKwh: v })}
              step={1}
              suffix="$"
            />
          </InputSection>

          <InputSection title="Mano de obra">
            <NumberField
              id="cfg-costo-hora"
              label="Hora"
              value={config.costoHoraTrabajo}
              onChange={(v) => patch({ costoHoraTrabajo: v })}
              step={100}
              suffix="$/h"
            />
            <NumberField
              id="cfg-minutos-post"
              label="Postproceso"
              value={config.minutosPostproceso}
              onChange={(v) => patch({ minutosPostproceso: v })}
              step={1}
              suffix="min"
            />
          </InputSection>

          <InputSection title="Márgenes">
            <NumberField
              id="cfg-porcentaje-fallos"
              label="Fallos"
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
    () => mergePrinting3DInputs(printerConfig, { ...quote, cantidadTotalUnidades: 1 }),
    [printerConfig, quote],
  )
  const result = useMemo(() => computePrinting3D(inputs), [inputs])
  const roundedSale = useMemo(
    () =>
      result.valid
        ? applySalePriceRounding(result, 1, DEFAULT_SALE_PRICE_ROUND_STEP)
        : null,
    [result],
  )

  const patchQuote = (partial: Partial<Printing3DQuoteInputs>) => {
    setQuote((prev) => ({ ...prev, ...partial }))
  }

  return (
    <div className="nm-hub-app nm-hub-app--3d">
      <header className="dashboard-navbar dashboard-navbar-clean nm-hub-header">
        <HubBrandBar integratedDashboard integratedSubtitle="Calculadora 3D" adminSignOut={adminSignOut} />
      </header>

      <HubDesktopNav role={profileRole} />

      <div className="printing3d-page">
        <header className="printing3d-page__head">
          <div className="printing3d-page__head-row">
            <h1 className="printing3d-page__title">Calculadora 3D</h1>
            <button
              type="button"
              className="printing3d-config-btn"
              onClick={() => setConfigOpen(true)}
              disabled={configLoading}
            >
              {configLoading ? '…' : 'Impresora'}
            </button>
          </div>
          {configSaveError ? (
            <p className="printing3d-config-status printing3d-config-status--warn" role="status">
              {configSaveError}
            </p>
          ) : null}
        </header>

        <div className="printing3d-layout">
          <div className="printing3d-layout__inputs">
            <InputSection title="Pieza">
              <NumberField
                id="peso-filamento-cama"
                label="Peso"
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
                label="Por cama"
                value={quote.piezasPorCama}
                onChange={(v) =>
                  patchQuote({ piezasPorCama: Math.max(1, Math.floor(v)) })
                }
                min={1}
                step={1}
                suffix="u"
              />
              <NumberField
                id="insumos-extra"
                label="Extra"
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
                <p className="printing3d-errors__title">Errores</p>
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
                  piezasPorCama={quote.piezasPorCama}
                />

                <ResultAccordion title="Desglose">
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
                      label="Desgaste"
                      value={formatMoney(result.breakdown.costoDepreciacion)}
                    />
                    <BreakdownRow
                      label="Mano de obra"
                      value={formatMoney(result.breakdown.costoManoObra)}
                    />
                    <BreakdownRow
                      label="Extra"
                      value={formatMoney(result.breakdown.insumosExtra)}
                    />
                    <BreakdownRow
                      label="Fallos"
                      value={formatMoney(result.breakdown.reservaFallos)}
                    />
                  </div>
                </ResultAccordion>

                <ResultAccordion title="Producción">
                  <div className="printing3d-logistics">
                    <div className="printing3d-logistics__item">
                      <span>Camas</span>
                      <strong>{numberFmt.format(result.camasTotales)}</strong>
                    </div>
                    <div className="printing3d-logistics__item">
                      <span>Tiempo</span>
                      <strong>{formatHours(result.horasTotalesMaquinado)}</strong>
                    </div>
                    <div className="printing3d-logistics__item">
                      <span>Filamento</span>
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
