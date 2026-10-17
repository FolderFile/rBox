import { useCallback, useEffect, useState } from 'react'
import {
  Alert, Box, Button, Card, CardContent, Chip, IconButton, List,
  ListItem, ListItemAvatar, ListItemText, Snackbar, Stack, Typography,
} from '@mui/material'
import DevicesRounded from '@mui/icons-material/DevicesRounded'
import PhoneIphoneRounded from '@mui/icons-material/PhoneIphoneRounded'
import DeleteOutline from '@mui/icons-material/DeleteOutline'
import { api, parseUserAgent, SessionRow } from './api'

export default function Account() {
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [pwMsg, setPwMsg] = useState('')
  const [pwErr, setPwErr] = useState('')
  const [snack, setSnack] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/auth/sessions')
      setSessions(res.sessions)
    } catch {
      setSessions([])
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const changePassword = async () => {
    setPwMsg('')
    setPwErr('')
    try {
      const res = await api.post('/api/auth/password', {
        current_password: currentPw,
        new_password: newPw,
      })
      setCurrentPw('')
      setNewPw('')
      setPwMsg(
        `Password changed. ${res.revoked_sessions} other session${res.revoked_sessions === 1 ? '' : 's'} signed out.`,
      )
      load()
    } catch (e: any) {
      setPwErr(e.message)
    }
  }

  const revoke = async (s: SessionRow) => {
    try {
      await api.del(`/api/auth/sessions/${s.id}`)
      setSnack(s.current ? 'Signed out. Reload to log in again.' : 'Session revoked')
      load()
    } catch (e: any) {
      setSnack(e.message)
    }
  }

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 2 }}>Account &amp; Sessions</Typography>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 2 }}>Change Password</Typography>
          {pwMsg && <Alert severity="success" sx={{ mb: 2 }}>{pwMsg}</Alert>}
          {pwErr && <Alert severity="error" sx={{ mb: 2 }}>{pwErr}</Alert>}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'flex-end' }}>
            <Box sx={{ flex: 1 }}>
              <Typography variant="caption" color="text.secondary">Current password</Typography>
              <PasswordField value={currentPw} onChange={setCurrentPw} />
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography variant="caption" color="text.secondary">New password (min 8 chars)</Typography>
              <PasswordField value={newPw} onChange={setNewPw} />
            </Box>
            <Button
              variant="contained"
              disabled={!currentPw || newPw.length < 8}
              onClick={changePassword}
            >
              Update
            </Button>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent sx={{ pb: sessions.length ? 0 : 2 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
            <Typography variant="subtitle2" sx={{ flex: 1 }}>Active Devices</Typography>
            <Chip label={`${sessions.length} active`} size="small" sx={{ borderRadius: 2 }} />
          </Stack>
          <List>
            {sessions.map(s => {
              const { browser, os } = parseUserAgent(s.user_agent)
              const mobile = /Android|iPhone|iPad/i.test(s.user_agent)
              return (
                <ListItem
                  key={s.id}
                  secondaryAction={
                    <IconButton edge="end" size="small" onClick={() => revoke(s)}>
                      <DeleteOutline fontSize="small" />
                    </IconButton>
                  }
                >
                  <ListItemAvatar sx={{ minWidth: 44 }}>
                    {mobile ? <PhoneIphoneRounded color="action" /> : <DevicesRounded color="action" />}
                  </ListItemAvatar>
                  <ListItemText
                    primary={
                      <Stack direction="row" spacing={1} alignItems="center">
                        <span>{browser} on {os}</span>
                        {s.current && (
                          <Chip label="this device" size="small" color="primary" sx={{ borderRadius: 2, height: 18 }} />
                        )}
                      </Stack>
                    }
                    secondary={`signed in ${new Date(s.created_at).toLocaleString()}`}
                  />
                </ListItem>
              )
            })}
            {sessions.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                No active sessions found.
              </Typography>
            )}
          </List>
        </CardContent>
      </Card>

      <Snackbar open={!!snack} autoHideDuration={4000} onClose={() => setSnack('')} message={snack} />
    </Box>
  )
}

function PasswordField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Box
      component="input"
      type="password"
      value={value}
      onChange={e => onChange((e.target as HTMLInputElement).value)}
      sx={{
        width: '100%',
        mt: 0.5,
        p: '8px 12px',
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'transparent',
        fontSize: '0.9rem',
        outline: 'none',
        fontFamily: 'inherit',
      }}
    />
  )
}