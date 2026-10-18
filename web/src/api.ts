export class ApiError extends Error {
  status: number
  constructor(status: number, msg: string) {
    super(msg)
    this.status = status
  }
}

async function req(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<any> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
    signal,
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : {}
  if (!res.ok) throw new ApiError(res.status, data.error || res.statusText)
  return data
}

export const api = {
  get: (url: string, signal?: AbortSignal) => req('GET', url, undefined, signal),
  post: (url: string, body?: unknown) => req('POST', url, body),
  put: (url: string, body: unknown) => req('PUT', url, body),
  patch: (url: string, body: unknown) => req('PATCH', url, body),
  del: (url: string) => req('DELETE', url),
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
  return `${v.toFixed(1)} ${units[u]}`
}

export function fmtDate(ts: number): string {
  if (!ts) return '-'
  return new Date(ts * 1000).toLocaleString()
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
