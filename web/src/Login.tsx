import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material'
import { api } from './api'
import { useAuth } from './auth'

export default function Login() {
  const { refresh } = useAuth()
  const nav = useNavigate()
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
      nav('/')
    } catch (err: any) {
      setError(err.status === 401 ? 'invalid username or password' : err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
      <Paper sx={{ p: 4, width: 320 }}>
        <Stack spacing={2} component="form" onSubmit={submit}>
          <Typography variant="h5" gutterBottom>rbox</Typography>
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
          <Button type="submit" variant="contained" disabled={busy} fullWidth>
            Sign in
          </Button>
        </Stack>
      </Paper>
    </Box>
  )
}