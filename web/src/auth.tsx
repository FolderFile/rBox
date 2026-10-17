import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api, User } from './api'

interface AuthCtx {
  user: User | null
  refresh: () => Promise<void>
  logout: () => Promise<void>
}

const Ctx = createContext<AuthCtx>(null as any)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)

  const refresh = useCallback(async () => {
    try {
      setUser(await api.get('/api/auth/me'))
    } catch {
      setUser(null)
    }
  }, [])

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout')
    setUser(null)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return <Ctx.Provider value={{ user, refresh, logout }}>{children}</Ctx.Provider>
}

export const useAuth = () => useContext(Ctx)