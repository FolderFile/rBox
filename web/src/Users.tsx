import { useCallback, useEffect, useState } from 'react'
import {
  Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent,
  DialogTitle, FormControlLabel, IconButton, LinearProgress, MenuItem, Paper,
  Snackbar, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField,
  Tooltip, Typography,
} from '@mui/material'
import Add from '@mui/icons-material/PersonAddAlt1Outlined'
import RefreshOutlined from '@mui/icons-material/RefreshOutlined'
import EditOutlined from '@mui/icons-material/EditOutlined'
import DeleteOutline from '@mui/icons-material/DeleteOutline'
import { api, AdminUser, fmtPercent, fmtRelative, fmtSize } from './api'
import { UserAvatar } from './Shell'

export default function Users() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [snack, setSnack] = useState('')
  const [error, setError] = useState('')
  const [create, setCreate] = useState(false)
  const [editing, setEditing] = useState<AdminUser | null>(null)
  const [deleting, setDeleting] = useState<AdminUser | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/admin/users')
      setUsers(res.users)
      setError('')
    } catch (e: any) {
      setError(e.message)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const ok = (msg: string) => {
    setSnack(msg)
    load()
  }
  const fail = (e: any) => setSnack(e.message)

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1, gap: 1 }}>
        <Typography variant="h6" sx={{ flex: 1 }}>Users</Typography>
        <Button startIcon={<Add />} variant="contained" onClick={() => setCreate(true)}>New user</Button>
      </Box>
      {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}

      <TableContainer component={Paper} variant="outlined" sx={{ width: '100%', overflowX: 'auto', borderRadius: 2 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Username</TableCell>
              <TableCell>Role</TableCell>
              <TableCell sx={{ minWidth: 180 }}>Storage</TableCell>
              <TableCell>Created</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {users.map(u => {
              const pct = u.quota_bytes ? Math.min((u.used_bytes / u.quota_bytes) * 100, 100) : 0
              return (
                <TableRow key={u.id} hover>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                      <UserAvatar name={u.username} size={28} />
                      <Typography variant="body2" fontWeight={600}>{u.username}</Typography>
                    </Box>
                  </TableCell>
                  <TableCell>
                    {u.is_admin
                      ? <Chip size="small" color="primary" label="Admin" sx={{ borderRadius: 1 }} />
                      : <Chip size="small" variant="outlined" label="Member" sx={{ borderRadius: 1 }} />}
                  </TableCell>
                  <TableCell>
                    <Tooltip title={`${fmtSize(u.used_bytes)} of ${fmtSize(u.quota_bytes)}`}>
                      <Box>
                        <LinearProgress
                          variant="determinate"
                          value={u.used_bytes > 0 ? Math.max(pct, 1.5) : 0}
                          color={pct > 95 ? 'error' : pct > 80 ? 'warning' : 'primary'}
                          sx={{ height: 6, borderRadius: 3 }}
                        />
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, mt: 0.25, fontVariantNumeric: 'tabular-nums' }}>
                          <span>{fmtSize(u.used_bytes)} of {fmtSize(u.quota_bytes)}</span>
                          <span>{fmtPercent(u.used_bytes, u.quota_bytes)}</span>
                        </Typography>
                      </Box>
                    </Tooltip>
                  </TableCell>
                  <TableCell sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
                    <Tooltip title={new Date(u.created_at).toLocaleString()}>
                      <span>{fmtRelative(Date.parse(u.created_at) / 1000)}</span>
                    </Tooltip>
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Recalculate disk usage">
                      <IconButton aria-label={`Recalculate disk usage for ${u.username}`} size="small" onClick={() => api.post(`/api/admin/users/${encodeURIComponent(u.username)}/recalc`).then(() => ok(`Recalculated ${u.username}`)).catch(fail)}>
                        <RefreshOutlined fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Edit">
                      <IconButton aria-label={`Edit ${u.username}`} size="small" onClick={() => setEditing(u)}>
                        <EditOutlined fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <IconButton aria-label={`Delete ${u.username}`} size="small" onClick={() => setDeleting(u)}>
                        <DeleteOutline fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {create && (
        <CreateDialog
          onCancel={() => setCreate(false)}
          onDone={u => {
            setCreate(false)
            ok(`Created ${u}`)
          }}
          onFail={fail}
        />
      )}
      {editing && (
        <EditDialog user={editing} onCancel={() => setEditing(null)} onDone={msg => { setEditing(null); ok(msg) }} onFail={fail} />
      )}
      {deleting && (
        <DeleteDialog user={deleting} onCancel={() => setDeleting(null)} onDone={msg => { setDeleting(null); ok(msg) }} onFail={fail} />
      )}

      <Snackbar open={!!snack} autoHideDuration={3000} onClose={() => setSnack('')} message={snack} />
    </Box>
  )
}

function parseQuota(s: string): number | null {
  const m = s.trim().match(/^([\d.]+)\s*([kmgt]?i?b?)$/i)
  if (!m) return null
  const mult: Record<string, number> = {
    '': 1, b: 1, k: 1024, kb: 1024, kib: 1024,
    m: 1024 ** 2, mb: 1024 ** 2, mib: 1024 ** 2,
    g: 1024 ** 3, gb: 1024 ** 3, gib: 1024 ** 3,
    t: 1024 ** 4, tb: 1024 ** 4, tib: 1024 ** 4,
  }
  return Math.round(parseFloat(m[1]) * (mult[m[2].toLowerCase()] ?? NaN))
}

function CreateDialog({ onCancel, onDone, onFail }: { onCancel: () => void; onDone: (u: string) => void; onFail: (e: any) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [quota, setQuota] = useState('1GB')
  const [err, setErr] = useState('')

  const submit = async () => {
    const q = parseQuota(quota)
    if (q === null || !Number.isFinite(q) || q <= 0) return setErr('bad quota (e.g. 500MB, 10GB)')
    try {
      await api.post('/api/admin/users', { username, password, quota_bytes: q, is_admin: false })
      onDone(username)
    } catch (e: any) {
      setErr(e.message)
      onFail(e)
    }
  }

  return (
    <Dialog open onClose={onCancel}>
      <DialogTitle>New user</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {err && <Alert severity="error">{err}</Alert>}
          <TextField label="Username" value={username} onChange={e => setUsername(e.target.value)} />
          <TextField label="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} />
          <TextField label="Quota" value={quota} onChange={e => setQuota(e.target.value)} helperText="e.g. 500MB, 10GB" />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="contained" disabled={!username || !password} onClick={submit}>Create</Button>
      </DialogActions>
    </Dialog>
  )
}

function EditDialog({ user, onCancel, onDone, onFail }: { user: AdminUser; onCancel: () => void; onDone: (msg: string) => void; onFail: (e: any) => void }) {
  // the field shows a rounded size ("1.5 GiB"); only an edited value is sent,
  // so saving a password change never rewrites an exact byte quota
  const initialQuota = fmtSize(user.quota_bytes)
  const [quota, setQuota] = useState(initialQuota)
  const [password, setPassword] = useState('')
  const [isAdmin, setIsAdmin] = useState(user.is_admin)
  const [err, setErr] = useState('')

  const submit = async () => {
    const body: Record<string, unknown> = {}
    if (isAdmin !== user.is_admin) body.is_admin = isAdmin
    if (quota.trim() !== initialQuota) {
      const q = parseQuota(quota)
      if (q === null || !Number.isFinite(q) || q <= 0) return setErr('bad quota (e.g. 500MB, 10GB)')
      body.quota_bytes = q
    }
    if (password) body.password = password
    if (!Object.keys(body).length) return onCancel()
    try {
      await api.patch(`/api/admin/users/${encodeURIComponent(user.username)}`, body)
      onDone(`Updated ${user.username}`)
    } catch (e: any) {
      setErr(e.message)
      onFail(e)
    }
  }

  return (
    <Dialog open onClose={onCancel}>
      <DialogTitle>Edit {user.username}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {err && <Alert severity="error">{err}</Alert>}
          <TextField label="Quota" value={quota} onChange={e => setQuota(e.target.value)} helperText="e.g. 500MB, 10GB" />
          <TextField label="New password" type="password" value={password} onChange={e => setPassword(e.target.value)} helperText="Leave empty to keep" />
          <TextField select label="Role" value={isAdmin ? 'admin' : 'user'} onChange={e => setIsAdmin(e.target.value === 'admin')}>
            <MenuItem value="user">user</MenuItem>
            <MenuItem value="admin">admin</MenuItem>
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="contained" onClick={submit}>Save</Button>
      </DialogActions>
    </Dialog>
  )
}

function DeleteDialog({ user, onCancel, onDone, onFail }: { user: AdminUser; onCancel: () => void; onDone: (msg: string) => void; onFail: (e: any) => void }) {
  const [purge, setPurge] = useState(false)
  const [err, setErr] = useState('')

  const submit = async () => {
    try {
      await api.del(`/api/admin/users/${encodeURIComponent(user.username)}${purge ? '?purge=true' : ''}`)
      onDone(`Deleted ${user.username}`)
    } catch (e: any) {
      setErr(e.message)
      onFail(e)
    }
  }

  return (
    <Dialog open onClose={onCancel}>
      <DialogTitle>Delete {user.username}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {err && <Alert severity="error">{err}</Alert>}
          <Typography variant="body2">
            This removes the account. Deleting files cannot be undone.
          </Typography>
          <FormControlLabel
            control={<Checkbox checked={purge} onChange={e => setPurge(e.target.checked)} />}
            label="Purge all stored files"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="contained" color="error" onClick={submit}>Delete</Button>
      </DialogActions>
    </Dialog>
  )
}