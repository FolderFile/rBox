import { useCallback, useEffect, useState } from 'react'
import {
  Box, Button, Card, CardContent, Chip, IconButton, Link, Paper, Snackbar,
  Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Tooltip, Typography, useMediaQuery, useTheme,
} from '@mui/material'
import ContentCopy from '@mui/icons-material/ContentCopy'
import AttachFile from '@mui/icons-material/AttachFile'
import DeleteOutline from '@mui/icons-material/DeleteOutline'
import LockOutlined from '@mui/icons-material/LockOutlined'
import ScheduleRounded from '@mui/icons-material/ScheduleRounded'
import { api, baseName, fmtDate, ShareRow } from './api'
import { ConfirmDialog } from './dialogs'
import { FileBadge } from './fileicons'

export default function Shares() {
  const theme = useTheme()
  const narrow = useMediaQuery(theme.breakpoints.down('sm'))
  const [shares, setShares] = useState<ShareRow[]>([])
  const [snack, setSnack] = useState('')
  const [pending, setPending] = useState<ShareRow | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/shares')
      setShares(res.shares)
    } catch {
      setShares([])
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const copy = async (token: string) => {
    const url = `${location.origin}/s/${token}`
    await navigator.clipboard.writeText(url).catch(() => {})
    setSnack('Link copied to clipboard')
  }

  const copyRaw = async (s: ShareRow) => {
    const url = `${location.origin}/s/${s.token}/raw/${encodeURIComponent(baseName(s.path))}`
    await navigator.clipboard.writeText(url).catch(() => {})
    setSnack('Raw link copied to clipboard')
  }

  const revoke = async (s: ShareRow) => {
    try {
      await api.del(`/api/shares/${s.token}`)
      setPending(null)
      setSnack('Share revoked')
      load()
    } catch (e: any) {
      setSnack(e.message)
    }
  }

  const expiryChip = (s: ShareRow) => {
    if (!s.expires_at) return <Chip size="small" label="Never expires" sx={{ borderRadius: 1, height: 22 }} />
    const expired = s.expires_at * 1000 < Date.now()
    return (
      <Chip
        size="small"
        icon={<ScheduleRounded />}
        label={expired ? 'Expired' : `Expires ${fmtDate(s.expires_at)}`}
        color={expired ? 'error' : 'default'}
        sx={{ borderRadius: 1, height: 22 }}
      />
    )
  }
  const pwChip = (s: ShareRow) =>
    s.requires_password
      ? <Chip size="small" icon={<LockOutlined />} label="Protected" sx={{ borderRadius: 1, height: 22 }} />
      : null

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 1 }}>Shared Links</Typography>

      {/* phones get stacked cards; the wide table only ships on sm+ */}
      {narrow ? (
        <Stack spacing={1.5}>
          {shares.map(s => (
            <Card key={s.id}>
              <CardContent sx={{ '&:last-child': { pb: 2 } }}>
                <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 1 }}>
                  <FileBadge entry={{ name: baseName(s.path), is_dir: false, size: 0, modified: 0 }} size={18} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={600} noWrap title={s.path}>
                      {baseName(s.path)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                      {s.path}
                    </Typography>
                  </Box>
                </Stack>
                <Stack direction="row" spacing={0.75} sx={{ mb: 1.5, flexWrap: 'wrap', gap: 0.75 }}>
                  {expiryChip(s)}
                  {pwChip(s)}
                </Stack>
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<ContentCopy fontSize="small" />}
                    onClick={() => copy(s.token)}
                  >
                    Page Link
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<AttachFile fontSize="small" />}
                    onClick={() => copyRaw(s)}
                  >
                    Raw URL
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    variant="outlined"
                    startIcon={<DeleteOutline fontSize="small" />}
                    onClick={() => setPending(s)}
                  >
                    Revoke
                  </Button>
                </Stack>
              </CardContent>
            </Card>
          ))}
          {shares.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
              No active shares. Right-click a file in My Files to create one.
            </Typography>
          )}
        </Stack>
      ) : (
        <TableContainer component={Paper} variant="outlined" sx={{ width: '100%', overflowX: 'auto', borderRadius: 1.5 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Path</TableCell>
                <TableCell>Link</TableCell>
                <TableCell>Expires</TableCell>
                <TableCell>Password</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {shares.map(s => (
                <TableRow key={s.id} hover>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <FileBadge entry={{ name: baseName(s.path), is_dir: false, size: 0, modified: 0 }} size={16} />
                      <Typography variant="body2" noWrap sx={{ maxWidth: 220 }} title={s.path}>
                        {s.path}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Link href={`/s/${s.token}`} target="_blank" variant="body2" noWrap sx={{ maxWidth: 200 }}>
                        /s/{s.token}
                      </Link>
                      <Tooltip title="Copy link">
                        <IconButton size="small" onClick={() => copy(s.token)}>
                          <ContentCopy fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Copy raw link (direct file / embeds media in chat)">
                        <IconButton size="small" onClick={() => copyRaw(s)}>
                          <AttachFile fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </TableCell>
                  <TableCell>{expiryChip(s)}</TableCell>
                  <TableCell>
                    {s.requires_password ? <Chip icon={<LockOutlined />} label="protected" size="small" sx={{ borderRadius: 1 }} /> : <Typography variant="caption" color="text.secondary">none</Typography>}
                  </TableCell>
                  <TableCell align="right">
                    <Button color="error" startIcon={<DeleteOutline />} onClick={() => setPending(s)}>
                      Revoke
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {shares.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                      No active shares. Right-click a file in My Files to create one.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {pending && (
        <ConfirmDialog
          title="Revoke share"
          message={`Anyone with the link to "${pending.path}" will lose access.`}
          confirmLabel="Revoke"
          open
          onCancel={() => setPending(null)}
          onConfirm={() => revoke(pending)}
        />
      )}

      <Snackbar open={!!snack} autoHideDuration={3000} onClose={() => setSnack('')} message={snack} />
    </Box>
  )
}
