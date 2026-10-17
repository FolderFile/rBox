import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Alert, Box, Button, Chip, Divider, Paper, Snackbar, Stack, TextField, Typography,
} from '@mui/material'
import ContentCopy from '@mui/icons-material/ContentCopy'
import OpenInNew from '@mui/icons-material/OpenInNew'
import DownloadIcon from '@mui/icons-material/Download'
import FolderOutlined from '@mui/icons-material/FolderOutlined'
import InsertDriveFileOutlined from '@mui/icons-material/InsertDriveFileOutlined'
import { api, fmtSize } from './api'

interface ShareInfo {
  name: string
  is_dir: boolean
  size: number
  requires_password: boolean
}

const IMG = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']
const VIDEO = ['mp4', 'webm', 'mov']
const AUDIO = ['mp3', 'flac', 'wav', 'ogg', 'm4a']
const TEXT = ['txt', 'md', 'json', 'toml', 'yaml', 'yml', 'rs', 'js', 'ts', 'tsx', 'jsx', 'py', 'html', 'css', 'sh', 'sql', 'log', 'xml', 'csv']
const TEXT_PREVIEW_CAP = 512 * 1024

function extOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

export default function ShareLanding() {
  const { token } = useParams()
  const nav = useNavigate()
  const [info, setInfo] = useState<ShareInfo | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [unauthorized, setUnauthorized] = useState(false)
  const [textPreview, setTextPreview] = useState<string | null>(null)
  const [snack, setSnack] = useState('')

  const pwQs = info?.requires_password && password ? `?password=${encodeURIComponent(password)}` : ''
  const rawUrl = info ? `/s/${token}/raw/${encodeURIComponent(info.name)}${pwQs}` : ''

  useEffect(() => {
    api
      .get(`/s/${token}/info`)
      .then(setInfo)
      .catch(e => setError(e.message))
  }, [token])

  const ext = info ? extOf(info.name) : ''
  const isImage = IMG.includes(ext)
  const isVideo = VIDEO.includes(ext)
  const isAudio = AUDIO.includes(ext)
  const isText = !!info && !info.is_dir && TEXT.includes(ext) && info.size <= TEXT_PREVIEW_CAP

  useEffect(() => {
    setTextPreview(null)
    if (!info || info.is_dir || !isText) return
    if (info.requires_password && !password) return
    fetch(rawUrl)
      .then(res => (res.ok ? res.text() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(setTextPreview)
      .catch(() => {})
  }, [info, isText, password, rawUrl])

  if (error) {
    return (
      <Center>
        <Paper sx={{ p: 4, width: 360 }}>
          <Alert severity="error">{error}</Alert>
          <Button sx={{ mt: 2 }} onClick={() => nav('/')}>Go to rbox</Button>
        </Paper>
      </Center>
    )
  }

  const copyRaw = async () => {
    await navigator.clipboard.writeText(`${location.origin}${rawUrl}`).catch(() => {})
    setSnack('Raw link copied to clipboard')
  }

  const download = async () => {
    if (!info) return
    const qs = info.requires_password ? `?password=${encodeURIComponent(password)}` : ''
    const res = await fetch(`/s/${token}/download${qs}`, { method: 'HEAD' })
    if (res.status === 401) return setUnauthorized(true)
    window.location.href = `/s/${token}/download${qs}`
  }

  const locked = info?.requires_password && !password

  return (
    <Center>
      <Paper sx={{ p: 4, width: { xs: '100%', sm: 560 } }}>
        <Stack spacing={2}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ color: 'action.active', display: 'inline-flex' }}>
              {info?.is_dir ? <FolderOutlined /> : <InsertDriveFileOutlined />}
            </Box>
            <Typography variant="h6" noWrap title={info?.name} sx={{ flex: 1 }}>
              {info?.name ?? 'Loading…'}
            </Typography>
            <Chip label="rbox" size="small" sx={{ borderRadius: 1 }} />
          </Box>
          <Typography variant="body2" color="text.secondary">
            {info ? (info.is_dir ? `Folder · ${fmtSize(info.size)}` : fmtSize(info.size)) : ''}
          </Typography>

          {info?.requires_password && (
            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={e => { setPassword(e.target.value); setUnauthorized(false) }}
              error={unauthorized}
              helperText={unauthorized ? 'wrong or missing password' : ''}
              fullWidth
            />
          )}

          {info && !info.is_dir && !locked && (isImage || isVideo || isAudio) && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: 'rgba(0, 0, 0, 0.06)',
                borderRadius: 1,
                maxHeight: 420,
                overflow: 'hidden',
              }}
            >
              {isImage && <img src={rawUrl} alt={info.name} style={{ maxWidth: '100%', maxHeight: 420, objectFit: 'contain' }} />}
              {isVideo && <video controls src={rawUrl} style={{ maxWidth: '100%', maxHeight: 420 }} />}
              {isAudio && <audio controls src={rawUrl} style={{ width: '100%', padding: 16 }} />}
            </Box>
          )}

          {info && !info.is_dir && !locked && textPreview !== null && (
            <Box
              sx={{
                maxHeight: 360,
                overflow: 'auto',
                bgcolor: 'rgba(0, 0, 0, 0.06)',
                borderRadius: 1,
                p: 2,
              }}
            >
              <Typography
                component="pre"
                sx={{
                  fontFamily: '"Roboto Mono", "Consolas", monospace',
                  fontSize: '0.8rem',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  m: 0,
                }}
              >
                {textPreview}
              </Typography>
            </Box>
          )}

          <Divider />

          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button
              variant="contained"
              startIcon={<DownloadIcon />}
              disabled={!info || locked}
              onClick={download}
              sx={{ flex: 1 }}
            >
              Download
            </Button>
            <Button
              variant="outlined"
              startIcon={<ContentCopy />}
              disabled={!info || info.is_dir}
              onClick={copyRaw}
            >
              Copy Raw Link
            </Button>
            <Button
              variant="outlined"
              startIcon={<OpenInNew />}
              disabled={!info || info.is_dir}
              onClick={() => window.open(rawUrl, '_blank')}
            >
              Open Raw
            </Button>
          </Box>
          <Typography variant="caption" color="text.secondary">
            Direct stream URL for media embeds and CLI tools.
          </Typography>
        </Stack>
      </Paper>
      <Snackbar open={!!snack} autoHideDuration={3000} onClose={() => setSnack('')} message={snack} />
    </Center>
  )
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
      {children}
    </Box>
  )
}