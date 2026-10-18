import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material'
import { api } from './api'
import { useAuth } from './auth'
import { Wordmark } from './Shell'

export default function Login() {
  const { refresh } = useAuth()
  const nav = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.post('/api/auth/login', { username, password })
      await refresh()
      const from = (location.state as { from?: string } | null)?.from ?? '/'
      nav(from)
    } catch (err: any) {
      setError(err.status === 401 ? 'invalid username or password' : err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
      <Paper sx={{ p: 4, width: 340 }}>
        <Stack spacing={2.5} component="form" onSubmit={submit}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            <Wordmark size={28} />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Sign in to your vault.
            </Typography>
          </Box>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            autoFocus
            fullWidth
          />
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            fullWidth
          />
          <Button type="submit" variant="contained" disabled={busy} fullWidth sx={{ py: 1 }}>
            Sign in
          </Button>
        </Stack>
      </Paper>
    </Box>
  )
}
