import { useMemo } from 'react'
import { hubDesktopNavLinks } from '../lib/hubPermissions'
import { onHubLinkClick } from '../lib/hubNavigate'
import type { HubUserRole } from '../lib/types'

function normalizePath(path: string): string {
  let p = (path || '/').toLowerCase()
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
  return p
}

function isActivePath(current: string, href: string): boolean {
  const path = normalizePath(current)
  const target = normalizePath(href.split('?')[0].split('#')[0])
  if (target === '/') return path === '/'
  return path === target || path.startsWith(`${target}/`)
}

export function HubDesktopNav({
  role,
  currentPath,
}: {
  role: HubUserRole | null | undefined
  currentPath?: string
}) {
  const path =
    currentPath ??
    (typeof window !== 'undefined' ? window.location.pathname : '/')

  const links = useMemo(() => hubDesktopNavLinks(role), [role])
  if (!links.length) return null

  return (
    <nav className="hub-desktop-nav" aria-label="Menú principal">
      <ul className="hub-desktop-nav__list">
        {links.map((item) => {
          const active = isActivePath(path, item.href)
          return (
            <li key={item.href}>
              <a
                href={item.href}
                className={`hub-desktop-nav__link${active ? ' hub-desktop-nav__link--active' : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={(e) => onHubLinkClick(e, item.href)}
              >
                {item.label}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
