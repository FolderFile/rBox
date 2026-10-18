import { useEffect, useState } from 'react'
import {
  Box, Button, Divider, Drawer, IconButton, Stack, Typography,
} from '@mui/material'
import Close from '@mui/icons-material/Close'
import ContentCopy from '@mui/icons-material/ContentCopy'
import RefreshRounded from '@mui/icons-material/RefreshRounded'
import { api, Entry, fmtDate, fmtSize, StatInfo } from './api'
import { FileBadge } from './fileicons'
import { kindOf } from './filetypes'

const DRAWER_W = 340

// right-side panel with full metadata, on-demand checksum and the shares
// that point at the file
export function InspectorDrawer({
  entry,
  path,
  open,
  onClose,
  onShare,
  onDownload,
}: {
  entry: Entry | null
  path: string
  open: boolean
  onClose: () => void
  onShare: (entry: Entry) => void
  onDownload: (entry: Entry) => void
}) {
  const [info, setInfo] = useState<StatInfo | null>(null)
  const [error, setError] = useState('')
  const [shares, setShares] = useState<string[]>([])
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open || !entry) return
    setInfo(null)
    setError('')
    setShares([])
    api
      .get(`/api/files/stat?path=${encodeURIComponent(path)}`)
      .then(i => {
        setInfo(i)
        return api.get('/api/shares')
      })
      .then(res => {
        setShares(
          (res.shares as { token: string; path: string }[])
            .filter(s => s.path === path)
            .map(s => s.token),
        )
      })
      .catch(e => setError(e.message))
  }, [open, entry, path])

  if (!entry) return null
  const kind = kindOf(entry.name, entry.is_dir)
  const isImage = kind === 'image'

  const copySha = async () => {
    if (!info?.sha256) return
    await navigator.clipboard.writeText(info.sha256).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const recompute = () => {
    setBusy(true)
    api
      .get(`/api/files/stat?path=${encodeURIComponent(path)}`)
      .then(setInfo)
      .catch(e => setError(e.message))
      .finally(() => setBusy(false))
  }

  return (
    <Drawer
      open={open}
      anchor="right"
      onClose={onClose}
      slotProps={{ paper: { sx: { width: { xs: '100%', sm: DRAWER_W }, px: 2, py: 2 } } }}
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle1" fontWeight={600} noWrap title={entry.name}>
            {entry.name}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            {path}
          </Typography>
        </Box>
        <IconButton size="small" onClick={onClose}><Close fontSize="small" /></IconButton>
      </Stack>

      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'action.hover',
          borderRadius: 2,
          py: 3,
          mb: 2,
          minHeight: 120,
        }}
      >
        {isImage ? (
          <img
            src={`/api/files/download?path=${encodeURIComponent(path)}`}
            alt={entry.name}
            loading="lazy"
            style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 8 }}
          />
        ) : (
          <FileBadge entry={entry} size={48} />
        )}
      </Box>

      {error && (
        <Typography variant="caption" color="error">{error}</Typography>
      )}

      {info && (
        <Stack spacing={1.5}>
          <Row label="Size" value={`${fmtSize(info.size)}${info.is_dir && info.items ? ` · ${info.items} items` : ''}`} />
          <Row label="Modified" value={fmtDate(info.modified)} />
          <Row label="MIME" value={info.mime || 'unknown'} />
          {info.sha256 && (
            <>
              <Divider />
              <Typography variant="caption" color="text.secondary">SHA-256 checksum</Typography>
              <Typography
                component="code"
                sx={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: '0.7rem',
                  wordBreak: 'break-all',
                  bgcolor: 'action.hover',
                  borderRadius: 1,
                  p: 1,
                }}
              >
                {info.sha256}
              </Typography>
              <Button
                size="small"
                variant={copied ? 'outlined' : 'text'}
                startIcon={<ContentCopy fontSize="small" />}
                onClick={copySha}
              >
                {copied ? 'Copied' : 'Copy checksum'}
              </Button>
            </>
          )}
          {shares.length > 0 && (
            <>
              <Divider />
              <Typography variant="caption" color="text.secondary">
                Active share links
              </Typography>
              {shares.map(token => (
                <Box key={token}>
                  <a
                    href={`/s/${token}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: '0.75rem',
                      color: undefined,
                    }}
                  >
                    {`/s/${token}`}
                  </a>
                </Box>
              ))}
            </>
          )}
          <Divider />
          <Stack direction="row" spacing={1}>
            <Button size="small" onClick={() => onDownload(entry)}>Download</Button>
            <Button size="small" onClick={() => onShare(entry)}>Share</Button>
            <Box sx={{ flex: 1 }} />
            <IconButton size="small" onClick={recompute} disabled={busy}>
              <RefreshRounded fontSize="small" />
            </IconButton>
          </Stack>
        </Stack>
      )}
    </Drawer>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" spacing={1}>
      <Typography variant="body2" color="text.secondary" sx={{ width: 76 }}>
        {label}
      </Typography>
      <Typography variant="body2" noWrap title={value} sx={{ flex: 1 }}>
        {value}
      </Typography>
    </Stack>
  )
}