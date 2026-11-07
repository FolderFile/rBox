export class ApiError extends Error {
  status: number
  constructor(status: number, msg: string) {
    super(msg)
    this.status = status
  }
}

// error bodies are JSON from rbox, but a reverse proxy (413/502 pages) or an
// extractor rejection can answer with HTML or plain text
function parseBody(text: string): any {
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { error: text.slice(0, 200) }
  }
}

export async function readError(res: Response): Promise<string> {
  const data = parseBody(await res.text().catch(() => ''))
  return data.error || res.statusText || `HTTP ${res.status}`
}

// a 401 from an authenticated endpoint means the session is gone; the auth
// provider listens for this and sends the user back to the login page
const NO_SESSION_CHECK = ['/api/auth/login', '/api/auth/password']

async function send(url: string, init: RequestInit): Promise<any> {
  const res = await fetch(url, { credentials: 'same-origin', ...init })
  const data = parseBody(await res.text())
  if (!res.ok) {
    if (res.status === 401 && url.startsWith('/api/') && !NO_SESSION_CHECK.some(p => url.startsWith(p)))
      window.dispatchEvent(new Event('rbox:unauthorized'))
    throw new ApiError(res.status, data.error || res.statusText || `HTTP ${res.status}`)
  }
  return data
}

function req(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<any> {
  return send(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  })
}

export const api = {
  get: (url: string, signal?: AbortSignal) => req('GET', url, undefined, signal),
  post: (url: string, body?: unknown) => req('POST', url, body),
  put: (url: string, body: unknown) => req('PUT', url, body),
  // raw text body (file content); the json helpers would quote it
  putText: (url: string, text: string) => send(url, { method: 'PUT', body: text }),
  patch: (url: string, body: unknown) => req('PATCH', url, body),
  del: (url: string) => req('DELETE', url),
}

// navigator.clipboard only exists in secure contexts; self-hosted instances
// on a plain-http LAN address need the execCommand fallback
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // fall through
  }
  try {
    const prev = document.activeElement as HTMLElement | null
    // mount inside an open dialog so its focus trap doesn't pull focus away
    const host = (prev?.closest('[role="dialog"]') as HTMLElement | null) ?? document.body
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '0'
    ta.style.opacity = '0'
    host.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    prev?.focus()
    return ok
  } catch {
    return false
  }
}

export interface Entry {
  name: string
  is_dir: boolean
  size: number
  modified: number
}

export interface User {
  username: string
  is_admin: boolean
  used_bytes: number
  quota_bytes: number
  /** server version, so the UI never shows a stale hardcoded one */
  version?: string
}

export interface ShareRow {
  id: number
  token: string
  path: string
  expires_at: number | null
  requires_password: boolean
}

export interface AdminUser {
  id: number
  username: string
  is_admin: boolean
  used_bytes: number
  quota_bytes: number
  created_at: string
}

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let v = bytes
  let u = -1
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024
    u++
  }
  // one decimal while it carries information, none once it's noise
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[u]}`
}

const DATE_TIME = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const SHORT_DAY = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const SHORT_DAY_YEAR = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
const TIME = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' })

/** full, unambiguous timestamp: inspector rows and tooltips */
export function fmtDate(ts: number | null | undefined): string {
  if (!ts) return '—'
  return DATE_TIME.format(new Date(ts * 1000))
}

/** compact, human timestamp for dense lists: "Just now", "5 min ago", "Yesterday", "Nov 3" */
export function fmtRelative(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return '—'
  const d = new Date(ts * 1000)
  const diff = (now - d.getTime()) / 1000
  if (diff < 0) {
    // future (expiry dates): "in 3 days" reads better than a raw date
    const ahead = -diff
    if (ahead < 3600) return `in ${Math.max(1, Math.round(ahead / 60))} min`
    if (ahead < 86400) return `in ${Math.round(ahead / 3600)} h`
    if (ahead < 86400 * 30) return `in ${Math.round(ahead / 86400)} days`
    return SHORT_DAY_YEAR.format(d)
  }
  if (diff < 45) return 'Just now'
  if (diff < 3600) return `${Math.max(1, Math.round(diff / 60))} min ago`
  const today = new Date(now)
  const sameDay = d.toDateString() === today.toDateString()
  if (sameDay) return `Today, ${TIME.format(d)}`
  const yesterday = new Date(now - 86400000)
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday, ${TIME.format(d)}`
  return d.getFullYear() === today.getFullYear() ? SHORT_DAY.format(d) : SHORT_DAY_YEAR.format(d)
}

/** percentage that never claims 0% for a non-empty vault or 100% before it's full */
export function fmtPercent(used: number, total: number): string {
  if (total <= 0) return '—'
  const p = (used / total) * 100
  if (used > 0 && p < 0.1) return '<0.1%'
  if (p >= 99.95 && used < total) return '>99.9%'
  return `${p < 10 ? p.toFixed(1) : Math.round(p)}%`
}

const TEXT_EXTS = [
  'txt', 'md', 'mdx', 'json', 'jsonc', 'toml', 'yaml', 'yml', 'rs', 'js', 'ts', 'tsx', 'jsx',
  'mjs', 'cjs', 'py', 'lua', 'go', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'java',
  'kt', 'swift', 'rb', 'php', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
  'html', 'htm', 'css', 'scss', 'less', 'sql', 'log', 'conf', 'ini', 'cfg',
  'env', 'dockerfile', 'gitignore', 'csv', 'xml', 'svg', 'nix', 'zig', 'vue',
  'svelte', 'astro', 'r', 'pl', 'ex', 'exs', 'erl', 'hs', 'clj', 'scala',
  'dart', 'gradle', 'diff',
]
const TEXT_NAMES = new Set(['makefile', 'dockerfile', 'cargo.lock', 'cmakelists.txt'])

export function isEditable(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return TEXT_EXTS.includes(ext) || TEXT_NAMES.has(name.toLowerCase())
}

export function joinPath(...parts: string[]): string {
  return parts.filter(p => p !== '').join('/')
}

export function parentPath(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

export function baseName(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? path : path.slice(i + 1)
}
export interface StatInfo {
  name: string
  path: string
  is_dir: boolean
  size: number
  modified: number
  mime: string
  sha256: string | null
  items: number | null
}

export interface SearchHit {
  name: string
  path: string
  is_dir: boolean
  size: number
  modified: number
}

export interface ArchiveEntryInfo {
  name: string
  is_dir: boolean
  size: number
  compressed_size: number
  encrypted: boolean
}

export interface SessionRow {
  id: number
  created_at: string
  user_agent: string
  current: boolean
}

export interface UserAgent {
  browser: string
  os: string
}

export function parseUserAgent(ua: string): UserAgent {
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari'
    : ua ? 'Unknown browser' : 'Unknown client'
  const os = /Android/i.test(ua) ? 'Android'
    : /iPhone|iPad/i.test(ua) ? 'iOS'
    : /Mac OS X/i.test(ua) ? 'macOS'
    : /Windows/i.test(ua) ? 'Windows'
    : /Linux/i.test(ua) ? 'Linux'
    : 'Unknown OS'
  return { browser, os }
}
