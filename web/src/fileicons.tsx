import FolderRounded from '@mui/icons-material/FolderRounded'
import FolderZipRounded from '@mui/icons-material/FolderZipRounded'
import ImageRounded from '@mui/icons-material/ImageRounded'
import MovieRounded from '@mui/icons-material/MovieRounded'
import AudiotrackRounded from '@mui/icons-material/AudiotrackRounded'
import CodeRounded from '@mui/icons-material/CodeRounded'
import DescriptionRounded from '@mui/icons-material/DescriptionRounded'
import InsertDriveFileRounded from '@mui/icons-material/InsertDriveFileRounded'
import { Box } from '@mui/material'
import { Entry } from './api'
import { FOLDER_DEFAULT, FOLDER_VISUALS, kindBg, kindColor, kindOf } from './filetypes'

const ICONS = {
  folder: (c: string, s: number) => <FolderRounded sx={{ fontSize: s, color: c }} />,
  archive: (c: string, s: number) => <FolderZipRounded sx={{ fontSize: s, color: c }} />,
  image: (c: string, s: number) => <ImageRounded sx={{ fontSize: s, color: c }} />,
  movie: (c: string, s: number) => <MovieRounded sx={{ fontSize: s, color: c }} />,
  audio: (c: string, s: number) => <AudiotrackRounded sx={{ fontSize: s, color: c }} />,
  code: (c: string, s: number) => <CodeRounded sx={{ fontSize: s, color: c }} />,
  doc: (c: string, s: number) => <DescriptionRounded sx={{ fontSize: s, color: c }} />,
}

// the single source of truth for how an entry looks. the drawer, the
// explorer and the destination picker all render through this so a folder
// never wears a different icon depending on where you see it
export function getEntryVisuals(entry: { name: string; is_dir: boolean }) {
  if (entry.is_dir) {
    const v = FOLDER_VISUALS[entry.name.toLowerCase()] ?? FOLDER_DEFAULT
    return { color: v.color, bg: v.bg, iconKey: v.icon }
  }
  const kind = kindOf(entry.name)
  const iconKey =
    kind === 'archive' ? 'archive'
    : kind === 'image' ? 'image'
    : kind === 'video' ? 'movie'
    : kind === 'audio' ? 'audio'
    : kind === 'code' ? 'code'
    : kind === 'doc' ? 'doc'
    : 'file'
  return { color: kindColor[kind], bg: kindBg[kind], iconKey }
}

function renderIcon(iconKey: string, color: string, size: number): React.ReactNode {
  if (iconKey === 'file') return <InsertDriveFileRounded sx={{ fontSize: size, color }} />
  const fn = (ICONS as any)[iconKey]
  return fn ? fn(color, size) : <InsertDriveFileRounded sx={{ fontSize: size, color }} />
}

// every file and folder gets a distinct rounded icon inside a soft tonal
// badge so the list is scannable at a glance
export function FileBadge({ entry, size = 22 }: { entry: Entry; size?: number }) {
  const v = getEntryVisuals(entry)
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size + 14,
        height: size + 14,
        borderRadius: 1,
        bgcolor: v.bg,
        flexShrink: 0,
      }}
    >
      {renderIcon(v.iconKey, v.color, size)}
    </Box>
  )
}
