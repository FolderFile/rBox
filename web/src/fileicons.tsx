import FolderRounded from '@mui/icons-material/FolderRounded'
import FolderZipRounded from '@mui/icons-material/FolderZipRounded'
import ImageRounded from '@mui/icons-material/ImageRounded'
import MovieRounded from '@mui/icons-material/MovieRounded'
import AudiotrackRounded from '@mui/icons-material/AudiotrackRounded'
import CodeRounded from '@mui/icons-material/CodeRounded'
import DescriptionRounded from '@mui/icons-material/DescriptionRounded'
import InsertDriveFileRounded from '@mui/icons-material/InsertDriveFileRounded'
import PictureAsPdfRounded from '@mui/icons-material/PictureAsPdfRounded'
import TableChartRounded from '@mui/icons-material/TableChartRounded'
import SlideshowRounded from '@mui/icons-material/SlideshowRounded'
import ArticleRounded from '@mui/icons-material/ArticleRounded'
import NotesRounded from '@mui/icons-material/NotesRounded'
import { Box } from '@mui/material'
import { useState } from 'react'
import { Entry } from './api'
import { extOf, FOLDER_DEFAULT, FOLDER_VISUALS, isImage, kindBg, kindColor, kindOf } from './filetypes'

type IconKey =
  | 'folder' | 'archive' | 'image' | 'movie' | 'audio' | 'code' | 'doc' | 'file'
  | 'pdf' | 'sheet' | 'slides' | 'word' | 'text'

const ICONS: Record<IconKey, typeof FolderRounded> = {
  folder: FolderRounded,
  archive: FolderZipRounded,
  image: ImageRounded,
  movie: MovieRounded,
  audio: AudiotrackRounded,
  code: CodeRounded,
  doc: DescriptionRounded,
  file: InsertDriveFileRounded,
  pdf: PictureAsPdfRounded,
  sheet: TableChartRounded,
  slides: SlideshowRounded,
  word: ArticleRounded,
  text: NotesRounded,
}

const tone = (rgb: string) => ({ color: `rgb(${rgb})`, bg: `rgba(${rgb}, 0.14)` })

// document formats people recognise by color before they read the name
const BY_EXT: Record<string, { iconKey: IconKey; color: string; bg: string }> = {}
const register = (exts: string[], iconKey: IconKey, rgb: string) =>
  exts.forEach(e => (BY_EXT[e] = { iconKey, ...tone(rgb) }))
register(['pdf'], 'pdf', '229, 57, 53')
register(['csv', 'tsv', 'xls', 'xlsx', 'ods', 'numbers'], 'sheet', '22, 163, 74')
register(['ppt', 'pptx', 'odp', 'key'], 'slides', '234, 88, 12')
register(['doc', 'docx', 'odt', 'rtf', 'pages'], 'word', '37, 99, 235')
register(['txt', 'md', 'mdx', 'log', 'rst', 'org'], 'text', '100, 116, 139')

// the single source of truth for how an entry looks. the drawer, the
// explorer and the destination picker all render through this so a folder
// never wears a different icon depending on where you see it
export function getEntryVisuals(entry: { name: string; is_dir: boolean }) {
  if (entry.is_dir) {
    const v = FOLDER_VISUALS[entry.name.toLowerCase()] ?? FOLDER_DEFAULT
    return { color: v.color, bg: v.bg, iconKey: v.icon as IconKey }
  }
  const special = BY_EXT[extOf(entry.name)]
  if (special) return special
  const kind = kindOf(entry.name)
  const iconKey: IconKey =
    kind === 'archive' ? 'archive'
    : kind === 'image' ? 'image'
    : kind === 'video' ? 'movie'
    : kind === 'audio' ? 'audio'
    : kind === 'code' ? 'code'
    : kind === 'doc' ? 'doc'
    : 'file'
  return { color: kindColor[kind], bg: kindBg[kind], iconKey }
}

export function EntryIcon({ entry, size = 20 }: { entry: { name: string; is_dir: boolean }; size?: number }) {
  const v = getEntryVisuals(entry)
  const Icon = ICONS[v.iconKey] ?? InsertDriveFileRounded
  return <Icon sx={{ fontSize: size, color: v.color }} />
}

// thumbnails stream the original file, so very large images keep the icon
const THUMB_MAX_BYTES = 12 * 1024 * 1024

/**
 * every file and folder gets a distinct rounded icon inside a soft tonal
 * badge so the list is scannable at a glance. pass `thumb` (a download URL)
 * and image files show a real preview instead, falling back to the icon if
 * it fails to load.
 */
export function FileBadge({
  entry,
  size = 22,
  thumb,
  square,
}: {
  entry: Entry
  size?: number
  thumb?: string
  /** fill the parent instead of a fixed badge (grid cards) */
  square?: boolean
}) {
  const v = getEntryVisuals(entry)
  const [failed, setFailed] = useState(false)
  const showThumb = !!thumb && !failed && !entry.is_dir && isImage(entry) && entry.size <= THUMB_MAX_BYTES
  const box = square ? { width: '100%', height: '100%' } : { width: size + 14, height: size + 14 }
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...box,
        borderRadius: square ? 0 : 1,
        bgcolor: v.bg,
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      {showThumb ? (
        <Box
          component="img"
          src={thumb}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
          sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <EntryIcon entry={entry} size={size} />
      )}
    </Box>
  )
}
