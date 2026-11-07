import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { CssBaseline, ThemeProvider } from '@mui/material'
import { dark, light, SURFACE } from './theme'
import { PREFS, readPref, writePref } from './prefs'

export type ThemeMode = 'light' | 'dark'
export type ThemePref = ThemeMode | 'system'

interface ThemeToggle {
  /** the palette actually in use */
  mode: ThemeMode
  /** what the user picked; 'system' follows the OS setting live */
  pref: ThemePref
  setPref: (p: ThemePref) => void
  toggle: () => void
}

const ThemeToggleCtx = createContext<ThemeToggle>({
  mode: 'light',
  pref: 'system',
  setPref: () => {},
  toggle: () => {},
})
export const useThemeToggle = () => useContext(ThemeToggleCtx)

const query = () =>
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null

function readStoredPref(): ThemePref {
  const v = readPref(PREFS.theme)
  return v === 'light' || v === 'dark' ? v : 'system'
}

export function ThemeModeProvider({ children }: { children: React.ReactNode }) {
  // read synchronously so the first paint already has the right palette
  const [pref, setPrefState] = useState<ThemePref>(readStoredPref)
  const [systemDark, setSystemDark] = useState(() => query()?.matches ?? false)

  useEffect(() => {
    const mq = query()
    if (!mq) return
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const mode: ThemeMode = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref

  // native controls (scrollbars, date pickers) and the mobile browser chrome
  // follow the app palette, not just the OS
  useEffect(() => {
    document.documentElement.style.colorScheme = mode
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    if (!meta) {
      meta = document.createElement('meta')
      meta.name = 'theme-color'
      document.head.appendChild(meta)
    }
    meta.content = SURFACE[mode].bar
  }, [mode])

  const value = useMemo<ThemeToggle>(() => {
    const setPref = (p: ThemePref) => {
      writePref(PREFS.theme, p)
      setPrefState(p)
    }
    return { mode, pref, setPref, toggle: () => setPref(mode === 'dark' ? 'light' : 'dark') }
  }, [mode, pref])

  return (
    <ThemeToggleCtx.Provider value={value}>
      <ThemeProvider theme={mode === 'dark' ? dark : light}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ThemeToggleCtx.Provider>
  )
}
