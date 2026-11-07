import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Box, IconButton, LinearProgress, Paper, Tooltip, Typography } from '@mui/material'
import Close from '@mui/icons-material/Close'
import CheckCircle from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/ErrorOutline'
import { fmtSize } from './api'

interface Job extends UploadJob {
  id: number
}

export interface UploadJob {
  name: string
  loaded: number
  total: number
  done: boolean
  started?: boolean
  error?: string
}

interface UploadCtx {
  upload: (dir: string, files: File[]) => void
  // the folder window drops land in; null while no explorer is mounted
  setTarget: (dir: string | null) => void
  clearFinished: () => void
  pendingCount: number
}

const Ctx = createContext<UploadCtx>(null as any)
let seq = 0

// a handful of parallel uploads saturates the link; more only starves the
// browser's ~6 connections per host (HTTP/1.1) so listings stall behind them
const MAX_PARALLEL = 3
// while a batch is running, refresh the listing and quota at most this often
const REFRESH_EVERY_MS = 1500

export function UploadProvider({
  children,
  onDone,
}: {
  children: React.ReactNode
  onDone: () => void
}) {
  const [jobs, setJobs] = useState<Job[]>([])
  const target = useRef<string | null>(null)
  const onDoneRef = useRef(onDone)
  useEffect(() => {
    onDoneRef.current = onDone
  }, [onDone])

  // everything below works through refs, so the functions are created once
  // and never rebind listeners in consumers
  const ops = useMemo(() => {
    const queue: { id: number; dir: string; file: File }[] = []
    const active = new Map<number, XMLHttpRequest>()
    let changed = false
    let refreshTimer = 0

    const patch = (id: number, f: (j: Job) => Job) =>
      setJobs(js => js.map(j => (j.id === id ? f(j) : j)))

    const flush = () => {
      window.clearTimeout(refreshTimer)
      refreshTimer = 0
      if (!changed) return
      changed = false
      onDoneRef.current()
    }

    const settle = (id: number) => {
      active.delete(id)
      pump()
      if (active.size === 0 && queue.length === 0) flush()
      else if (changed && !refreshTimer) refreshTimer = window.setTimeout(flush, REFRESH_EVERY_MS)
    }

    const start = ({ id, dir, file }: { id: number; dir: string; file: File }) => {
      const form = new FormData()
      form.append('file', file, file.name)
      const xhr = new XMLHttpRequest()
      active.set(id, xhr)
      patch(id, j => ({ ...j, started: true }))
      xhr.open('POST', `/api/files/upload?path=${encodeURIComponent(dir)}`)
      xhr.upload.onprogress = e => {
        if (e.lengthComputable) patch(id, j => ({ ...j, loaded: e.loaded }))
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          patch(id, j => ({ ...j, loaded: j.total, done: true }))
          changed = true
        } else {
          let msg = `HTTP ${xhr.status}`
          try {
            msg = JSON.parse(xhr.responseText).error || msg
          } catch {
            // non-json error body
          }
          if (xhr.status === 401) window.dispatchEvent(new Event('rbox:unauthorized'))
          patch(id, j => ({ ...j, done: true, error: msg }))
        }
        settle(id)
      }
      xhr.onerror = () => {
        patch(id, j => ({ ...j, done: true, error: 'network error' }))
        settle(id)
      }
      xhr.onabort = () => {
        patch(id, j => ({ ...j, done: true, error: 'cancelled' }))
        settle(id)
      }
      xhr.send(form)
    }

    function pump() {
      while (active.size < MAX_PARALLEL && queue.length) start(queue.shift()!)
    }

    const upload = (dir: string, files: File[]) => {
      const newJobs = files.map(file => ({
        id: ++seq,
        name: file.name,
        loaded: 0,
        total: file.size,
        done: false,
      }))
      setJobs(js => [...js, ...newJobs])
      newJobs.forEach((job, i) => queue.push({ id: job.id, dir, file: files[i] }))
      pump()
    }

    const cancel = (id: number) => {
      const i = queue.findIndex(q => q.id === id)
      if (i >= 0) {
        queue.splice(i, 1)
        patch(id, j => ({ ...j, done: true, error: 'cancelled' }))
        return
      }
      active.get(id)?.abort()
    }

    const clearFinished = () => setJobs(js => js.filter(j => !j.done))

    const setTarget = (dir: string | null) => {
      target.current = dir
    }

    return { upload, cancel, clearFinished, setTarget }
  }, [])

  const pendingCount = jobs.filter(j => !j.done).length
  const value = useMemo<UploadCtx>(
    () => ({
      upload: ops.upload,
      setTarget: ops.setTarget,
      clearFinished: ops.clearFinished,
      pendingCount,
    }),
    [ops, pendingCount],
  )

  return (
    <Ctx.Provider value={value}>
      {children}
      <DropZone upload={ops.upload} target={target} />
      <Tray jobs={jobs} onClear={value.clearFinished} onCancel={ops.cancel} />
    </Ctx.Provider>
  )
}

