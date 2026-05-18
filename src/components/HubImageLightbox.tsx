import { useCallback, useEffect, useRef, useState, type TouchEvent } from 'react'

const LIGHTBOX_MIN_SCALE = 1
const LIGHTBOX_MAX_SCALE = 4
const LIGHTBOX_DISMISS_PX = 72
const LIGHTBOX_GALLERY_SWIPE_PX = 48

function clampLightboxScale(s: number): number {
  return Math.min(LIGHTBOX_MAX_SCALE, Math.max(LIGHTBOX_MIN_SCALE, s))
}

function touchDistance(touches: { length: number; 0?: Touch; 1?: Touch }): number {
  if (touches.length < 2 || !touches[0] || !touches[1]) return 0
  const dx = touches[1].clientX - touches[0].clientX
  const dy = touches[1].clientY - touches[0].clientY
  return Math.hypot(dx, dy)
}

export type HubImageLightboxGallery = {
  index: number
  total: number
  onPrev?: () => void
  onNext?: () => void
}

export function HubImageLightbox({
  src,
  onClose,
  gallery,
}: {
  src: string
  onClose: () => void
  gallery?: HubImageLightboxGallery
}) {
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dismissY, setDismissY] = useState(0)
  const [dragging, setDragging] = useState(false)

  const historyPushedRef = useRef(true)
  const dismissYRef = useRef(0)
  const galleryRef = useRef(gallery)
  const stageRef = useRef<HTMLDivElement>(null)
  const touchRef = useRef({
    mode: 'none' as 'none' | 'pan' | 'pinch' | 'swipe',
    startY: 0,
    startX: 0,
    startOffset: { x: 0, y: 0 },
    startScale: 1,
    startDist: 0,
    lastTap: 0,
  })

  galleryRef.current = gallery

  const hasGalleryNav = Boolean(gallery && gallery.total > 1)
  const canPrev = hasGalleryNav && (gallery?.index ?? 0) > 0
  const canNext = hasGalleryNav && (gallery?.index ?? 0) < (gallery?.total ?? 1) - 1

  const resetView = useCallback(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
    setDismissY(0)
    dismissYRef.current = 0
  }, [])

  useEffect(() => {
    resetView()
  }, [src, resetView])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  useEffect(() => {
    historyPushedRef.current = true
    history.pushState({ nmHubLightbox: true }, '')
    const onPop = () => {
      historyPushedRef.current = false
      onClose()
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      if (historyPushedRef.current) {
        historyPushedRef.current = false
        history.back()
      }
    }
  }, [onClose])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      const g = galleryRef.current
      if (!g || g.total <= 1) return
      if (e.key === 'ArrowRight' && g.onNext) {
        e.preventDefault()
        g.onNext()
      }
      if (e.key === 'ArrowLeft' && g.onPrev) {
        e.preventDefault()
        g.onPrev()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setScale((s) => clampLightboxScale(s - e.deltaY * 0.002))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const onTouchStart = (e: TouchEvent) => {
    const t = touchRef.current
    if (e.touches.length === 2) {
      t.mode = 'pinch'
      t.startDist = touchDistance(e.touches)
      t.startScale = scale
      setDragging(true)
      return
    }
    if (e.touches.length !== 1) return
    t.startY = e.touches[0].clientY
    t.startX = e.touches[0].clientX
    t.startOffset = { ...offset }
    t.mode = scale > 1.02 ? 'pan' : 'swipe'
    setDragging(true)
  }

  const onTouchMove = (e: TouchEvent) => {
    const t = touchRef.current
    if (t.mode === 'pinch' && e.touches.length >= 2 && t.startDist > 0) {
      setScale(clampLightboxScale(t.startScale * (touchDistance(e.touches) / t.startDist)))
      return
    }
    if (t.mode === 'pan' && e.touches.length === 1) {
      setOffset({
        x: t.startOffset.x + (e.touches[0].clientX - t.startX),
        y: t.startOffset.y + (e.touches[0].clientY - t.startY),
      })
      return
    }
    if (t.mode === 'swipe' && e.touches.length === 1) {
      const dx = e.touches[0].clientX - t.startX
      const dy = e.touches[0].clientY - t.startY
      if (Math.abs(dy) > Math.abs(dx) && dy > 0) {
        dismissYRef.current = dy
        setDismissY(dy)
      } else {
        dismissYRef.current = 0
        setDismissY(0)
      }
    }
  }

  const onTouchEnd = (e: TouchEvent) => {
    const t = touchRef.current
    const end = e.changedTouches[0]
    if (t.mode === 'swipe' && end) {
      const dx = end.clientX - t.startX
      const dy = end.clientY - t.startY
      if (dismissYRef.current >= LIGHTBOX_DISMISS_PX) {
        onClose()
      } else if (scale <= 1.02 && galleryRef.current && galleryRef.current.total > 1) {
        if (Math.abs(dx) > Math.abs(dy) * 1.15 && Math.abs(dx) >= LIGHTBOX_GALLERY_SWIPE_PX) {
          if (dx < 0) galleryRef.current.onNext?.()
          else galleryRef.current.onPrev?.()
        }
      }
      dismissYRef.current = 0
      setDismissY(0)
    }
    t.mode = 'none'
    setDragging(false)
  }

  const onImgPointerDown = () => {
    const now = Date.now()
    if (now - touchRef.current.lastTap < 320) {
      setScale((s) => {
        if (s > 1.05) {
          setOffset({ x: 0, y: 0 })
          return 1
        }
        return 2
      })
      touchRef.current.lastTap = 0
    } else {
      touchRef.current.lastTap = now
    }
  }

  const backdropOpacity = Math.max(0.35, 1 - dismissY / 280)
  const imgTransform =
    dismissY > 0
      ? `translateY(${dismissY}px) scale(${scale})`
      : `translate(${offset.x}px, ${offset.y}px) scale(${scale})`

  return (
    <div
      className={`nm-hub-lightbox${dragging ? ' nm-hub-lightbox--dragging' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Vista previa de imagen"
      style={{ background: `rgba(5, 5, 8, ${0.94 * backdropOpacity})` }}
      onClick={(e) => {
        if (e.target === e.currentTarget && scale <= 1.02 && dismissY < 8) onClose()
      }}
    >
      <div className="nm-hub-lightbox__toolbar">
        <button type="button" className="nm-hub-btn nm-hub-btn-ghost nm-hub-lightbox__back" onClick={onClose} aria-label="Volver">
          ←
        </button>
        {hasGalleryNav ? (
          <p className="nm-hub-lightbox__counter" aria-live="polite">
            {(gallery?.index ?? 0) + 1} / {gallery?.total}
          </p>
        ) : (
          <span className="nm-hub-lightbox__counter" aria-hidden />
        )}
        <div className="nm-hub-lightbox__zoom">
          <button
            type="button"
            className="nm-hub-btn nm-hub-btn-ghost nm-hub-lightbox__tool"
            onClick={() => setScale((s) => clampLightboxScale(s + 0.35))}
            aria-label="Acercar"
          >
            +
          </button>
          <button
            type="button"
            className="nm-hub-btn nm-hub-btn-ghost nm-hub-lightbox__tool"
            onClick={() => setScale((s) => clampLightboxScale(s - 0.35))}
            aria-label="Alejar"
          >
            −
          </button>
          <button type="button" className="nm-hub-btn nm-hub-btn-ghost nm-hub-lightbox__tool" onClick={resetView} aria-label="Restablecer zoom">
            1:1
          </button>
        </div>
        <button type="button" className="nm-hub-btn nm-hub-btn-primary nm-hub-lightbox__close" onClick={onClose}>
          Cerrar
        </button>
      </div>
      <div
        ref={stageRef}
        className="nm-hub-lightbox__stage"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        {hasGalleryNav ? (
          <>
            <button
              type="button"
              className="nm-hub-lightbox__nav nm-hub-lightbox__nav--prev"
              aria-label="Imagen anterior"
              disabled={!canPrev}
              onClick={(e) => {
                e.stopPropagation()
                gallery?.onPrev?.()
              }}
            >
              ‹
            </button>
            <button
              type="button"
              className="nm-hub-lightbox__nav nm-hub-lightbox__nav--next"
              aria-label="Imagen siguiente"
              disabled={!canNext}
              onClick={(e) => {
                e.stopPropagation()
                gallery?.onNext?.()
              }}
            >
              ›
            </button>
          </>
        ) : null}
        <img
          src={src}
          alt=""
          className="nm-hub-lightbox__img"
          style={{ transform: imgTransform }}
          draggable={false}
          onPointerDown={onImgPointerDown}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </div>
  )
}
