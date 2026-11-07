// fonts ship with the app: no third-party request, works on offline LANs
import './fonts.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { Box, Button, Card, CardContent, Stack, Typography } from '@mui/material'
import App from './App'
import { reloadOnce } from './lazy'

// a stale tab (opened before a deploy) asking for a retired chunk: reload
// once into the new build instead of crashing into the error card
window.addEventListener('vite:preloadError', e => {
  if (reloadOnce()) e.preventDefault()
})

// a crashing render must never leave a blank white page: catch it here and
// offer a recovery card instead
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ui crashed:', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    const reset = () => {
      try {
        localStorage.clear()
        sessionStorage.clear()
      } catch {
        // storage blocked: a plain reload is all we can do
      }
      location.reload()
    }
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
        <Card variant="outlined" sx={{ maxWidth: 420 }}>
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="h6">Something went wrong</Typography>
              <Typography variant="body2" color="text.secondary">
                The rbox interface hit an unexpected error. Reload the page, or reset
                local state if the problem persists.
              </Typography>
              <Typography variant="caption" sx={{ fontFamily: 'monospace', wordBreak: 'break-word' }}>
                {this.state.error.message}
              </Typography>
              <Stack direction="row" spacing={1}>
                <Button variant="contained" onClick={() => location.reload()}>Reload</Button>
                <Button variant="outlined" color="error" onClick={reset}>Reset Local State</Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      </Box>
    )
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)