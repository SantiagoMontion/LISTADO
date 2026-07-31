import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type HubTasksPillOption<T extends string> = {
  value: T
  label: string
  /** Extra class(es) for the colored pill look (trigger + option). */
  toneClass: string
}

type HubTasksPillSelectProps<T extends string> = {
  value: T
  options: HubTasksPillOption<T>[]
  disabled?: boolean
  'aria-label': string
  onChange: (value: T) => void
}

type MenuPos = { top: number; left: number; minWidth: number }

export function HubTasksPillSelect<T extends string>({
  value,
  options,
  disabled = false,
  'aria-label': ariaLabel,
  onChange,
}: HubTasksPillSelectProps<T>) {
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLUListElement>(null)
  const listId = useId()
  const selected = options.find((o) => o.value === value) ?? options[0]

  const updateMenuPos = () => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const gap = 4
    const estimatedH = options.length * 36 + 16
    const spaceBelow = window.innerHeight - r.bottom
    const openUp = spaceBelow < estimatedH && r.top > spaceBelow
    setMenuPos({
      top: openUp ? Math.max(8, r.top - estimatedH - gap) : r.bottom + gap,
      left: Math.min(r.left, window.innerWidth - Math.max(r.width, 132) - 8),
      minWidth: Math.max(r.width, 132),
    })
  }

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null)
      return
    }
    updateMenuPos()
    const onScroll = () => updateMenuPos()
    window.addEventListener('resize', onScroll)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('resize', onScroll)
      window.removeEventListener('scroll', onScroll, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- options length only for height estimate
  }, [open, options.length])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!selected) return null

  const menu =
    open && menuPos
      ? createPortal(
          <ul
            ref={menuRef}
            id={listId}
            className="hub-tasks-pill-select__menu"
            role="listbox"
            aria-label={ariaLabel}
            style={{
              top: menuPos.top,
              left: menuPos.left,
              minWidth: menuPos.minWidth,
            }}
          >
            {options.map((opt) => {
              const isSelected = opt.value === value
              return (
                <li key={opt.value} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`hub-tasks-status-select hub-tasks-pill-select__option ${opt.toneClass}${
                      isSelected ? ' hub-tasks-pill-select__option--selected' : ''
                    }`}
                    onClick={() => {
                      setOpen(false)
                      if (opt.value !== value) onChange(opt.value)
                    }}
                  >
                    {opt.label}
                  </button>
                </li>
              )
            })}
          </ul>,
          document.body,
        )
      : null

  return (
    <div className={`hub-tasks-pill-select${open ? ' hub-tasks-pill-select--open' : ''}`} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`hub-tasks-status-select hub-tasks-pill-select__trigger ${selected.toneClass}`}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          if (!disabled) setOpen((v) => !v)
        }}
      >
        <span className="hub-tasks-pill-select__label">{selected.label}</span>
      </button>
      {menu}
    </div>
  )
}
