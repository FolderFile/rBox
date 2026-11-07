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

// what the in-browser lightbox can actually play; lives here (not in
// Lightbox.tsx) so the explorer can decide without loading the viewer chunk
export const PREVIEW_IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']
export const PREVIEW_VIDEO = ['mp4', 'webm', 'mov']
export const PREVIEW_AUDIO = ['mp3', 'flac', 'wav', 'ogg', 'm4a']

export function isImage(e: { name: string }): boolean {
  return PREVIEW_IMAGE.includes(extOf(e.name))
}

export function isMedia(e: { name: string }): boolean {
  const ext = extOf(e.name)
  return PREVIEW_IMAGE.includes(ext) || PREVIEW_VIDEO.includes(ext) || PREVIEW_AUDIO.includes(ext)
}

// exactly the formats the backend can list and extract (archive.rs
// open_format); a bare .gz/.7z is a plain download, not a viewer
const ARCHIVE_RE = /\.(zip|tar|tgz|tar\.gz|tar\.zst|tar\.xz)$/i

export function isArchiveName(name: string): boolean {
  return ARCHIVE_RE.test(name)
}

export function stripArchiveExt(name: string): string {
  return name.replace(ARCHIVE_RE, '')
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

const KIND_NAMES: Record<string, string> = {
  pdf: 'PDF document', csv: 'CSV spreadsheet', tsv: 'TSV spreadsheet', xls: 'Excel spreadsheet',
  xlsx: 'Excel spreadsheet', ods: 'Spreadsheet', ppt: 'PowerPoint deck', pptx: 'PowerPoint deck',
  odp: 'Presentation', doc: 'Word document', docx: 'Word document', odt: 'Document',
  rtf: 'Rich text', txt: 'Plain text', md: 'Markdown', mdx: 'MDX', log: 'Log file',
  json: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML', rs: 'Rust source', ts: 'TypeScript',
  tsx: 'TypeScript JSX', js: 'JavaScript', jsx: 'JavaScript JSX', py: 'Python source',
  go: 'Go source', sh: 'Shell script', html: 'HTML', css: 'Stylesheet', sql: 'SQL',
  zip: 'ZIP archive', tar: 'Tar archive', gz: 'Gzip archive', tgz: 'Tar archive',
  zst: 'Zstd archive', xz: 'XZ archive', '7z': '7-Zip archive', rar: 'RAR archive',
}

/** "PDF document", "PNG image", "Folder": the Kind column on wide screens */
export function kindLabel(e: { name: string; is_dir: boolean }): string {
  if (e.is_dir) return 'Folder'
  const ext = extOf(e.name)
  if (!e.name.includes('.') || !ext) return 'File'
  if (KIND_NAMES[ext]) return KIND_NAMES[ext]
  const kind = kindOf(e.name)
  const noun = kind === 'image' ? 'image' : kind === 'video' ? 'video' : kind === 'audio' ? 'audio'
    : kind === 'code' ? 'source' : 'file'
  return `${ext.toUpperCase()} ${noun}`
}

