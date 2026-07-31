type HubPeriodNavButtonProps = {
  direction: 'prev' | 'next'
  onClick: () => void
  disabled?: boolean
  'aria-label': string
  className?: string
}

/** Flecha de paginación período (mes/día/semana) — estilo Apple. */
export function HubPeriodNavButton({
  direction,
  onClick,
  disabled,
  'aria-label': ariaLabel,
  className = '',
}: HubPeriodNavButtonProps) {
  return (
    <button
      type="button"
      className={`hub-period-nav-btn${className ? ` ${className}` : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      <svg
        className="hub-period-nav-btn__icon"
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        aria-hidden="true"
      >
        {direction === 'prev' ? (
          <path
            d="M14.5 5.5L8 12l6.5 6.5"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <path
            d="M9.5 5.5L16 12l-6.5 6.5"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </button>
  )
}
