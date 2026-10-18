import React, { useEffect, useMemo, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { CssBaseline, ThemeProvider } from '@mui/material'
import { dark, light } from './theme'
import { AuthProvider, useAuth } from './auth'
import { UploadProvider } from './uploads'
import Login from './Login'
import Shell from './Shell'
import Files from './Files'
import Shares from './Shares'
import Users from './Users'
import Settings from './Settings'
import ShareLanding from './ShareLanding'

function Theme({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<string | null>(null)

  useEffect(() => {
    const saved = localStorage.getItem('rbox-theme')
    setMode(saved === 'dark' ? 'dark' : 'light')
  }, [])

  const toggle = () => {
    const next = mode === 'dark' ? 'light' : 'dark'
    localStorage.setItem('rbox-theme', next)
    setMode(next)
  }

  // hold render until localStorage has been read so there is no flash
  if (!mode) return null
  return (
    <ThemeToggleCtx.Provider value={{ mode, toggle }}>
      <ThemeProvider theme={mode === 'dark' ? dark : light}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ThemeToggleCtx.Provider>
  )
}

interface ThemeToggle {
  mode: string
  toggle: () => void
}
const ThemeToggleCtx = React.createContext<ThemeToggle>(null as any)
export const useThemeToggle = () => React.useContext(ThemeToggleCtx)

// the upload context must wrap the Shell itself: Shell renders the pending
// badge in the app bar, which lives outside the main content outlet
function WithUploads({ children }: { children: React.ReactNode }) {
  const { refresh } = useAuth()
  return (
    <UploadProvider
      onDone={() => {
        refresh()
        window.dispatchEvent(new Event('rbox:refresh'))
      }}
    >
      {children}
    </UploadProvider>
  )
}

function AppRoutes() {
  const { user, ready } = useAuth()
  const location = useLocation()
  // hold navigation until the session cookie has been checked: an eager
  // redirect here would strand a deep link like /shares at the root
  if (!ready) return null
  const from = (location.state as { from?: string } | null)?.from ?? '/'
  return (
    <Routes>
      <Route path="/s/:token" element={<ShareLanding />} />
      <Route path="/login" element={user ? <Navigate to={from} replace /> : <Login />} />
      <Route
        path="/"
        element={user ? (
          <WithUploads>
            <Shell />
          </WithUploads>
        ) : (
          <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />
        )}
      >
        <Route index element={<Files />} />
        <Route path="f/*" element={<Files />} />
        <Route path="settings" element={<Settings />} />
        <Route path="account" element={<Navigate to="/settings" replace />} />
        <Route path="shares" element={<Shares />} />
        <Route path="users" element={user?.is_admin ? <Users /> : <Navigate to="/" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  const tree = useMemo(
    () => (
      <BrowserRouter>
        <AuthProvider>
          <Theme>
            <AppRoutes />
          </Theme>
        </AuthProvider>
      </BrowserRouter>
    ),
    [],
  )
  return tree
}