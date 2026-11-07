import { useEffect, useState } from 'react'
import {
  Box, Button, CircularProgress, Divider, Drawer, IconButton, Stack, Tooltip, Typography,
} from '@mui/material'
import Close from '@mui/icons-material/Close'
import ContentCopy from '@mui/icons-material/ContentCopy'
import RefreshRounded from '@mui/icons-material/RefreshRounded'
import { api, copyText, Entry, fmtDate, fmtSize, StatInfo } from './api'
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

  const hasEntry = !!entry
  useEffect(() => {
    if (!open || !hasEntry) return
    // a slow stat (hashing, deep folders) must not land on a newer file
    let cancelled = false
    setInfo(null)
    setError('')
    setShares([])
    api
      .get(`/api/files/stat?path=${encodeURIComponent(path)}`)
      .then(i => {
        if (cancelled) return
        setInfo(i)
        return api.get('/api/shares')
      })
      .then(res => {
        if (cancelled || !res) return
        setShares(
          (res.shares as { token: string; path: string }[])
            .filter(s => s.path === path)
            .map(s => s.token),
        )
      })
      .catch(e => {
        if (!cancelled) setError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [open, hasEntry, path])

  if (!entry) return null
  const kind = kindOf(entry.name, entry.is_dir)
  const isImage = kind === 'image'

  const copySha = async () => {
    if (!info?.sha256) return
    if (!(await copyText(info.sha256))) return setError('Could not copy; select the checksum manually')
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
      slotProps={{ paper: { sx: { width: { xs: '100%', sm: DRAWER_W }, px: 1.5, py: 1.5 } } }}
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
        <IconButton aria-label="Close details" size="small" onClick={onClose}><Close fontSize="small" /></IconButton>
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

      {/* stat hashes the file and walks folders, so it can take a while */}
      {!info && !error && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress size={22} aria-label="Loading details" />
        </Box>
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
            <Tooltip title="Refresh details">
              <span>
                <IconButton aria-label="Refresh details" size="small" onClick={recompute} disabled={busy}>
                  <RefreshRounded fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
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