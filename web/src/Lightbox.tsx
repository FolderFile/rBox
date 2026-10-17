import { useEffect, useRef, useState } from 'react'
import { Box, IconButton, Tooltip, Typography } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import ChevronLeft from '@mui/icons-material/ChevronLeft'
import ChevronRight from '@mui/icons-material/ChevronRight'
import DownloadIcon from '@mui/icons-material/Download'
import ShareIcon from '@mui/icons-material/Share'
import Add from '@mui/icons-material/Add'
import Remove from '@mui/icons-material/Remove'
import RestartAlt from '@mui/icons-material/RestartAlt'
import { Entry, fmtSize } from './api'

const IMG = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']
const VIDEO = ['mp4', 'webm', 'mov']
const AUDIO = ['mp3', 'flac', 'wav', 'ogg', 'm4a']

function extOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

export function isMedia(e: Entry): boolean {
  return [...IMG, ...VIDEO, ...AUDIO].includes(extOf(e.name))
}

export function isImage(e: Entry): boolean {
  return IMG.includes(extOf(e.name))
}

function toolbarBtn(label: string, onClick: () => void, children: React.ReactNode) {
  return (
    <Tooltip title={label}>
      <IconButton size="small" onClick={onClick} sx={{ color: 'common.white' }}>
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
  const viewport = useRef<HTMLDivElement>(null)

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
    if (t.length === 2 && g.pinch) {
      e.preventDefault()
      zoomTo((g.pinch.zoom * touchDist(t)) / g.pinch.dist)
    } else if (t.length === 1 && g.pan) {
      e.preventDefault()
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

  const onWheel = (e: React.WheelEvent) => {
    if (!isImage(item)) return
    e.preventDefault()
    const rect = viewport.current?.getBoundingClientRect()
    if (!rect) return
    zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX, e.clientY, rect)
  }

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft' && many) onIndex((index - 1 + items.length) % items.length)
      else if (e.key === 'ArrowRight' && many) onIndex((index + 1) % items.length)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, items.length, many, onClose, onIndex])

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
    <Box
      onClick={onClose}
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: t => t.zIndex.modal + 1,
        bgcolor: 'rgba(0, 0, 0, 0.92)',
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
        ref={viewport}
        onWheel={onWheel}
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
            onClick={ev => {
              ev.stopPropagation()
              onIndex((index - 1 + items.length) % items.length)
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
            onClick={ev => {
              ev.stopPropagation()
              onIndex((index + 1) % items.length)
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
        ) : VIDEO.includes(extOf(item.name)) ? (
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
  )
}