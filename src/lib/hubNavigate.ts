import type { MouseEvent } from 'react'

/** Disparado tras `pushState` / `replaceState` internos para que `App` vuelva a leer la URL sin recargar. */
export const HUB_NAV_EVENT = 'hubnav'

export function hubNavigate(href: string) {
  if (typeof window === 'undefined') return
  try {
    const u = new URL(href, window.location.origin)
    window.history.pushState(null, '', `${u.pathname}${u.search}${u.hash}`)
    window.dispatchEvent(new CustomEvent(HUB_NAV_EVENT))
  } catch {
    window.location.assign(href)
  }
}

export function hubReplace(href: string) {
  if (typeof window === 'undefined') return
  try {
    const u = new URL(href, window.location.origin)
    window.history.replaceState(null, '', `${u.pathname}${u.search}${u.hash}`)
    window.dispatchEvent(new CustomEvent(HUB_NAV_EVENT))
  } catch {
    window.location.replace(href)
  }
}

function isPrimaryPlainLeftClick(e: MouseEvent<HTMLAnchorElement>) {
  if (e.defaultPrevented) return false
  if (e.button !== 0) return false
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false
  if (e.currentTarget.getAttribute('target') === '_blank') return false
  return true
}

/** Navegación SPA: clic normal; Cmd/Ctrl/middle-click dejan el comportamiento por defecto del enlace. */
export function onHubLinkClick(e: MouseEvent<HTMLAnchorElement>, href: string) {
  if (!isPrimaryPlainLeftClick(e)) return
  e.preventDefault()
  hubNavigate(href)
}
