import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Alert, Box, Button, CircularProgress, IconButton, InputAdornment, Paper, Stack, TextField, Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import Visibility from '@mui/icons-material/VisibilityRounded'
import VisibilityOff from '@mui/icons-material/VisibilityOffRounded'
import { api } from './api'
import { useAuth } from './auth'
import { Wordmark } from './Wordmark'

export default function Login() {
  const { refresh } = useAuth()
  const nav = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) {
      setError('Enter your username and password.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await api.post('/api/auth/login', { username: username.trim(), password })
      await refresh()
      const from = (location.state as { from?: string } | null)?.from ?? '/'
      nav(from)
    } catch (err: any) {
      setError(
        err.status === 401 ? 'Wrong username or password.'
        : err.status === 429 ? 'Too many attempts. Wait a minute, then try again.'
        : err.message || 'Could not reach the server.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box
      sx={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2,
        // a faint brand glow so the page isn't a flat void
        background: t =>
          `radial-gradient(900px 480px at 50% -10%, ${alpha(t.palette.primary.main, t.palette.mode === 'dark' ? 0.14 : 0.08)}, transparent 70%), ${t.palette.background.default}`,
      }}
    >
      <Box sx={{ width: '100%', maxWidth: 360 }}>
        <Paper sx={{ p: { xs: 3, sm: 4 }, border: '1px solid', borderColor: 'divider', boxShadow: t => t.palette.mode === 'dark' ? 'none' : '0 24px 60px rgba(15,23,42,0.08)' }}>
          <Stack spacing={2.25} component="form" onSubmit={submit} noValidate>
            <Box>
              <Wordmark size={28} />
              <Typography component="h1" variant="h6" sx={{ mt: 2.5, fontSize: '1.125rem' }}>
                Welcome back
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Sign in to your vault.
              </Typography>
            </Box>
            {error && <Alert severity="error" role="alert">{error}</Alert>}
            <TextField
              label="Username"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoFocus
              fullWidth
            />
            <TextField
              label="Password"
              name="password"
              autoComplete="current-password"
              type={show ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              fullWidth
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        size="small"
                        edge="end"
                        aria-label={show ? 'Hide password' : 'Show password'}
                        onClick={() => setShow(v => !v)}
                      >
                        {show ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />
            <Button
              type="submit"
              variant="contained"
              disabled={busy}
              fullWidth
              sx={{ py: 1 }}
              startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </Stack>
        </Paper>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ textAlign: 'center', mt: 2 }}>
          Self-hosted file vault · ask your administrator for an account
        </Typography>
      </Box>
    </Box>
  )
}
