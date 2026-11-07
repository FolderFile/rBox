import { lazy, type ComponentType } from 'react'

const RELOAD_KEY = 'rbox-chunk-reload'

// after a deploy, a tab opened earlier asks for hashed chunks that no longer
// exist (the server answers 404 on purpose). reload once to pick up the new
// build; the session flag stops a reload loop if the chunk is truly broken
export function reloadOnce(): boolean {
  try {
    if (sessionStorage.getItem(RELOAD_KEY)) return false
    sessionStorage.setItem(RELOAD_KEY, '1')
  } catch {
    return false
  }
  location.reload()
  return true
}

function clearReloadFlag() {
  try {
    sessionStorage.removeItem(RELOAD_KEY)
  } catch {
    // ignore
  }
}

export function lazyWithReload<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(() =>
    load().then(
      m => {
        clearReloadFlag()
        return m
      },
      err => {
        // never resolves: the page is about to reload
        if (reloadOnce()) return new Promise<{ default: T }>(() => {})
        throw err
      },
    ),
  )
}
