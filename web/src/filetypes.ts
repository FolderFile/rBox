
const IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif']
const VIDEO = ['mp4', 'mkv', 'webm', 'mov', 'avi']
const AUDIO = ['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac']
const ARCHIVE = ['zip', 'tar', 'tgz', 'gz', 'zst', 'xz', '7z', 'rar']
const CODE = ['rs', 'js', 'ts', 'tsx', 'jsx', 'py', 'html', 'css', 'scss', 'json', 'toml', 'yaml', 'yml', 'sh', 'sql', 'go', 'c', 'cpp', 'h', 'xml']
const DOC = ['txt', 'md', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'rtf', 'log']

export function extOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

export type FileKind = 'image' | 'video' | 'audio' | 'archive' | 'code' | 'doc' | 'other'

export function kindOf(name: string, isDir = false): FileKind {
  if (isDir) return 'other'
  const ext = extOf(name)
  if (IMAGE.includes(ext)) return 'image'
  if (VIDEO.includes(ext)) return 'video'
  if (AUDIO.includes(ext)) return 'audio'
  if (ARCHIVE.includes(ext)) return 'archive'
  if (CODE.includes(ext)) return 'code'
  if (DOC.includes(ext)) return 'doc'
  return 'other'
}

// soft tonal badge colors per kind
export const kindColor: Record<FileKind, string> = {
  image: 'rgb(16, 185, 129)',
  video: 'rgb(244, 63, 94)',
  audio: 'rgb(6, 182, 212)',
  archive: 'rgb(167, 139, 250)',
  code: 'rgb(59, 130, 246)',
  doc: 'rgb(100, 116, 139)',
  other: 'rgb(148, 163, 184)',
}

export const kindBg: Record<FileKind, string> = {
  image: 'rgba(16, 185, 129, 0.14)',
  video: 'rgba(244, 63, 94, 0.14)',
  audio: 'rgba(6, 182, 212, 0.14)',
  archive: 'rgba(167, 139, 250, 0.14)',
  code: 'rgba(59, 130, 246, 0.14)',
  doc: 'rgba(100, 116, 139, 0.14)',
  other: 'rgba(148, 163, 184, 0.12)',
}

// real folders backing the sidebar shortcuts and the command palette
export const DEFAULT_FOLDERS = ['Images', 'Videos', 'Audio', 'Documents', 'Code', 'Archives']
