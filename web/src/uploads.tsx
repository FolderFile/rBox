import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Box, IconButton, LinearProgress, Paper, Typography } from '@mui/material'
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
  error?: string
}

interface UploadCtx {
  upload: (dir: string, files: File[]) => void
  clearFinished: () => void
  pendingCount: number
}

const Ctx = createContext<UploadCtx>(null as any)
let seq = 0

export function UploadProvider({
  children,
  onDone,
}: {
  children: React.ReactNode
  onDone: () => void
}) {
  const [jobs, setJobs] = useState<Job[]>([])
  // the drop overlay needs the current directory without a prop chain
  const cwd = useRef('')

  const patch = (id: number, f: (j: Job) => Job) =>
    setJobs(js => js.map(j => (j.id === id ? f(j) : j)))

  const upload = useCallback(
    (dir: string, files: File[]) => {
      cwd.current = dir
      const newJobs = files.map(file => ({
        id: ++seq,
        name: file.name,
        loaded: 0,
        total: file.size,
        done: false,
      }))
      setJobs(js => [...js, ...newJobs])

      newJobs.forEach((job, i) => {
        const form = new FormData()
        form.append('file', files[i], files[i].name)
        const { id } = job
        const xhr = new XMLHttpRequest()
        xhr.open('POST', `/api/files/upload?path=${encodeURIComponent(dir)}`)
        xhr.upload.onprogress = e => {
          if (e.lengthComputable) patch(id, j => ({ ...j, loaded: e.loaded }))
        }
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            patch(id, j => ({ ...j, loaded: j.total, done: true }))
            onDone()
          } else {
            let msg = `HTTP ${xhr.status}`
            try {
              msg = JSON.parse(xhr.responseText).error || msg
            } catch {
              // non-json error body
            }
            patch(id, j => ({ ...j, done: true, error: msg }))
          }
        }
        xhr.onerror = () => patch(id, j => ({ ...j, done: true, error: 'network error' }))
        xhr.send(form)
      })
    },
    [onDone],
  )

  return (
    <Ctx.Provider
      value={{
        upload,
        clearFinished: () => setJobs(js => js.filter(j => !j.done)),
        pendingCount: jobs.filter(j => !j.done).length,
      }}
    >
      {children}
      <DropZone upload={upload} cwd={cwd} />
      <Tray
        jobs={jobs}
        onClear={() => setJobs(js => js.filter(j => !j.done))}
      />
    </Ctx.Provider>
  )
}

export const useUploads = () => useContext(Ctx)

function Tray({ jobs, onClear }: { jobs: Job[]; onClear: () => void }) {
  if (jobs.length === 0) return null
  const pending = jobs.filter(j => !j.done).length
  return (
    <Paper
      elevation={4}
      sx={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        width: 320,
        p: 1,
        zIndex: t => t.zIndex.snackbar,
        maxHeight: '60vh',
        overflow: 'auto',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', px: 1 }}>
        <Typography variant="body2" sx={{ flex: 1 }}>
          {pending > 0 ? `Uploading ${pending} item${pending > 1 ? 's' : ''}` : 'Uploads complete'}
        </Typography>
        <IconButton size="small" onClick={onClear}>
          <Close fontSize="small" />
        </IconButton>
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
                {fmtSize(j.loaded)} / {fmtSize(j.total)}
              </Typography>
            )}
          </Box>
          <LinearProgress
            variant="determinate"
            value={j.error ? 100 : j.total ? (j.loaded / j.total) * 100 : 0}
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

// the overlay is purely visual; pointer events stay off so the real drop
// lands on the underlying element and the browser default never kicks in
function DropZone({
  upload,
  cwd,
}: {
  upload: (dir: string, files: File[]) => void
  cwd: React.RefObject<string>
}) {
  const [over, setOver] = useState(false)
  const depth = useRef(0)

  useEffect(() => {
    const enter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
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
    const move = (e: DragEvent) => e.preventDefault()
    const drop = (e: DragEvent) => {
      e.preventDefault()
      depth.current = 0
      setOver(false)
      const files = e.dataTransfer?.files
      if (files?.length) upload(cwd.current, Array.from(files))
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
  }, [upload, cwd])

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