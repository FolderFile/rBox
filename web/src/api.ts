export class ApiError extends Error {
  status: number
  constructor(status: number, msg: string) {
    super(msg)
    this.status = status
  }
}

async function req(method: string, url: string, body?: unknown): Promise<any> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : {}
  if (!res.ok) throw new ApiError(res.status, data.error || res.statusText)
  return data
}

export const api = {
  get: (url: string) => req('GET', url),
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
  'txt', 'md', 'json', 'toml', 'yaml', 'yml', 'rs', 'js', 'ts', 'tsx', 'jsx',
  'py', 'html', 'css', 'scss', 'sh', 'bash', 'go', 'c', 'h', 'cpp', 'sql',
  'log', 'conf', 'ini', 'csv', 'xml',
]

export function isEditable(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return TEXT_EXTS.includes(ext)
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