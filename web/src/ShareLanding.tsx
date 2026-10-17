import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Alert, Box, Button, Paper, Stack, TextField, Typography,
} from '@mui/material'
import { api, fmtSize } from './api'

interface ShareInfo {
  name: string
  is_dir: boolean
  size: number
  requires_password: boolean
}

export default function ShareLanding() {
  const { token } = useParams()
  const nav = useNavigate()
  const [info, setInfo] = useState<ShareInfo | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [unauthorized, setUnauthorized] = useState(false)

  useEffect(() => {
    api
      .get(`/s/${token}/info`)
      .then(setInfo)
      .catch(e => setError(e.message))
  }, [token])

  if (error) {
    return (
      <Center>
        <Paper sx={{ p: 4, width: 360 }}>
          <Alert severity="error">{error}</Alert>
          <Button sx={{ mt: 2 }} onClick={() => nav('/')}>Go to rbox</Button>
        </Paper>
      </Center>
    )
  }

  const download = async () => {
    if (!info) return
    const qs = info.requires_password ? `?password=${encodeURIComponent(password)}` : ''
    const res = await fetch(`/s/${token}/download${qs}`, { method: 'HEAD' })
    if (res.status === 401) return setUnauthorized(true)
    window.location.href = `/s/${token}/download${qs}`
  }

  return (
    <Center>
      <Paper sx={{ p: 4, width: 360 }}>
        <Stack spacing={2}>
          <Typography variant="h6" noWrap title={info?.name}>
            {info?.name ?? 'Loading…'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {info ? (info.is_dir ? `Folder · ${fmtSize(info.size)}` : fmtSize(info.size)) : ''}
          </Typography>
          {info?.requires_password && (
            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              error={unauthorized}
              helperText={unauthorized ? 'wrong or missing password' : ''}
              fullWidth
            />
          )}
          <Button variant="contained" disabled={!info || (info.requires_password && !password)} onClick={download}>
            Download
          </Button>
        </Stack>
      </Paper>
    </Center>
  )
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
      {children}
    </Box>
  )
}