// device-local preferences. kept out of Settings.tsx so the explorer and the
// editor can read them without pulling the settings page into their chunk
export const PREFS = {
  view: 'rbox-view',
  fontSize: 'rbox-editor-fontsize',
  wrap: 'rbox-editor-wrap',
  lineNumbers: 'rbox-editor-linenums',
  theme: 'rbox-theme',
}

// storage can throw (private mode, blocked site data); never let that crash
export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // preference simply won't persist
  }
}
