import React, { useCallback, useEffect, useState } from 'react'
import {
  Alert, Box, Button, Card, CardContent, Chip, Divider, IconButton,
  InputAdornment, LinearProgress, List, ListItem, ListItemAvatar,
  ListItemText, Snackbar, Stack, TextField, ToggleButton, ToggleButtonGroup,
  Tooltip, Typography,
} from '@mui/material'
import DevicesRounded from '@mui/icons-material/DevicesRounded'
import PhoneIphoneRounded from '@mui/icons-material/PhoneIphoneRounded'
import StorageRounded from '@mui/icons-material/StorageRounded'
import TuneRounded from '@mui/icons-material/TuneRounded'
import LockRounded from '@mui/icons-material/LockRounded'
import DevicesOtherRounded from '@mui/icons-material/DevicesOtherRounded'
import RefreshRounded from '@mui/icons-material/RefreshRounded'
import Visibility from '@mui/icons-material/VisibilityRounded'
import VisibilityOff from '@mui/icons-material/VisibilityOffRounded'
import DeleteOutline from '@mui/icons-material/DeleteOutline'
import DarkModeRounded from '@mui/icons-material/DarkModeRounded'
import LightModeRounded from '@mui/icons-material/LightModeRounded'
import TableRowsRounded from '@mui/icons-material/TableRowsRounded'
import ViewListRounded from '@mui/icons-material/ViewListRounded'
import GridViewRounded from '@mui/icons-material/GridViewRounded'
import CheckCircle from '@mui/icons-material/CheckCircleRounded'
import { api, fmtSize, parseUserAgent, SessionRow } from './api'
import { useAuth } from './auth'
import { useThemeToggle } from './App'

// everything in Preferences is a plain default: read by Files/Editor on
// mount, so there is no broadcast plumbing to keep in sync
export const PREFS = {
  view: 'rbox-view',
  fontSize: 'rbox-editor-fontsize',
  wrap: 'rbox-editor-wrap',
  lineNumbers: 'rbox-editor-linenums',
}

function Section({
  icon, title, subtitle, action, children,
}: {
  icon: React.ReactNode
  title: string
  subtitle?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Stack direction="row" spacing={1.5} alignItems="flex-start" sx={{ mb: 1.5 }}>
          <Box sx={{
            display: 'inline-flex', p: 0.75, borderRadius: 1, mt: 0.25,
            bgcolor: 'rgba(244, 63, 94, 0.12)', color: 'primary.main',
          }}>
            {icon}
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" fontWeight={700}>{title}</Typography>
            {subtitle && <Typography variant="body2" color="text.secondary">{subtitle}</Typography>}
          </Box>
          {action}
        </Stack>
        {children}
      </CardContent>
    </Card>
  )
}

