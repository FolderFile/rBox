import React, { Suspense, useCallback, useMemo } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth'
import { UploadProvider } from './uploads'
import { ThemeModeProvider } from './theme-ctx'
import { lazyWithReload } from './lazy'
import Login from './Login'
import Shell from './Shell'
import Files from './Files'

// everything off the explorer's critical path ships as its own chunk
const Shares = lazyWithReload(() => import('./Shares'))
const Users = lazyWithReload(() => import('./Users'))
const Settings = lazyWithReload(() => import('./Settings'))
const ShareLanding = lazyWithReload(() => import('./ShareLanding'))

// the upload context must wrap the Shell itself: Shell renders the pending
// badge in the app bar, which lives outside the main content outlet
function WithUploads({ children }: { children: React.ReactNode }) {
  const { refresh } = useAuth()
  const onDone = useCallback(() => {
    refresh()
    window.dispatchEvent(new Event('rbox:refresh'))
  }, [refresh])
  return <UploadProvider onDone={onDone}>{children}</UploadProvider>
}

function AppRoutes() {
  const { user, ready } = useAuth()
  const location = useLocation()
  // public share pages never depend on the visitor's session, so they render
  // without waiting for the /me check
  if (location.pathname.startsWith('/s/')) {
    return (
      <Suspense fallback={null}>
        <Routes>
          <Route path="/s/:token" element={<ShareLanding />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    )
  }
  // hold navigation until the session cookie has been checked: an eager
  // redirect here would strand a deep link like /shares at the root
  if (!ready) return null
  const from = (location.state as { from?: string } | null)?.from ?? '/'
  return (
    <Routes>
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
          <ThemeModeProvider>
            <AppRoutes />
          </ThemeModeProvider>
        </AuthProvider>
      </BrowserRouter>
    ),
    [],
  )
  return tree
}
