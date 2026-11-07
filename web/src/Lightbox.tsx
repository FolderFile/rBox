import { useEffect, useRef, useState } from 'react'
import { Box, IconButton, Modal, Tooltip, Typography } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import ChevronLeft from '@mui/icons-material/ChevronLeft'
import ChevronRight from '@mui/icons-material/ChevronRight'
import DownloadIcon from '@mui/icons-material/Download'
import ShareIcon from '@mui/icons-material/Share'
import Add from '@mui/icons-material/Add'
import Remove from '@mui/icons-material/Remove'
import RestartAlt from '@mui/icons-material/RestartAlt'
import { Entry, fmtSize } from './api'
import { extOf, isImage, PREVIEW_VIDEO } from './filetypes'

function toolbarBtn(label: string, onClick: () => void, children: React.ReactNode) {
  return (
    <Tooltip title={label}>
      <IconButton aria-label={label} size="small" onClick={onClick} sx={{ color: 'common.white' }}>
        {children}
      </IconButton>
    </Tooltip>
  )
}

export function Lightbox({
  items,
  index,
  urlOf,
  onClose,
  onIndex,
  onShare,
}: {
  items: Entry[]
  index: number
  urlOf: (e: Entry) => string
  onClose: () => void
  onIndex: (i: number) => void
  onShare: (e: Entry) => void
}) {
  const item = items[index]
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [touching, setTouching] = useState(false)
  const many = items.length > 1

  // a fresh image always starts at 100% centered
  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [index])

  const zoomTo = (z: number) => {
    const next = Math.min(Math.max(z, 1), 5)
    if (next <= 1) setPan({ x: 0, y: 0 })
    setZoom(next)
  }

  // zoom while keeping the point under the cursor stationary
  const zoomAt = (factor: number, cx: number, cy: number, rect: DOMRect) => {
    const px = cx - rect.left - rect.width / 2
    const py = cy - rect.top - rect.height / 2
    const next = Math.min(Math.max(zoom * factor, 1), 5)
    setPan({
      x: px - ((px - pan.x) * next) / zoom,
      y: py - ((py - pan.y) * next) / zoom,
    })
    if (next <= 1) setPan({ x: 0, y: 0 })
    setZoom(next)
  }

  // pinch distance, pan origin and double-tap timing
  const gesture = useRef<{ pinch?: { dist: number; zoom: number }; pan?: { x: number; y: number }; lastTap: number }>({
    lastTap: 0,
  })
  // mouse drag state: { startCursor, startPan, moved }
  const mouse = useRef<{ sx: number; sy: number; px: number; py: number; moved: number } | null>(null)
  // the modal portals its children in after mount, so track the node itself
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)

  const touchDist = (t: React.TouchList) =>
    Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)

  const onTouchStart = (e: React.TouchEvent) => {
    const g = gesture.current
    const t = e.touches
    setTouching(true)
    if (t.length === 2) {
      g.pinch = { dist: touchDist(t), zoom }
      g.pan = undefined
    } else if (t.length === 1) {
      if (zoom > 1) g.pan = { x: t[0].clientX - pan.x, y: t[0].clientY - pan.y }
      else g.pan = undefined
    }
  }

  const onTouchMove = (e: React.TouchEvent) => {
    const g = gesture.current
    const t = e.touches
    // touch-action: none on the image already stops the browser gesture
    if (t.length === 2 && g.pinch) {
      zoomTo((g.pinch.zoom * touchDist(t)) / g.pinch.dist)
    } else if (t.length === 1 && g.pan) {
      setPan({ x: t[0].clientX - g.pan.x, y: t[0].clientY - g.pan.y })
    }
  }

  const onTouchEnd = (e: React.TouchEvent) => {
    const g = gesture.current
    const t = e.touches
    if (t.length === 0) {
      g.pinch = undefined
      g.pan = undefined
      setTouching(false)
      // a quick single-finger release counts as a tap for double-tap
      const now = Date.now()
      if (now - g.lastTap < 300) {
        zoomTo(zoom > 1 ? 1 : 2.5)
        g.lastTap = 0
      } else {
        g.lastTap = now
      }
    } else if (t.length === 1) {
      g.pinch = undefined
      g.pan = undefined
    }
  }

  // react registers wheel listeners as passive, where preventDefault is a
  // no-op (ctrl+wheel would zoom the whole page); bind a native one instead
  const onWheel = (e: WheelEvent) => {
    if (!item || !isImage(item) || !viewport) return
    e.preventDefault()
    zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX, e.clientY, viewport.getBoundingClientRect())
  }
  const wheelRef = useRef(onWheel)
  wheelRef.current = onWheel
  useEffect(() => {
    if (!viewport) return
    const h = (e: WheelEvent) => wheelRef.current(e)
    viewport.addEventListener('wheel', h, { passive: false })
    return () => viewport.removeEventListener('wheel', h)
  }, [viewport])

  const onMouseDown = (e: React.MouseEvent) => {
    if (!isImage(item) || zoom <= 1) return
    e.preventDefault()
    mouse.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y, moved: 0 }
    setDragging(true)
  }

  const onMouseMove = (e: React.MouseEvent) => {
    const m = mouse.current
    if (!m) return
    const dx = e.clientX - m.sx
    const dy = e.clientY - m.sy
    m.moved = Math.max(m.moved, Math.abs(dx) + Math.abs(dy))
    setPan({ x: m.px + dx, y: m.py + dy })
  }

  const endMouse = () => {
    mouse.current = null
    setDragging(false)
  }

  const onDoubleClick = () => zoomTo(zoom > 1 ? 1 : 2.5)

  const prev = () => onIndex((index - 1 + items.length) % items.length)
  const next = () => onIndex((index + 1) % items.length)

  // the modal traps focus, so key events land here; escape is the modal's
  const onKeyDown = (e: React.KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName
    // focused players use the arrows for seeking
    if (!many || tag === 'VIDEO' || tag === 'AUDIO') return
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      prev()
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      next()
    }
  }

  if (!item) return null
  const url = urlOf(item)
  const image = isImage(item)
  const cursor = !image
    ? 'default'
    : dragging
      ? 'grabbing'
      : zoom > 1
        ? 'grab'
        : 'zoom-in'

  return (
    <Modal open onClose={onClose} hideBackdrop>
      <Box
        role="dialog"
        aria-modal="true"
        aria-label={item.name}
        tabIndex={-1}
        onClick={onClose}
        onKeyDown={onKeyDown}
        sx={{
          position: 'fixed',
          inset: 0,
          outline: 'none',
          // near-opaque plus blur: the listing behind must never compete with
          // the picture, on light or dark pages alike
          bgcolor: 'rgba(5, 6, 9, 0.96)',
          backdropFilter: 'blur(12px)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Box
          sx={{
            position: 'relative',
            zIndex: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 2,
            py: 1,
            bgcolor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(6px)',
            color: 'common.white',
            flexShrink: 0,
          }}
          onClick={ev => ev.stopPropagation()}
        >
          <Typography variant="body2" noWrap sx={{ flex: 1, fontWeight: 500 }}>
            {item.name}
          </Typography>
          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.7)' }}>
            {fmtSize(item.size)}
          </Typography>
          {image && toolbarBtn('Zoom in', () => zoomTo(zoom * 1.25), <Add fontSize="small" />)}
          {image && toolbarBtn('Zoom out', () => zoomTo(zoom / 1.25), <Remove fontSize="small" />)}
          {image && toolbarBtn('Reset zoom (100%)', () => zoomTo(1), <RestartAlt fontSize="small" />)}
          {toolbarBtn('Download', () => {
            const a = document.createElement('a')
            a.href = url
            a.download = item.name
            a.click()
          }, <DownloadIcon fontSize="small" />)}
          {toolbarBtn('Share', () => onShare(item), <ShareIcon fontSize="small" />)}
          {toolbarBtn('Close', onClose, <CloseIcon />)}
        </Box>

        <Box
          ref={setViewport}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={endMouse}
          onMouseLeave={endMouse}
          onDoubleClick={onDoubleClick}
          onClick={ev => ev.stopPropagation()}
          sx={{
            flex: 1,
            position: 'relative',
            zIndex: 1,
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor,
            touchAction: 'none',
          }}
        >
          {many && (
            <IconButton
              aria-label="Previous"
              onClick={ev => {
                ev.stopPropagation()
                prev()
              }}
              sx={{
                position: 'absolute',
                left: 8,
                color: 'common.white',
                bgcolor: 'rgba(255,255,255,0.1)',
                zIndex: 2,
                '&:hover': { bgcolor: 'rgba(255,255,255,0.2)' },
              }}
            >
              <ChevronLeft />
            </IconButton>
          )}
          {many && (
            <IconButton
              aria-label="Next"
              onClick={ev => {
                ev.stopPropagation()
                next()
              }}
              sx={{
                position: 'absolute',
                right: 8,
                color: 'common.white',
                bgcolor: 'rgba(255,255,255,0.1)',
                zIndex: 2,
                '&:hover': { bgcolor: 'rgba(255,255,255,0.2)' },
              }}
            >
              <ChevronRight />
            </IconButton>
          )}

          {image ? (
            <img
              key={url}
              src={url}
              alt={item.name}
              draggable={false}
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
              style={{
                maxWidth: '90vw',
                maxHeight: '82vh',
                objectFit: 'contain',
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                // snap instantly while a finger is down so gestures track 1:1
                transition: touching || dragging ? 'none' : 'transform 150ms ease',
                touchAction: 'none',
                userSelect: 'none',
              }}
            />
          ) : PREVIEW_VIDEO.includes(extOf(item.name)) ? (
            <video key={url} controls autoPlay style={{ maxWidth: '90vw', maxHeight: '82vh' }} src={url} />
          ) : (
            <Box
              key={url}
              sx={{
                width: 480,
                maxWidth: '90vw',
                bgcolor: 'rgba(255,255,255,0.08)',
                borderRadius: 1,
                p: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <audio controls autoPlay style={{ width: '100%' }} src={url} />
            </Box>
          )}
        </Box>
      </Box>
    </Modal>
  )
}

export default Lightbox
