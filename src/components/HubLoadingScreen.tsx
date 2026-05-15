interface HubLoadingScreenProps {
  label?: string
}

export function HubLoadingScreen({ label = 'Cargando…' }: HubLoadingScreenProps) {
  return (
    <div className="nm-hub-loading" role="status" aria-live="polite">
      <div className="nm-hub-loading-inner">
        <div className="nm-hub-spinner" aria-hidden="true" />
        {label ? <p className="nm-hub-loading-label">{label}</p> : null}
      </div>
    </div>
  )
}
