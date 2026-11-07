import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, User } from './api'

interface AuthCtx {
  user: User | null
  // false until the first /me resolved: lets the router hold off on
  // redirecting while the session cookie is still being checked
  ready: boolean
  refresh: () => Promise<void>
  logout: () => Promise<void>
}

const Ctx = createContext<AuthCtx>(null as any)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setUser(await api.get('/api/auth/me'))
    } catch (e: any) {
      // only a definite 401 ends the session; a network blip or a 5xx keeps
      // the current user (and any unsaved editor state) on screen
      if (e?.status === 401) setUser(null)
    } finally {
      setReady(true)
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout')
    } catch {
      // the local session ends either way
    }
    setUser(null)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // any authenticated request answering 401 means the session expired
  useEffect(() => {
    const onUnauthorized = () => setUser(null)
    window.addEventListener('rbox:unauthorized', onUnauthorized)
    return () => window.removeEventListener('rbox:unauthorized', onUnauthorized)
  }, [])

  const value = useMemo(() => ({ user, ready, refresh, logout }), [user, ready, refresh, logout])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useAuth = () => useContext(Ctx)
