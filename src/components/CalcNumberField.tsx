import { useEffect, useRef, useState } from 'react'

export interface CalcNumberFieldProps {
  id: string
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  step?: number
  suffix?: string
  hint?: string
}

function parseCalcNumber(raw: string): number | null {
  const normalized = raw.trim().replace(',', '.')
  if (normalized === '' || normalized === '.' || normalized === '-' || normalized === '-.') {
    return null
  }
  const parsed = Number.parseFloat(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function displayFromValue(value: number): string {
  if (!Number.isFinite(value) || value === 0) return ''
  return String(value)
}

/** Number input for calculators: no sticky leading zero when typing over 0. */
export function CalcNumberField({
  id,
  label,
  value,
  onChange,
  min = 0,
  step = 1,
  suffix,
  hint,
}: CalcNumberFieldProps) {
  const focusedRef = useRef(false)
  const [text, setText] = useState(() => displayFromValue(value))

  useEffect(() => {
    if (!focusedRef.current) setText(displayFromValue(value))
  }, [value])

  return (
    <label className="printing3d-field" htmlFor={id}>
      <span className="printing3d-field__label">{label}</span>
      <div className="printing3d-field__control">
        <input
          id={id}
          className="nm-hub-input printing3d-field__input"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={text}
          onFocus={(e) => {
            focusedRef.current = true
            e.currentTarget.select()
          }}
          onBlur={() => {
            focusedRef.current = false
            const parsed = parseCalcNumber(text)
            const next = parsed === null ? 0 : Math.max(min, parsed)
            onChange(next)
            setText(displayFromValue(next))
          }}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^\d.,]/g, '')
            setText(raw)
            const parsed = parseCalcNumber(raw)
            if (parsed === null) {
              onChange(0)
              return
            }
            onChange(Math.max(min, parsed))
          }}
        />
        {suffix ? <span className="printing3d-field__suffix">{suffix}</span> : null}
      </div>
      {hint ? <span className="importados-field-hint">{hint}</span> : null}
    </label>
  )
}
