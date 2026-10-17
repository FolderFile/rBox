import { useEffect, useState } from 'react'
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, IconButton, InputAdornment, List, ListItemButton,
  ListItemText, MenuItem, Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import LockRounded from '@mui/icons-material/LockRounded'
import Visibility from '@mui/icons-material/Visibility'
import VisibilityOff from '@mui/icons-material/VisibilityOff'
import FolderRounded from '@mui/icons-material/FolderRounded'
import { api, ArchiveEntryInfo, fmtSize } from './api'

const FORMATS = ['zip', 'tar.gz', 'tar.zst', 'tar.xz', 'tar']
const LEVELS = [
  { label: 'Store', hint: '0 · Fastest', value: 0 },
  { label: 'Fast', hint: 'Level 3', value: 3 },
  { label: 'Normal', hint: 'Level 6', value: 6 },
  { label: 'Ultra', hint: 'Max compression', value: 9 },
]

export function isArchiveName(name: string): boolean {
  return /\.(zip|tar|tgz|gz|zst|xz|7z)$/i.test(name)
}

export function CreateArchiveDialog({
  paths,
  suggestedName,
  open,
  onCancel,
  onCreated,
}: {
  paths: string[]
  suggestedName: string
  open: boolean
  onCancel: () => void
  onCreated: (path: string) => void
}) {
  const [name, setName] = useState(suggestedName)
  const [format, setFormat] = useState('zip')
  const [level, setLevel] = useState(6)
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setName(suggestedName)
      setFormat('zip')
      setLevel(6)
      setPassword('')
      setError('')
    }
  }, [open, suggestedName])

  // keep the extension in sync with the chosen format
  const ext = format === 'tar' ? '.tar' : `.${format}`
  const base = name.replace(/\.(zip|tar\.gz|tgz|tar\.zst|tar\.xz|tar)$/i, '')
  const fileName = base + ext

  const create = async () => {
    setBusy(true)
    setError('')
    try {
      await api.post('/api/files/archive', {
        paths,
        dest_path: fileName,
        format,
        level,
        password: format === 'zip' && password ? password : undefined,
      })
      onCreated(fileName)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={onCancel}>
      <DialogTitle>Create Archive</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Archive filename"
            value={fileName}
            onChange={e => setName(base + e.target.value.slice(base.length))}
            fullWidth
          />
          <TextField
            select
            label="Format"
            value={format}
            onChange={e => setFormat(e.target.value)}
          >
            {FORMATS.map(f => (
              <MenuItem key={f} value={f}>.{f}</MenuItem>
            ))}
          </TextField>
          <Box>
            <Typography variant="caption" color="text.secondary">Compression strength</Typography>
            <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5 }}>
              {LEVELS.map(l => (
                <Button
                  key={l.value}
                  size="small"
                  variant={level === l.value ? 'contained' : 'text'}
                  onClick={() => setLevel(l.value)}
                  sx={{ flex: 1, borderRadius: 2 }}
                >
                  {l.label}
                </Button>
              ))}
            </Box>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
              {LEVELS.find(l => l.value === level)?.hint}
            </Typography>
          </Box>
          {format === 'zip' && (
            <TextField
              label="Password (optional, AES-256)"
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton size="small" onClick={() => setShowPw(s => !s)}>
                        {showPw ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
              fullWidth
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="contained" disabled={busy || !base} onClick={create}>
          Create
        </Button>
      </DialogActions>
    </Dialog>
  )
}

async function archiveList(path: string, password?: string): Promise<ArchiveEntryInfo[]> {
  const qs = password ? `&password=${encodeURIComponent(password)}` : ''
  const res = await api.get(`/api/files/archive/list?path=${encodeURIComponent(path)}${qs}`)
  return res.entries
}

async function extractArchive(path: string, destDir: string, password?: string) {
  return api.post('/api/files/extract', {
    path,
    dest_dir: destDir || undefined,
    password: password || undefined,
  })
}

export function isPasswordRequired(err: any): boolean {
  return err?.status === 422 && (err.message === 'password_required' || err.message === 'invalid_archive_password')
}

// inspector + extract flow with automatic password unlock transition
export function ArchiveViewerDialog({
  path,
  open,
  onCancel,
  onExtracted,
}: {
  path: string
  open: boolean
  onCancel: () => void
  onExtracted: (msg: string) => void
}) {
  const [entries, setEntries] = useState<ArchiveEntryInfo[] | null>(null)
  const [password, setPassword] = useState('')
  const [needPassword, setNeedPassword] = useState(false)
  const [pwError, setPwError] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dest, setDest] = useState(path.replace(/\.(zip|tar|tgz|gz|zst|xz|7z)$/i, ''))

  const loadList = async (pw?: string) => {
    setBusy(true)
    setError('')
    try {
      setEntries(await archiveList(path, pw))
      setNeedPassword(false)
    } catch (e: any) {
      if (isPasswordRequired(e)) setNeedPassword(true)
      else setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (open) {
      setEntries(null)
      setPassword('')
      setNeedPassword(false)
      setPwError('')
      setDest(path.replace(/\.(zip|tar|tgz|gz|zst|xz|7z)$/i, ''))
      loadList()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, path])

  const extract = async (pw?: string) => {
    setBusy(true)
    setPwError('')
    try {
      const res = await extractArchive(path, dest, pw ?? (password || undefined))
      onExtracted(`Extracted ${res.files} file${res.files === 1 ? '' : 's'} to /${dest || 'Home'}`)
      onCancel()
    } catch (e: any) {
      if (isPasswordRequired(e)) {
        setNeedPassword(true)
        setPwError(e.message === 'invalid_archive_password' ? 'Wrong password, try again' : '')
      } else {
        setError(e.message)
      }
    } finally {
      setBusy(false)
    }
  }

  const files = entries?.filter(e => !e.is_dir) ?? []
  const rawSize = files.reduce((n, e) => n + e.size, 0)
  const packed = files.reduce((n, e) => n + e.compressed_size, 0)

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <FolderRounded fontSize="small" />
        <Typography variant="inherit" noWrap sx={{ flex: 1 }}>{path}</Typography>
        {entries && (
          <Chip label={`${entries.length} entries`} size="small" sx={{ borderRadius: 2 }} />
        )}
      </DialogTitle>
      <DialogContent sx={{ px: 0 }}>
        {error && <Alert severity="error" sx={{ mx: 2 }}>{error}</Alert>}
        {needPassword ? (
          <Stack spacing={2} sx={{ px: 2, pt: 1 }}>
            <Alert severity="info" icon={<LockRounded fontSize="small" />}>
              This archive is encrypted. Enter its password to continue.
            </Alert>
            {pwError && <Alert severity="error">{pwError}</Alert>}
            <TextField
              autoFocus
              label="Archive password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && extract()}
              fullWidth
            />
            <Stack direction="row" spacing={1}>
              <Button variant="outlined" onClick={() => loadList(password)} disabled={busy}>
                Unlock & Browse
              </Button>
              <Button variant="contained" onClick={() => extract()} disabled={busy}>
                Unlock & Extract All
              </Button>
            </Stack>
          </Stack>
        ) : busy && !entries ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
        ) : entries ? (
          <>
            <Box sx={{ px: 2, pb: 1, display: 'flex', gap: 2 }}>
              <Typography variant="caption" color="text.secondary">
                {fmtSize(rawSize)} unpacked{packed > 0 ? ` · ${fmtSize(packed)} in archive` : ''}
                {packed > 0 ? ` · ${(packed / Math.max(rawSize, 1) * 100).toFixed(0)}% ratio` : ''}
              </Typography>
            </Box>
            <List dense sx={{ maxHeight: 360, overflowY: 'auto' }}>
              {entries.map(e => (
                <ListItemButton key={e.name} disabled>
                  <ListItemText
                    primary={e.name}
                    secondary={e.encrypted ? 'encrypted' : undefined}
                    slotProps={{ primary: { noWrap: true } }}
                  />
                  <Typography variant="caption" color="text.secondary" sx={{ ml: 2, whiteSpace: 'nowrap' }}>
                    {e.is_dir ? 'Folder' : fmtSize(e.size)}
                  </Typography>
                </ListItemButton>
              ))}
            </List>
            <Stack spacing={1.5} sx={{ px: 2, pt: 1 }}>
              <TextField
                label="Extract destination (empty for Home)"
                value={dest}
                onChange={e => setDest(e.target.value)}
                size="small"
                fullWidth
              />
              <Tooltip title="Extracts every entry into the destination folder">
                <Button
                  variant="contained"
                  startIcon={<FolderRounded />}
                  disabled={busy}
                  onClick={() => extract()}
                >
                  Extract All
                </Button>
              </Tooltip>
            </Stack>
          </>
        ) : null}
      </DialogContent>
      <DialogActions>
        {busy && entries && <CircularProgress size={18} sx={{ mr: 1 }} />}
        <Button onClick={onCancel}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
