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
import { kindBg, kindColor, kindOf } from './filetypes'

// every file type gets a distinct rounded icon inside a soft tonal badge so
// the list is scannable at a glance
export function FileBadge({ entry, size = 22 }: { entry: Entry; size?: number }) {
  const kind = kindOf(entry.name, entry.is_dir)
  const icon = entry.is_dir ? <FolderRounded sx={{ fontSize: size, color: '#f59e0b' }} />
    : kind === 'archive' ? <FolderZipRounded sx={{ fontSize: size, color: kindColor[kind] }} />
    : kind === 'image' ? <ImageRounded sx={{ fontSize: size, color: kindColor[kind] }} />
    : kind === 'video' ? <MovieRounded sx={{ fontSize: size, color: kindColor[kind] }} />
    : kind === 'audio' ? <AudiotrackRounded sx={{ fontSize: size, color: kindColor[kind] }} />
    : kind === 'code' ? <CodeRounded sx={{ fontSize: size, color: kindColor[kind] }} />
    : kind === 'doc' ? <DescriptionRounded sx={{ fontSize: size, color: kindColor[kind] }} />
    : <InsertDriveFileRounded sx={{ fontSize: size, color: kindColor[kind] }} />

  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size + 14,
        height: size + 14,
        borderRadius: '30%',
        bgcolor: entry.is_dir ? 'rgba(245, 158, 11, 0.14)' : kindBg[kind],
        flexShrink: 0,
      }}
    >
      {icon}
    </Box>
  )
}