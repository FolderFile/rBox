// one registry for the whole app: file-kind colors, folder visuals and the
// editable/code extensions. anything touching an Entry icon goes through
// getEntryVisuals so the sidebar and explorer can never disagree

const IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif']
const VIDEO = ['mp4', 'mkv', 'webm', 'mov', 'avi']
const AUDIO = ['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac']
const ARCHIVE = ['zip', 'tar', 'tgz', 'gz', 'zst', 'xz', '7z', 'rar']
const CODE = [
  'rs', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'lua', 'go', 'c', 'h',
  'cpp', 'hpp', 'cc', 'cs', 'java', 'kt', 'swift', 'rb', 'php', 'sh', 'bash',
  'zsh', 'fish', 'ps1', 'bat', 'cmd', 'toml', 'yaml', 'yml', 'json', 'jsonc',
  'xml', 'html', 'htm', 'css', 'scss', 'less', 'sql', 'md', 'mdx', 'ini',
  'conf', 'cfg', 'env', 'dockerfile', 'gitignore', 'nix', 'zig', 'vue',
  'svelte', 'astro', 'r', 'pl', 'ex', 'exs', 'erl', 'hs', 'clj', 'scala',
  'dart', 'gradle', 'vue', 'diff', 'mk', 'makefile',
]
const DOC = ['txt', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'rtf', 'log']

// well-known basename files with no extension still resolve as code
const CODE_NAMES = new Set([
  'makefile', 'dockerfile', 'cargo.lock', 'go.mod', 'go.sum', 'cmakelists.txt',
  '.gitignore', '.env', '.bashrc', '.zshrc', 'readme',
])

export function extOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

export type FileKind = 'image' | 'video' | 'audio' | 'archive' | 'code' | 'doc' | 'other'

export function kindOf(name: string, isDir = false): FileKind {
  if (isDir) return 'other'
  const lower = name.toLowerCase()
  const ext = extOf(name)
  if (IMAGE.includes(ext)) return 'image'
  if (VIDEO.includes(ext)) return 'video'
  if (AUDIO.includes(ext)) return 'audio'
  if (ARCHIVE.includes(ext)) return 'archive'
  if (CODE.includes(ext) || CODE_NAMES.has(lower)) return 'code'
  if (DOC.includes(ext)) return 'doc'
  return 'other'
}

// editable = anything we can open in the text/code editor
const TEXT_EXTS = new Set([...CODE, ...DOC, 'md'])

export function isEditable(name: string): boolean {
  const ext = extOf(name)
  return TEXT_EXTS.has(ext) || CODE_NAMES.has(name.toLowerCase())
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

// named-folder visuals: the same mapping drives the drawer and the explorer
// badges so a folder always looks identical in both places
export const FOLDER_VISUALS: Record<string, { color: string; bg: string; icon: string }> = {
  images: { color: kindColor.image, bg: kindBg.image, icon: 'image' },
  pictures: { color: kindColor.image, bg: kindBg.image, icon: 'image' },
  photos: { color: kindColor.image, bg: kindBg.image, icon: 'image' },
  videos: { color: kindColor.video, bg: kindBg.video, icon: 'movie' },
  movies: { color: kindColor.video, bg: kindBg.video, icon: 'movie' },
  audio: { color: kindColor.audio, bg: kindBg.audio, icon: 'audio' },
  music: { color: kindColor.audio, bg: kindBg.audio, icon: 'audio' },
  documents: { color: kindColor.doc, bg: kindBg.doc, icon: 'doc' },
  docs: { color: kindColor.doc, bg: kindBg.doc, icon: 'doc' },
  code: { color: kindColor.code, bg: kindBg.code, icon: 'code' },
  src: { color: kindColor.code, bg: kindBg.code, icon: 'code' },
  projects: { color: kindColor.code, bg: kindBg.code, icon: 'code' },
  archives: { color: kindColor.archive, bg: kindBg.archive, icon: 'archive' },
  backups: { color: kindColor.archive, bg: kindBg.archive, icon: 'archive' },
}

export const FOLDER_DEFAULT = { color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.14)', icon: 'folder' }
