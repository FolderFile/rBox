import { createContext, useCallback, useContext, useEffect, useState } from 'react'
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
    } catch {
      setUser(null)
    } finally {
      setReady(true)
    }
  }, [])

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout')
    setUser(null)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return <Ctx.Provider value={{ user, ready, refresh, logout }}>{children}</Ctx.Provider>
}

export const useAuth = () => useContext(Ctx)
