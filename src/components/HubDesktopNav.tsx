import { useEffect, useMemo, useRef, useState } from 'react'
import { hubDesktopNavGroups, type HubDesktopNavGroup } from '../lib/hubPermissions'
import { onHubLinkClick } from '../lib/hubNavigate'
import type { HubUserRole } from '../lib/types'

function normalizePath(path: string): string {
  let p = (path || '/').toLowerCase()
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
  return p
}

function pathOnly(href: string): string {
  return normalizePath(href.split('?')[0].split('#')[0])
}

function isActivePath(current: string, href: string): boolean {
  const path = normalizePath(current)
  const target = pathOnly(href)
  if (target === '/') return path === '/'
  return path === target || path.startsWith(`${target}/`)
}

function isGroupActive(current: string, group: HubDesktopNavGroup): boolean {
  if (group.href) return isActivePath(current, group.href)
  return Boolean(group.items?.some((item) => isActivePath(current, item.href)))
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

  const groups = useMemo(() => hubDesktopNavGroups(role), [role])
  const [openId, setOpenId] = useState<string | null>(null)
  const navRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!navRef.current?.contains(e.target as Node)) setOpenId(null)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  useEffect(() => {
    setOpenId(null)
  }, [path])

  if (!groups.length) return null

  return (
    <nav ref={navRef} className="hub-desktop-nav" aria-label="Menú principal">
      <ul className="hub-desktop-nav__list">
        {groups.map((group) => {
          const groupActive = isGroupActive(path, group)
          const hasChildren = Boolean(group.items && group.items.length > 0)

          if (!hasChildren && group.href) {
            return (
              <li key={group.id} className="hub-desktop-nav__item">
                <a
                  href={group.href}
                  className={`hub-desktop-nav__link${groupActive ? ' hub-desktop-nav__link--active' : ''}`}
                  aria-current={groupActive ? 'page' : undefined}
                  onClick={(e) => onHubLinkClick(e, group.href!)}
                >
                  {group.label}
                </a>
              </li>
            )
          }

          const open = openId === group.id
          return (
            <li
              key={group.id}
              className={`hub-desktop-nav__item hub-desktop-nav__item--menu${open ? ' is-open' : ''}${groupActive ? ' is-active' : ''}`}
            >
              <button
                type="button"
                className={`hub-desktop-nav__link hub-desktop-nav__trigger${groupActive ? ' hub-desktop-nav__link--active' : ''}`}
                aria-expanded={open}
                aria-haspopup="true"
                onClick={() => setOpenId((id) => (id === group.id ? null : group.id))}
              >
                {group.label}
                <span className="hub-desktop-nav__caret" aria-hidden>
                  ▾
                </span>
              </button>
              {open ? (
                <ul className="hub-desktop-nav__submenu" role="menu">
                  {group.items!.map((item) => {
                    const active = isActivePath(path, item.href)
                    return (
                      <li key={item.href} role="none">
                        <a
                          href={item.href}
                          role="menuitem"
                          className={`hub-desktop-nav__sublink${active ? ' hub-desktop-nav__sublink--active' : ''}`}
                          aria-current={active ? 'page' : undefined}
                          onClick={(e) => {
                            setOpenId(null)
                            onHubLinkClick(e, item.href)
                          }}
                        >
                          {item.label}
                        </a>
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
