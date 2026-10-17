import { useCallback, useEffect, useState } from 'react'
import {
  Box, Button, Chip, IconButton, Link, Paper, Snackbar, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography,
} from '@mui/material'
import ContentCopy from '@mui/icons-material/ContentCopy'
import AttachFile from '@mui/icons-material/AttachFile'
import DeleteOutline from '@mui/icons-material/DeleteOutline'
import LockOutlined from '@mui/icons-material/LockOutlined'
import { api, baseName, fmtDate, ShareRow } from './api'
import { ConfirmDialog } from './dialogs'

export default function Shares() {
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

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 1 }}>Shared Links</Typography>
      <TableContainer component={Paper} variant="outlined" sx={{ width: '100%', overflowX: 'auto', borderRadius: 2 }}>
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
                  <Typography variant="body2" noWrap sx={{ maxWidth: 240 }} title={s.path}>
                    {s.path}
                  </Typography>
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
                <TableCell>
                  {s.expires_at ? (
                    <Typography variant="body2" color={s.expires_at * 1000 < Date.now() ? 'error' : 'textPrimary'}>
                      {fmtDate(s.expires_at)}
                    </Typography>
                  ) : (
                    'Never'
                  )}
                </TableCell>
                <TableCell>
                  {s.requires_password ? <Chip icon={<LockOutlined />} label="protected" size="small" /> : 'none'}
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

      {pending && (
        <ConfirmDialog
          title="Revoke share"
          message={`Anyone with the link to “${pending.path}” will lose access.`}
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