import { HubBrandBar } from './HubBrandBar'

interface HubRoleBlockedProps {
  title: string
  message: string
}

export function HubRoleBlocked({ title, message }: HubRoleBlockedProps) {
  return (
    <div className="nm-hub-app">
      <header className="nm-hub-header">
        <HubBrandBar asPageHeading={false} />
        <h1 className="nm-hub-page-title" style={{ marginTop: '0.65rem' }}>
          {title}
        </h1>
      </header>
      <p className="nm-hub-error" role="alert">
        {message}
      </p>
    </div>
  )
}