function SegControl<T extends string | number>(props: {
  label: string
  hint?: string
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; icon?: React.ReactNode }[]
}) {
  return (
    <Box>
      <Typography variant="body2" fontWeight={600} sx={{ mb: 0.75 }}>{props.label}</Typography>
      <ToggleButtonGroup
        size="small"
        exclusive
        value={props.value}
        onChange={(_, v) => { if (v !== null) props.onChange(v as T) }}
        sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}
      >
        {props.options.map(o => (
          <ToggleButton key={String(o.value)} value={o.value} sx={{
            px: 1.5, borderRadius: 1, textTransform: 'none',
            display: 'inline-flex', gap: 0.75,
          }}>
            {o.icon}
            {o.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      {props.hint && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
          {props.hint}
        </Typography>
      )}
    </Box>
  )
}

function PasswordField({ label, value, onChange, error, helperText }: {
  label: string
  value: string
  onChange: (v: string) => void
  error?: boolean
  helperText?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <TextField
      fullWidth
      type={show ? 'text' : 'password'}
      label={label}
      value={value}
      error={error}
      helperText={helperText}
      onChange={e => onChange(e.target.value)}
      InputProps={{
        endAdornment: (
          <InputAdornment position="end">
            <IconButton size="small" onClick={() => setShow(s => !s)} aria-label={`toggle ${label} visibility`}>
              {show ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
            </IconButton>
          </InputAdornment>
        ),
      }}
    />
  )
}

export default function Settings() {
  const { user, refresh } = useAuth()
  const { mode, toggle } = useThemeToggle()

  // storage
  const [recalcBusy, setRecalcBusy] = useState(false)
  const [recalcMsg, setRecalcMsg] = useState('')

  // preferences
  const [view, setView] = useState<string>(() => localStorage.getItem(PREFS.view) ?? 'table')
  const [fontSize, setFontSize] = useState<number>(() => Number(localStorage.getItem(PREFS.fontSize) ?? 14))
  const [wrap, setWrap] = useState<boolean>(() => (localStorage.getItem(PREFS.wrap) ?? 'on') === 'on')
  const [lineNums, setLineNums] = useState<boolean>(() => (localStorage.getItem(PREFS.lineNumbers) ?? 'on') === 'on')

  useEffect(() => { localStorage.setItem(PREFS.view, view) }, [view])
  useEffect(() => { localStorage.setItem(PREFS.fontSize, String(fontSize)) }, [fontSize])
  useEffect(() => { localStorage.setItem(PREFS.wrap, wrap ? 'on' : 'off') }, [wrap])
  useEffect(() => { localStorage.setItem(PREFS.lineNumbers, lineNums ? 'on' : 'off') }, [lineNums])

  // security
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwMsg, setPwMsg] = useState('')
  const [pwErr, setPwErr] = useState('')
  const [pwBusy, setPwBusy] = useState(false)

  // sessions
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [snack, setSnack] = useState('')

  const loadSessions = useCallback(async () => {
    try {
      const res = await api.get('/api/auth/sessions')
      setSessions(res.sessions)
    } catch {
      setSessions([])
    }
  }, [])

  useEffect(() => { loadSessions() }, [loadSessions])

  const quota = user?.quota_bytes ?? 0
  const used = user?.used_bytes ?? 0
  const pct = quota ? Math.min((used / quota) * 100, 100) : 0

  const recalc = async () => {
    setRecalcBusy(true)
    setRecalcMsg('')
    try {
      await api.post(`/api/admin/users/${encodeURIComponent(user!.username)}/recalc`)
      await refresh()
      setRecalcMsg('Disk usage recalculated.')
    } catch {
      setRecalcMsg('Recalculation needs admin access, or ran on the server already.')
    } finally {
      setRecalcBusy(false)
    }
  }

  const changePassword = async () => {
    setPwMsg(''); setPwErr('')
    setPwBusy(true)
    try {
      const res = await api.post('/api/auth/password', {
        current_password: currentPw,
        new_password: newPw,
      })
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
      setPwMsg(`Password changed. ${res.revoked_sessions} other session${res.revoked_sessions === 1 ? '' : 's'} signed out.`)
      loadSessions()
    } catch (e: any) {
      setPwErr(e.message)
    } finally {
      setPwBusy(false)
    }
  }

  const revoke = async (s: SessionRow) => {
    try {
      await api.del(`/api/auth/sessions/${s.id}`)
      setSnack(s.current ? 'Signed out. Reload to log in again.' : 'Session revoked')
      loadSessions()
    } catch (e: any) {
      setSnack(e.message)
    }
  }

  const revokeAll = async () => {
    const others = sessions.filter(s => !s.current)
    for (const s of others) {
      await api.del(`/api/auth/sessions/${s.id}`).catch(() => {})
    }
    setSnack(`${others.length} session${others.length === 1 ? '' : 's'} revoked`)
    loadSessions()
  }

  const pwMismatch = confirmPw.length > 0 && newPw !== confirmPw
  const pwTooShort = newPw.length > 0 && newPw.length < 8
  const othersCount = sessions.filter(s => !s.current).length

  return (
    <Box sx={{ maxWidth: 760 }}>
      <Typography variant="h6" sx={{ mb: 1.5 }}>Settings</Typography>

      <Section
        icon={<StorageRounded fontSize="small" />}
        title="Storage &amp; Quota"
        subtitle="How much of your vault is in use."
        action={
          <Tooltip title="Recalculate disk usage">
            <span>
              <Button size="small" variant="outlined" startIcon={<RefreshRounded />} onClick={recalc} disabled={recalcBusy}>
                Recalculate
              </Button>
            </span>
          </Tooltip>
        }
      >
        <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 1 }}>
          <Box sx={{ flex: 1 }}>
            <LinearProgress
              variant="determinate"
              value={pct}
              color={pct > 95 ? 'error' : pct > 80 ? 'warning' : 'primary'}
              sx={{ height: 8, borderRadius: 4 }}
            />
          </Box>
          <Chip label={`${pct.toFixed(pct < 10 ? 1 : 0)}%`} size="small" color={pct > 95 ? 'error' : pct > 80 ? 'warning' : 'default'} sx={{ borderRadius: 1 }} />
        </Stack>
        <Typography variant="body2">
          <strong>{fmtSize(used)}</strong>
          <Box component="span" color="text.secondary"> of {fmtSize(quota)} used</Box>
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {fmtSize(Math.max(quota - used, 0))} available
          {quota === 0 ? ' (unlimited is not configured)' : ''}
        </Typography>
        {recalcMsg && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>{recalcMsg}</Typography>}
      </Section>

      <Section icon={<TuneRounded fontSize="small" />} title="Preferences &amp; Appearance" subtitle="Saved on this device, applied immediately.">
        <Stack spacing={2}>
          <SegControl
            label="Theme"
            value={mode}
            onChange={() => toggle()}
            options={[
              { value: 'light', label: 'Light', icon: <LightModeRounded fontSize="small" /> },
              { value: 'dark', label: 'Dark', icon: <DarkModeRounded fontSize="small" /> },
            ]}
          />
          <Divider sx={{ opacity: 0.6 }} />
          <SegControl
            label="Default explorer view"
            value={view}
            onChange={setView}
            hint="New sessions start in this view when you open My Files."
            options={[
              { value: 'table', label: 'Table', icon: <TableRowsRounded fontSize="small" /> },
              { value: 'list', label: 'Compact', icon: <ViewListRounded fontSize="small" /> },
              { value: 'grid', label: 'Grid', icon: <GridViewRounded fontSize="small" /> },
            ]}
          />
          <SegControl
            label="Editor font size"
            value={fontSize}
            onChange={setFontSize}
            options={[
              { value: 12, label: '12 px' },
              { value: 14, label: '14 px' },
              { value: 16, label: '16 px' },
            ]}
          />
          <SegControl
            label="Word wrap"
            value={wrap ? 'on' : 'off'}
            onChange={v => setWrap(v === 'on')}
            options={[
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ]}
          />
          <SegControl
            label="Line numbers on plain text"
            value={lineNums ? 'on' : 'off'}
            onChange={v => setLineNums(v === 'on')}
            options={[
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ]}
          />
        </Stack>
      </Section>

      <Section icon={<LockRounded fontSize="small" />} title="Account Security" subtitle="Changing your password signs out every other device.">
        {pwMsg && <Alert severity="success" sx={{ mb: 2 }}>{pwMsg}</Alert>}
        {pwErr && <Alert severity="error" sx={{ mb: 2 }}>{pwErr}</Alert>}
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <PasswordField label="Current password" value={currentPw} onChange={setCurrentPw} />
            <PasswordField
              label="New password"
              value={newPw}
              onChange={setNewPw}
              error={pwTooShort}
              helperText={pwTooShort ? 'Password must be at least 8 characters' : 'Minimum 8 characters'}
            />
            <PasswordField
              label="Confirm new password"
              value={confirmPw}
              onChange={setConfirmPw}
              error={pwMismatch}
              helperText={pwMismatch ? 'Passwords do not match' : ' '}
            />
          </Stack>
          <Box>
            <Button
              variant="contained"
              startIcon={pwMsg ? <CheckCircle /> : undefined}
              disabled={pwBusy || !currentPw || newPw.length < 8 || newPw !== confirmPw}
              onClick={changePassword}
            >
              Update Password
            </Button>
          </Box>
        </Stack>
      </Section>

      <Section
        icon={<DevicesOtherRounded fontSize="small" />}
        title="Active Sessions"
        subtitle={`${sessions.length} device${sessions.length === 1 ? '' : 's'} are signed in.`}
        action={
          othersCount > 0 ? (
            <Button size="small" color="error" variant="outlined" onClick={revokeAll}>
              Revoke all others
            </Button>
          ) : undefined
        }
      >
        <List disablePadding>
          {sessions.map((s, i) => {
            const { browser, os } = parseUserAgent(s.user_agent)
            const mobile = /Android|iPhone|iPad/i.test(s.user_agent)
            return (
              <React.Fragment key={s.id}>
                {i > 0 && <Divider component="li" sx={{ opacity: 0.5 }} />}
                <ListItem
                  disableGutters
                  secondaryAction={
                    s.current ? (
                      <Chip icon={<CheckCircle />} label="Current device" size="small" color="success" sx={{ borderRadius: 1 }} />
                    ) : (
                      <Tooltip title="Revoke this session">
                        <IconButton edge="end" size="small" color="error" onClick={() => revoke(s)}>
                          <DeleteOutline fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )
                  }
                >
                  <ListItemAvatar sx={{ minWidth: 48 }}>
                    <Box sx={{
                      display: 'inline-flex', p: 1, borderRadius: 1,
                      bgcolor: 'action.hover', color: 'text.secondary',
                    }}>
                      {mobile ? <PhoneIphoneRounded /> : <DevicesRounded />}
                    </Box>
                  </ListItemAvatar>
                  <ListItemText
                    primary={<Typography variant="body2" fontWeight={600}>{browser} on {os}</Typography>}
                    secondary={`Signed in ${new Date(s.created_at).toLocaleString()}`}
                    slotProps={{ secondary: { variant: 'caption' } }}
                  />
                </ListItem>
              </React.Fragment>
            )
          })}
          {sessions.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>No active sessions found.</Typography>
          )}
        </List>
      </Section>

      <Snackbar open={!!snack} autoHideDuration={4000} onClose={() => setSnack('')} message={snack} />
    </Box>
  )
}
