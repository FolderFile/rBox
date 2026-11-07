import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Box, Button, Divider, Paper, Snackbar, Stack, TextField, Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import LockRounded from '@mui/icons-material/LockRounded'
import LinkOffRounded from '@mui/icons-material/LinkOffRounded'
import ContentCopy from '@mui/icons-material/ContentCopy'
import OpenInNew from '@mui/icons-material/OpenInNew'
import DownloadIcon from '@mui/icons-material/Download'
import { api, copyText, fmtSize, readError } from './api'
import { EntryIcon, getEntryVisuals } from './fileicons'
import { kindLabel } from './filetypes'
import { Wordmark } from './Wordmark'

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
  // what the visitor is typing vs. the password the server accepted: only
  // the latter ever reaches a URL, so typing doesn't fire a request per key
  const [password, setPassword] = useState('')
  const [unlocked, setUnlocked] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [pwError, setPwError] = useState('')
  const [error, setError] = useState('')
  const [textPreview, setTextPreview] = useState<string | null>(null)
  const [snack, setSnack] = useState('')

  const pwQs = unlocked ? `?password=${encodeURIComponent(unlocked)}` : ''
  const rawUrl = info ? `/s/${token}/raw/${encodeURIComponent(info.name)}${pwQs}` : ''

  useEffect(() => {
    api
      .get(`/s/${token}/info`)
      .then((i: ShareInfo) => {
        setInfo(i)
        if (!i.requires_password) setUnlocked('')
      })
      .catch(e => setError(e.message))
  }, [token])

  const ext = info ? extOf(info.name) : ''
  const isImage = IMG.includes(ext)
  const isVideo = VIDEO.includes(ext)
  const isAudio = AUDIO.includes(ext)
  const isText = !!info && !info.is_dir && TEXT.includes(ext) && info.size <= TEXT_PREVIEW_CAP
  const locked = unlocked === null

  useEffect(() => {
    setTextPreview(null)
    if (!info || info.is_dir || !isText || locked) return
    const ctrl = new AbortController()
    fetch(rawUrl, { signal: ctrl.signal })
      .then(res => (res.ok ? res.text() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(setTextPreview)
      .catch(() => {})
    return () => ctrl.abort()
  }, [info, isText, locked, rawUrl])

  // check the password once against a cheap request (one byte of the file,
  // or just the headers of the folder zip), then unlock the previews
  const unlock = async () => {
    if (!info || !password || checking) return
    setChecking(true)
    setPwError('')
    const qs = `?password=${encodeURIComponent(password)}`
    const ctrl = new AbortController()
    try {
      const res = info.is_dir
        ? await fetch(`/s/${token}/download${qs}`, { signal: ctrl.signal })
        : await fetch(`/s/${token}/raw${qs}`, { headers: { Range: 'bytes=0-0' }, signal: ctrl.signal })
      // 416: an empty file has no byte 0, but the password was accepted
      if (res.ok || res.status === 416) {
        ctrl.abort()
        setUnlocked(password)
      } else if (res.status === 401) {
        setPwError('Wrong password')
      } else {
        // 429 (too many attempts) and friends carry a readable message
        setPwError(await readError(res))
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') setPwError(e?.message ?? 'Network error')
    } finally {
      setChecking(false)
    }
  }

  if (error) {
    return (
      <Center>
        <Paper sx={CARD_SX}>
          <Box sx={{ textAlign: 'center', py: 2 }}>
            <Box sx={{ width: 56, height: 56, mx: 'auto', mb: 2, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: t => alpha(t.palette.error.main, 0.12), color: 'error.main' }}>
              <LinkOffRounded />
            </Box>
            <Typography variant="h6" component="h1">This link isn't available</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2.5 }}>
              {/not found|no longer/i.test(error)
                ? 'It may have expired, been revoked, or the file was removed.'
                : error}
            </Typography>
            <Button variant="outlined" color="inherit" onClick={() => nav('/')} sx={{ borderColor: 'divider' }}>
              Go to rBox
            </Button>
          </Box>
        </Paper>
        <Footer />
      </Center>
    )
  }

  const visuals = getEntryVisuals({ name: info?.name ?? '', is_dir: !!info?.is_dir })

  const copyRaw = async () => {
    const ok = await copyText(`${location.origin}${rawUrl}`)
    setSnack(ok ? 'Raw link copied to clipboard' : 'Copying is blocked here; use Open Raw and copy the address')
  }

  const download = () => {
    if (!info || locked) return
    window.location.href = `/s/${token}/download${pwQs}`
  }

  return (
    <Center>
      <Paper sx={CARD_SX}>
        <Stack spacing={2.25}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
            <Box
              sx={{
                width: 48, height: 48, borderRadius: 1.5, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                bgcolor: visuals.bg,
              }}
            >
              <EntryIcon entry={{ name: info?.name ?? '', is_dir: !!info?.is_dir }} size={26} />
            </Box>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="h6" component="h1" noWrap title={info?.name} sx={{ lineHeight: 1.3 }}>
                {info?.name ?? 'Loading…'}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {info ? `${info.is_dir ? 'Folder · downloads as .zip' : kindLabel(info)} · ${fmtSize(info.size)}` : '\u00a0'}
              </Typography>
            </Box>
          </Box>

          {info?.requires_password && locked && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
              <LockRounded sx={{ fontSize: 18 }} />
              <Typography variant="body2">This share is password protected.</Typography>
            </Box>
          )}
          {info?.requires_password && locked && (
            <Stack direction="row" spacing={1} alignItems="flex-start">
              <TextField
                label="Password"
                type="password"
                autoComplete="off"
                value={password}
                autoFocus
                onChange={e => { setPassword(e.target.value); setPwError('') }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) unlock()
                }}
                error={!!pwError}
                helperText={pwError || ' '}
                fullWidth
              />
              <Button variant="contained" onClick={unlock} disabled={!password || checking} sx={{ mt: 1 }}>
                Unlock
              </Button>
            </Stack>
          )}

          {info && !info.is_dir && !locked && (isImage || isVideo || isAudio) && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: 'action.hover',
                borderRadius: 1.5,
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
                bgcolor: 'action.hover',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1.5,
                p: 2,
              }}
            >
              <Typography
                component="pre"
                sx={{
                  fontFamily: '"JetBrains Mono", "Consolas", monospace',
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
            {!info?.is_dir && (
              <>
                <Button
                  variant="outlined"
                  color="inherit"
                  startIcon={<ContentCopy />}
                  disabled={!info || locked}
                  onClick={copyRaw}
                  sx={{ borderColor: 'divider' }}
                >
                  Copy direct link
                </Button>
                <Button
                  variant="outlined"
                  color="inherit"
                  startIcon={<OpenInNew />}
                  disabled={!info || locked}
                  onClick={() => window.open(rawUrl, '_blank', 'noopener')}
                  sx={{ borderColor: 'divider' }}
                >
                  Open
                </Button>
              </>
            )}
          </Box>
          {!info?.is_dir && (
            <Typography variant="caption" color="text.secondary">
              The direct link streams the file itself, for media embeds, <code>curl</code> and <code>wget</code>.
            </Typography>
          )}
        </Stack>
      </Paper>
      <Footer />
      <Snackbar open={!!snack} autoHideDuration={3000} onClose={() => setSnack('')} message={snack} />
    </Center>
  )
}

const CARD_SX = {
  p: { xs: 2.5, sm: 4 },
  width: '100%',
  maxWidth: 580,
  border: '1px solid',
  borderColor: 'divider',
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        p: 2, gap: 2,
        background: t =>
          `radial-gradient(900px 480px at 50% -10%, ${alpha(t.palette.primary.main, t.palette.mode === 'dark' ? 0.12 : 0.07)}, transparent 70%), ${t.palette.background.default}`,
      }}
    >
      {children}
    </Box>
  )
}

function Footer() {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary', opacity: 0.85 }}>
      <Typography variant="caption">Shared with</Typography>
      <Wordmark size={14} />
    </Box>
  )
}
