import { useEffect, useRef, useState } from 'react'
import {
  Box, CircularProgress, Dialog, DialogContent, InputBase, ListItemButton,
  ListItemIcon, ListItemText, Typography, keyframes,
} from '@mui/material'
import SearchRounded from '@mui/icons-material/SearchRounded'
import FolderRounded from '@mui/icons-material/FolderRounded'
import InsertDriveFileRounded from '@mui/icons-material/InsertDriveFileRounded'
import { api, fmtSize, SearchHit } from './api'

const pop = keyframes`
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
`

// Ctrl+K palette: recursive vault search plus folder shortcuts; hitting a
// result navigates straight to its folder with the file preselected
export function CommandPalette({
  open,
  onClose,
  onOpenPath,
}: {
  open: boolean
  onClose: () => void
  onOpenPath: (path: string, isDir: boolean) => void
}) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [active, setActive] = useState(0)
  const timer = useRef<number>(0)

  useEffect(() => {
    if (!open) {
      setQ('')
      setHits(null)
      setActive(0)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    window.clearTimeout(timer.current)
    if (!q.trim()) {
      setHits(null)
      return
    }
    timer.current = window.setTimeout(async () => {
      try {
        const res = await api.get(`/api/files/search?q=${encodeURIComponent(q.trim())}`)
        setHits(res.results.slice(0, 12))
        setActive(0)
      } catch {
        setHits([])
      }
    }, 180)
    return () => window.clearTimeout(timer.current)
  }, [q, open])

  const pick = (hit: SearchHit) => {
    onClose()
    onOpenPath(hit.path, hit.is_dir)
  }

  const folders = ['Images', 'Videos', 'Audio', 'Documents', 'Code', 'Archives']

  const onKey = (e: React.KeyboardEvent) => {
    if (!hits?.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(i => (i + 1) % hits.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(i => (i - 1 + hits.length) % hits.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      pick(hits[active])
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth slotProps={{ paper: { sx: { position: 'absolute', top: '12%' } } }}>
      <DialogContent sx={{ p: 0 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            px: 2,
            py: 1.5,
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <SearchRounded sx={{ color: 'text.secondary' }} />
          <InputBase
            autoFocus
            fullWidth
            placeholder="Search files or type a command..."
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={onKey}
            sx={{ fontSize: '0.95rem' }}
          />
          {hits === null && q.trim() && <CircularProgress size={18} />}
        </Box>
        <Box sx={{ maxHeight: 420, overflowY: 'auto', animation: `${pop} 150ms cubic-bezier(0.2, 0, 0, 1)` }}>
          {hits?.map((hit, i) => (
            <ListItemButton
              key={hit.path}
              selected={i === active}
              onClick={() => pick(hit)}
            >
              <ListItemIcon sx={{ minWidth: 36 }}>
                {hit.is_dir ? <FolderRounded /> : <InsertDriveFileRounded />}
              </ListItemIcon>
              <ListItemText
                primary={hit.name}
                secondary={hit.path}
                slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }}
              />
              <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
                {hit.is_dir ? 'Folder' : fmtSize(hit.size)}
              </Typography>
            </ListItemButton>
          ))}
          {hits?.length === 0 && q.trim() && (
            <Typography variant="body2" color="text.secondary" sx={{ px: 3, py: 3 }}>
              Nothing in your vault matches "{q}".
            </Typography>
          )}
          {hits === null && (
            <Box sx={{ p: 1 }}>
              <Typography variant="caption" color="text.secondary" sx={{ px: 2, display: 'block', py: 1 }}>
                Folders
              </Typography>
              {folders.map(f => (
                <ListItemButton
                  key={f}
                  onClick={() => {
                    onClose()
                    onOpenPath(f, true)
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <FolderRounded />
                  </ListItemIcon>
                  <ListItemText primary={f} />
                </ListItemButton>
              ))}
              <Typography variant="caption" color="text.secondary" sx={{ px: 2, display: 'block', pt: 1 }}>
                Press Enter to open the highlighted result. Use arrow keys to move.
              </Typography>
            </Box>
          )}
        </Box>
      </DialogContent>
    </Dialog>
  )
}