export const useUploads = () => useContext(Ctx)

function Tray({ jobs, onClear, onCancel }: { jobs: Job[]; onClear: () => void; onCancel: (id: number) => void }) {
  const pending = jobs.filter(j => !j.done).length
  const failed = jobs.filter(j => j.error).length

  // a fully successful pass fades itself out; failures stay pinned until
  // the user acknowledges them
  useEffect(() => {
    if (pending > 0 || failed > 0 || jobs.length === 0) return
    const t = setTimeout(onClear, 5000)
    return () => clearTimeout(t)
  }, [pending, failed, jobs.length, onClear])

  if (jobs.length === 0) return null
  return (
    <Paper
      elevation={4}
      role="status"
      aria-live="polite"
      sx={{
        // below the explorer toolbar on desktop so Upload / Sort / View stay
        // clickable; a bottom sheet on phones
        position: 'fixed',
        right: 16,
        top: { xs: 'auto', sm: 108 },
        bottom: { xs: 16, sm: 'auto' },
        left: { xs: 16, sm: 'auto' },
        width: { xs: 'auto', sm: 320 },
        p: 1,
        zIndex: t => t.zIndex.appBar - 1,
        maxHeight: { xs: '40vh', sm: '60vh' },
        overflow: 'auto',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', px: 1 }}>
        <Typography variant="body2" sx={{ flex: 1 }}>
          {pending > 0 ? `Uploading ${pending} item${pending > 1 ? 's' : ''}` : 'Uploads complete'}
        </Typography>
        <Tooltip title={pending > 0 ? 'Clear finished' : 'Dismiss'}>
          <IconButton aria-label={pending > 0 ? 'Clear finished uploads' : 'Dismiss uploads'} size="small" onClick={onClear}>
            <Close fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      {jobs.map(j => (
        <Box key={j.id} sx={{ px: 1, py: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {j.error ? (
              <ErrorIcon fontSize="small" color="error" />
            ) : j.done ? (
              <CheckCircle fontSize="small" color="success" />
            ) : null}
            <Typography variant="body2" noWrap sx={{ flex: 1 }} title={j.name}>
              {j.name}
            </Typography>
            {!j.error && (
              <Typography variant="caption" color="text.secondary">
                {j.started || j.done ? `${fmtSize(j.loaded)} / ${fmtSize(j.total)}` : 'queued'}
              </Typography>
            )}
            {!j.done && (
              <IconButton aria-label={`Cancel upload of ${j.name}`} size="small" onClick={() => onCancel(j.id)} sx={{ p: 0.25 }}>
                <Close sx={{ fontSize: 14 }} />
              </IconButton>
            )}
          </Box>
          <LinearProgress
            variant="determinate"
            value={j.error ? 100 : j.total ? (j.loaded / j.total) * 100 : j.done ? 100 : 0}
            color={j.error ? 'error' : 'primary'}
            sx={{ height: 6, borderRadius: 3, mt: 0.25 }}
          />
          {j.error && (
            <Typography variant="caption" color="error" display="block" noWrap title={j.error}>
              {j.error}
            </Typography>
          )}
        </Box>
      ))}
    </Paper>
  )
}

const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')
// drops onto any modal (upload dialog, editor, lightbox) belong to it
const inModal = (e: DragEvent) => !!(e.target as Element | null)?.closest?.('.MuiModal-root')

// the overlay is purely visual; pointer events stay off so the real drop
// lands on the underlying element and the browser default never kicks in
function DropZone({
  upload,
  target,
}: {
  upload: (dir: string, files: File[]) => void
  target: React.RefObject<string | null>
}) {
  const [over, setOver] = useState(false)
  const depth = useRef(0)

  useEffect(() => {
    const enter = (e: DragEvent) => {
      if (!hasFiles(e) || target.current === null || inModal(e)) return
      e.preventDefault()
      depth.current++
      setOver(true)
    }
    const leave = () => {
      if (--depth.current <= 0) {
        depth.current = 0
        setOver(false)
      }
    }
    const move = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault()
    }
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      // never let the browser navigate away to the dropped file
      e.preventDefault()
      depth.current = 0
      setOver(false)
      const dir = target.current
      const files = e.dataTransfer?.files
      if (dir === null || inModal(e) || !files?.length) return
      upload(dir, Array.from(files))
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', move)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', move)
      window.removeEventListener('drop', drop)
    }
  }, [upload, target])

  if (!over) return null
  return (
    <Box
      sx={{
        position: 'fixed',
        inset: 16,
        zIndex: 2000,
        border: '2px dashed',
        borderColor: 'primary.main',
        borderRadius: 1,
        bgcolor: 'rgba(25, 118, 210, 0.08)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <Typography variant="h6">Drop files to upload</Typography>
    </Box>
  )
}
