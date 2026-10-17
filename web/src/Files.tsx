import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Alert, Box, Breadcrumbs, Button, Card, CardActionArea, CardContent, Checkbox,
  Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, IconButton, Link, Menu, MenuItem, Paper, Snackbar,
  Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography,
  useMediaQuery, useTheme,
} from '@mui/material'
import FolderOpenOutlined from '@mui/icons-material/FolderOpenOutlined'
import FolderOutlined from '@mui/icons-material/FolderOutlined'
import SearchOff from '@mui/icons-material/SearchOff'
import InsertDriveFileOutlined from '@mui/icons-material/InsertDriveFileOutlined'
import ImageOutlined from '@mui/icons-material/ImageOutlined'
import MovieOutlined from '@mui/icons-material/MovieOutlined'
import MusicNoteOutlined from '@mui/icons-material/MusicNoteOutlined'
import Code from '@mui/icons-material/Code'
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined'
import MoreVert from '@mui/icons-material/MoreVert'
import DownloadIcon from '@mui/icons-material/Download'
import ShareIcon from '@mui/icons-material/Share'
import EditOutlined from '@mui/icons-material/EditOutlined'
import DriveFileMoveOutlined from '@mui/icons-material/DriveFileMoveOutlined'
import FileCopyOutlined from '@mui/icons-material/FileCopyOutlined'
import DeleteOutline from '@mui/icons-material/DeleteOutline'
import CreateNewFolderOutlined from '@mui/icons-material/CreateNewFolderOutlined'
import NoteAddOutlined from '@mui/icons-material/NoteAddOutlined'
import UploadIcon from '@mui/icons-material/Upload'
import CloudUploadOutlined from '@mui/icons-material/CloudUploadOutlined'
import GridViewOutlined from '@mui/icons-material/GridViewOutlined'
import ViewListOutlined from '@mui/icons-material/ViewListOutlined'
import RefreshOutlined from '@mui/icons-material/RefreshOutlined'
import HomeRounded from '@mui/icons-material/HomeRounded'
import SortIcon from '@mui/icons-material/Sort'
import Close from '@mui/icons-material/Close'
import Check from '@mui/icons-material/Check'
import ArrowUpward from '@mui/icons-material/ArrowUpward'
import ArrowDownward from '@mui/icons-material/ArrowDownward'
import { api, Entry, fmtDate, fmtSize, isEditable, joinPath } from './api'
import { useUploads } from './uploads'
import { ConfirmDialog, PromptDialog, ShareDialog } from './dialogs'
import { isMedia, Lightbox } from './Lightbox'

// the codemirror grammars are a third of the frontend; load them only when
// a file is actually opened for editing
const TextEditor = lazy(() => import('./Editor'))

type View = 'table' | 'grid'
type SortBy = 'name' | 'size' | 'modified'
type SortDir = 'asc' | 'desc'

function entryIcon(e: Entry) {
  const ext = e.name.split('.').pop()?.toLowerCase() ?? ''
  if (e.is_dir) return <FolderOutlined />
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return <ImageOutlined />
  if (['mp4', 'mkv', 'webm', 'mov'].includes(ext)) return <MovieOutlined />
  if (['mp3', 'flac', 'wav', 'ogg', 'm4a'].includes(ext)) return <MusicNoteOutlined />
  if (isEditable(e.name) && ['rs', 'js', 'ts', 'tsx', 'jsx', 'py', 'css', 'html', 'sh', 'go', 'c', 'cpp', 'h', 'sql', 'json', 'toml', 'yml', 'yaml'].includes(ext))
    return <Code />
  if (['md', 'txt', 'log'].includes(ext)) return <DescriptionOutlined />
  return <InsertDriveFileOutlined />
}

const HOVER_SX = {
  transition: 'background-color 150ms ease, transform 150ms ease, box-shadow 150ms ease',
}

export default function Files() {
  const params = useParams()['*'] ?? ''
  const cwd = params.replace(/\/+$/, '')
  const nav = useNavigate()
  const upload = useUploads().upload
  const theme = useTheme()
  const narrow = useMediaQuery(theme.breakpoints.down('sm'))
  const xs = useMediaQuery(theme.breakpoints.only('xs'))

  const [entries, setEntries] = useState<Entry[]>([])
  // the directory whose contents `entries` actually are; route params can
  // move on to a new cwd while the stale snapshot is still rendered, so all
  // row actions must resolve against this, never against `cwd`
  const [listDir, setListDir] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [view, setView] = useState<View>('table')
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<{ by: SortBy; dir: SortDir }>({ by: 'name', dir: 'asc' })
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null)
  const [error, setError] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; path: string; entry: Entry } | null>(null)
  const [dialog, setDialog] =
    useState<{ kind: 'mkdir' | 'newfile' | 'rename' | 'move' | 'copy' | 'share' | 'delete'; entry: Entry } | null>(null)
  const [editor, setEditor] = useState<Entry | null>(null)
  const [mediaIdx, setMediaIdx] = useState<number | null>(null)
  const [snack, setSnack] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [staged, setStaged] = useState<File[]>([])
  const [dropOver, setDropOver] = useState(false)
  const browseInput = useRef<HTMLInputElement>(null)

  const load = useCallback(
    async (silent = false) => {
      try {
        const res = await api.get(`/api/files?path=${encodeURIComponent(cwd)}`)
        setEntries(res.entries)
        setListDir(cwd)
        setSelected(new Set())
        if (!silent) setError('')
      } catch (err: any) {
        setError(err.message)
      }
    },
    [cwd],
  )

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editor || mediaIdx !== null || dialog || menu || confirm || uploadOpen) return
      const tag = document.activeElement?.tagName.toLowerCase()
      if (tag === 'input' || tag === 'textarea') return
      if (e.key === 'Escape') {
        setSelected(new Set())
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selected.size) {
          e.preventDefault()
          confirmDelete([...selected])
        }
      } else if (e.key === 'F2' && selected.size === 1) {
        const entry = entries.find(en => en.name === [...selected][0])
        if (entry) setDialog({ kind: 'rename', entry })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // no dep list: the handler must always see fresh selection state
  })

  useEffect(() => {
    const onRefresh = () => load(true)
    const onFilter = (e: Event) => setFilter((e as CustomEvent).detail ?? '')
    window.addEventListener('rbox:refresh', onRefresh)
    window.addEventListener('rbox:filter', onFilter)
    return () => {
      window.removeEventListener('rbox:refresh', onRefresh)
      window.removeEventListener('rbox:filter', onFilter)
    }
  }, [load])

  const shown = useMemo(() => {
    const by = (a: Entry, b: Entry) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1
      let v: number
      if (sort.by === 'name') v = a.name.localeCompare(b.name)
      else v = (a.is_dir ? 0 : a[sort.by]) - (b.is_dir ? 0 : b[sort.by])
      return sort.dir === 'asc' ? v : -v
    }
    return entries
      .filter(e => e.name.toLowerCase().includes(filter.toLowerCase()))
      .sort(by)
  }, [entries, filter, sort])

  const mediaItems = useMemo(() => shown.filter(isMedia), [shown])

  // screenshots arrive as "image.png" with no real name; give them one
  const stampName = (f: File): File => {
    if (!/^image\./i.test(f.name)) return f
    const ext = f.name.split('.').pop() ?? 'png'
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
    return new File([f], `paste-${stamp}.${ext}`, { type: f.type })
  }

  useEffect(() => {
    const onPaste = (ev: ClipboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable || el.closest('.cm-editor')))
        return
      const files: File[] = []
      for (const item of Array.from(ev.clipboardData?.items ?? [])) {
        // strictly files: plain-text/HTML strings are never treated as uploads
        if (item.kind !== 'file') continue
        const f = item.getAsFile()
        if (f) files.push(stampName(f))
      }
      if (!files.length) return
      ev.preventDefault()
      if (uploadOpen) setStaged(s => [...s, ...files])
      else upload(listDir, files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [uploadOpen, listDir, upload])

  const go = (path: string) => nav(path ? `/f/${path}` : '/')

  // a double-click fires a second click after the first already navigated;
  // without the guard the second click resolves the folder against the new
  // cwd and produces folder/folder
  const lastNav = useRef<{ target: string; at: number } | null>(null)
  const openEntry = (e: Entry) => {
    if (e.is_dir) {
      const target = joinPath(listDir, e.name)
      const now = Date.now()
      if (lastNav.current && lastNav.current.target === target && now - lastNav.current.at < 600) return
      lastNav.current = { target, at: now }
      return go(target)
    }
    if (isEditable(e.name)) return setEditor(e)
    if (isMedia(e)) return setMediaIdx(Math.max(0, mediaItems.findIndex(m => m.name === e.name)))
  }

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn()
      setDialog(null)
      setMenu(null)
      setSnack(msg)
      load(true)
    } catch (err: any) {
      setSnack(err.message)
    }
  }

  const fullPath = (e: Entry) => joinPath(listDir, e.name)
  const dlUrl = (e: Entry) =>
    `/api/files/${e.is_dir ? 'zip' : 'download'}?path=${encodeURIComponent(fullPath(e))}`

  const delNames = useRef<string[] | null>(null)
  const confirmDelete = (names: string[]) => {
    delNames.current = names
    setConfirm(true)
  }
  const del = async (names: string[]) =>
    act(
      () => Promise.all(names.map(n => api.del(`/api/files?path=${encodeURIComponent(joinPath(listDir, n))}`))),
      `Deleted ${names.length} item${names.length > 1 ? 's' : ''}`,
    )

  const startUpload = () => {
    if (!staged.length) return
    upload(listDir, staged)
    setStaged([])
    setUploadOpen(false)
  }

  const createFile = (name: string) =>
    act(async () => {
      // raw empty body: the api helper would json-encode it into the file
      const res = await fetch(`/api/files/content?path=${encodeURIComponent(joinPath(listDir, name))}`, {
        method: 'PUT',
        body: '',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      setEditor({ name, is_dir: false, size: 0, modified: 0 })
    }, `Created ${name}`)

  const RowActions = ({ e }: { e: Entry }) => (
    <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
      {!xs && (
        <Tooltip title="Download">
          <IconButton size="small" component="a" href={dlUrl(e)} download>
            <DownloadIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      {!xs && (
        <Tooltip title="Share">
          <IconButton size="small" onClick={() => setDialog({ kind: 'share', entry: e })}>
            <ShareIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      <Tooltip title="More">
        <IconButton
          size="small"
          onClick={ev => setMenu({ x: ev.clientX, y: ev.clientY, path: fullPath(e), entry: e })}
        >
          <MoreVert fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  )

  const checkbox = (e: Entry) => (
    <Checkbox
      size="small"
      checked={selected.has(e.name)}
      onChange={ev => {
        const next = new Set(selected)
        if (ev.target.checked) next.add(e.name)
        else next.delete(e.name)
        setSelected(next)
      }}
      onClick={ev => ev.stopPropagation()}
    />
  )

  const sortItems: { label: string; value: SortBy }[] = [
    { label: 'Name', value: 'name' },
    { label: 'Size', value: 'size' },
    { label: 'Modified date', value: 'modified' },
  ]

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: narrow ? 0.5 : 1, flexWrap: 'wrap' }}>
        <Breadcrumbs sx={{ flex: 1, minWidth: 120 }} itemsAfterCollapse={3}>
          <Link
            underline="hover"
            sx={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}
            onClick={() => go('')}
          >
            <HomeRounded fontSize="small" />
          </Link>
          {cwd
            .split('/')
            .filter(Boolean)
            .map((part, i, parts) => (
              <Link
                key={i}
                underline="hover"
                sx={{ cursor: 'pointer' }}
                onClick={() => go(parts.slice(0, i + 1).join('/'))}
              >
                {part}
              </Link>
            ))}
        </Breadcrumbs>
        <Tooltip title={view === 'table' ? 'Grid view' : 'List view'}>
          <IconButton size="small" onClick={() => setView(v => (v === 'table' ? 'grid' : 'table'))}>
            {view === 'table' ? <GridViewOutlined fontSize="small" /> : <ViewListOutlined fontSize="small" />}
          </IconButton>
        </Tooltip>
        <Tooltip title="Sort">
          <IconButton size="small" onClick={e => setSortAnchor(e.currentTarget)}>
            <SortIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
        <Button startIcon={<UploadIcon />} variant="contained" onClick={() => setUploadOpen(true)}>
          Upload
        </Button>
        {narrow ? (
          <>
            <Tooltip title="New folder">
              <IconButton
                size="small"
                onClick={() => setDialog({ kind: 'mkdir', entry: { name: '', is_dir: true, size: 0, modified: 0 } })}
              >
                <CreateNewFolderOutlined fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="New file">
              <IconButton
                size="small"
                onClick={() => setDialog({ kind: 'newfile', entry: { name: '', is_dir: false, size: 0, modified: 0 } })}
              >
                <NoteAddOutlined fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        ) : (
          <>
            <Button
              startIcon={<CreateNewFolderOutlined />}
              variant="outlined"
              onClick={() => setDialog({ kind: 'mkdir', entry: { name: '', is_dir: true, size: 0, modified: 0 } })}
            >
              New Folder
            </Button>
            <Button
              startIcon={<NoteAddOutlined />}
              variant="outlined"
              onClick={() => setDialog({ kind: 'newfile', entry: { name: '', is_dir: false, size: 0, modified: 0 } })}
            >
              New File
            </Button>
          </>
        )}
        <Tooltip title="Refresh">
          <IconButton size="small" onClick={() => load()}>
            <RefreshOutlined fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {selected.size > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Typography variant="body2">{selected.size} selected</Typography>
          <Button color="error" startIcon={<DeleteOutline />} onClick={() => confirmDelete([...selected])}>
            Delete
          </Button>
          <Button size="small" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </Box>
      )}

      {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}

      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        {view === 'table' ? (
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox" />
                <TableCell>Name</TableCell>
                {!narrow && <TableCell align="right">Size</TableCell>}
                {!narrow && <TableCell>Modified</TableCell>}
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map(e => (
                <TableRow
                  key={e.name}
                  hover
                  selected={selected.has(e.name)}
                  sx={{ cursor: 'pointer', ...HOVER_SX }}
                  onClick={() => openEntry(e)}
                  onContextMenu={ev => {
                    ev.preventDefault()
                    setMenu({ x: ev.clientX, y: ev.clientY, path: fullPath(e), entry: e })
                  }}
                >
                  <TableCell padding="checkbox">{checkbox(e)}</TableCell>
                  <TableCell sx={{ maxWidth: narrow ? undefined : 400 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box sx={{ color: 'action.active', display: 'inline-flex' }}>{entryIcon(e)}</Box>
                      <Typography variant="body2" noWrap>{e.name}</Typography>
                    </Box>
                  </TableCell>
                  {!narrow && <TableCell align="right">{e.is_dir ? '' : fmtSize(e.size)}</TableCell>}
                  {!narrow && <TableCell>{fmtDate(e.modified)}</TableCell>}
                  <TableCell onClick={ev => ev.stopPropagation()} padding={narrow ? 'none' : 'normal'} sx={{ whiteSpace: 'nowrap' }}>
                    <RowActions e={e} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', p: 1, gap: 1 }}>
            {shown.map(e => (
              <Card
                key={e.name}
                variant="outlined"
                sx={{ ...HOVER_SX, '&:hover': { transform: 'translateY(-2px)', boxShadow: 3 } }}
                onContextMenu={ev => {
                  ev.preventDefault()
                  setMenu({ x: ev.clientX, y: ev.clientY, path: fullPath(e), entry: e })
                }}
              >
                <CardActionArea onClick={() => openEntry(e)} sx={{ ...HOVER_SX }}>
                  <CardContent sx={{ textAlign: 'center', py: 3 }}>
                    <Box sx={{ color: 'action.active', mb: 1, display: 'flex', justifyContent: 'center' }}>
                      {entryIcon(e)}
                    </Box>
                    <Typography variant="body2" noWrap>{e.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {e.is_dir ? '' : fmtSize(e.size)}
                    </Typography>
                  </CardContent>
                </CardActionArea>
              </Card>
            ))}
          </Box>
        )}
        {shown.length === 0 && (
          <Box sx={{ p: 6, textAlign: 'center', color: 'text.secondary' }}>
            {filter ? (
              <>
                <SearchOff />
                <Typography variant="body2" sx={{ mt: 1 }}>
                  Nothing matches “{filter}”
                </Typography>
              </>
            ) : (
              <>
                <FolderOpenOutlined />
                <Typography variant="body2" sx={{ mt: 1 }}>
                  This folder is empty. Drop files here to upload.
                </Typography>
              </>
            )}
          </Box>
        )}
      </Paper>

      <Menu
        open={!!menu}
        anchorReference="anchorPosition"
        anchorPosition={menu ? { top: menu.y, left: menu.x } : undefined}
        onClose={() => setMenu(null)}
      >
        {menu && menuEntries({
          entry: menu.entry,
          onDownload: () => {
            const a = document.createElement('a')
            a.href = dlUrl(menu.entry)
            a.download = menu.entry.name
            a.click()
            setMenu(null)
          },
          onAction: kind => setDialog({ kind, entry: menu.entry }),
          onDelete: () => {
            const names = [menu.entry.name]
            setMenu(null)
            confirmDelete(names)
          },
        })}
      </Menu>

      <Menu open={!!sortAnchor} anchorEl={sortAnchor} onClose={() => setSortAnchor(null)}>
        {sortItems.map(it => (
          <MenuItem
            key={it.value}
            onClick={() => setSort(s => ({ ...s, by: it.value }))}
            sx={{ gap: 1 }}
          >
            <Box sx={{ width: 20, display: 'inline-flex' }}>
              {sort.by === it.value && <Check fontSize="small" />}
            </Box>
            {it.label}
          </MenuItem>
        ))}
        <Divider />
        <MenuItem onClick={() => setSort(s => ({ ...s, dir: 'asc' }))} sx={{ gap: 1 }}>
          <Box sx={{ width: 20, display: 'inline-flex' }}>
            {sort.dir === 'asc' && <Check fontSize="small" />}
          </Box>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
            <ArrowUpward fontSize="small" /> Ascending
          </Box>
        </MenuItem>
        <MenuItem onClick={() => setSort(s => ({ ...s, dir: 'desc' }))} sx={{ gap: 1 }}>
          <Box sx={{ width: 20, display: 'inline-flex' }}>
            {sort.dir === 'desc' && <Check fontSize="small" />}
          </Box>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
            <ArrowDownward fontSize="small" /> Descending
          </Box>
        </MenuItem>
      </Menu>

      {dialog?.kind === 'mkdir' && (
        <PromptDialog
          title="New folder"
          label="Folder name"
          open
          onCancel={() => setDialog(null)}
          onSubmit={name =>
            act(() => api.post('/api/files/mkdir', { path: joinPath(listDir, name) }), `Created ${name}`)
          }
          confirmLabel="Create"
        />
      )}
      {dialog?.kind === 'newfile' && (
        <PromptDialog
          title="New file"
          label="File name (e.g. notes.md)"
          open
          onCancel={() => setDialog(null)}
          onSubmit={createFile}
          confirmLabel="Create"
        />
      )}
      {dialog?.kind === 'rename' && (
        <PromptDialog
          title="Rename"
          label={`New name for “${dialog.entry.name}”`}
          initial={dialog.entry.name}
          open
          onCancel={() => setDialog(null)}
          onSubmit={name =>
            act(
              () => api.post('/api/files/rename', { path: fullPath(dialog.entry), new_name: name }),
              'Renamed',
            )
          }
          confirmLabel="Rename"
        />
      )}
      {dialog?.kind === 'move' && (
        <PromptDialog
          title="Move"
          label={`Destination folder for “${dialog.entry.name}”`}
          initial={cwd}
          open
          onCancel={() => setDialog(null)}
          onSubmit={dest =>
            act(
              () => api.post('/api/files/move', { path: fullPath(dialog.entry), dest_dir: dest }),
              'Moved',
            )
          }
          confirmLabel="Move"
        />
      )}
      {dialog?.kind === 'copy' && (
        <PromptDialog
          title="Copy"
          label={`Destination folder for “${dialog.entry.name}”`}
          initial={cwd}
          open
          onCancel={() => setDialog(null)}
          onSubmit={dest =>
            act(
              () => api.post('/api/files/copy', { path: fullPath(dialog.entry), dest_dir: dest }),
              'Copied',
            )
          }
          confirmLabel="Copy"
        />
      )}
      <ConfirmDialog
        open={confirm}
        title="Delete"
        message={`Delete ${delNames.current?.length ?? 0} item(s) permanently?`}
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false)
          if (delNames.current) del(delNames.current)
        }}
      />
      {dialog?.kind === 'share' && (
        <ShareDialog
          open
          path={dialog.entry.name}
          onCancel={() => setDialog(null)}
          onShare={opts =>
            act(async () => {
              const res = await api.post('/api/shares', { path: fullPath(dialog.entry), ...opts })
              const url = `${location.origin}/s/${res.token}`
              await navigator.clipboard.writeText(url).catch(() => {})
              setSnack(`Link copied: ${url}`)
            }, 'Share created')
          }
        />
      )}

      <Dialog open={uploadOpen} onClose={() => { setUploadOpen(false); setStaged([]) }} maxWidth="sm" fullWidth>
        <DialogTitle>Upload to {listDir ? `/${listDir}` : 'Home'}</DialogTitle>
        <DialogContent>
          <Box
            onClick={() => browseInput.current?.click()}
            onDragOver={ev => {
              ev.preventDefault()
              setDropOver(true)
            }}
            onDragLeave={() => setDropOver(false)}
            onDrop={ev => {
              ev.preventDefault()
              setDropOver(false)
              const files = Array.from(ev.dataTransfer.files)
              if (files.length) setStaged(s => [...s, ...files])
            }}
            sx={{
              border: '2px dashed',
              borderColor: dropOver ? 'primary.main' : 'divider',
              borderRadius: 1,
              bgcolor: dropOver ? 'action.hover' : 'transparent',
              textAlign: 'center',
              py: 5,
              px: 2,
              cursor: 'pointer',
              transition: 'background-color 150ms ease, border-color 150ms ease',
            }}
          >
            <CloudUploadOutlined sx={{ fontSize: 40, color: 'action.active', mb: 1 }} />
            <Typography variant="body2">
              Drag &amp; drop files here, paste from clipboard, or click to browse
            </Typography>
          </Box>
          {staged.length > 0 && (
            <Box sx={{ mt: 2 }}>
              {staged.map((f, i) => (
                <Box key={`${f.name}-${i}`} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
                  <Typography variant="body2" noWrap sx={{ flex: 1 }}>
                    {f.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {fmtSize(f.size)}
                  </Typography>
                  <IconButton size="small" onClick={() => setStaged(s => s.filter((_, j) => j !== i))}>
                    <Close fontSize="small" />
                  </IconButton>
                </Box>
              ))}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Chip
            size="small"
            variant="outlined"
            sx={{ mr: 'auto', borderRadius: 1, display: staged.length ? 'inline-flex' : 'none' }}
            label={`${staged.length} file${staged.length > 1 ? 's' : ''} · ${fmtSize(staged.reduce((n, f) => n + f.size, 0))}`}
          />
          <Button onClick={() => { setUploadOpen(false); setStaged([]) }}>Cancel</Button>
          <Button variant="contained" disabled={!staged.length} onClick={startUpload}>
            Upload {staged.length || ''} {staged.length === 1 ? 'File' : 'Files'}
          </Button>
        </DialogActions>
      </Dialog>
      <input
        ref={browseInput}
        type="file"
        multiple
        hidden
        onChange={e => {
          if (e.target.files?.length) setStaged(s => [...s, ...Array.from(e.target.files!)])
          e.target.value = ''
        }}
      />

      {editor && (
        <Suspense
          fallback={
            <Dialog open fullScreen>
              <DialogContent sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CircularProgress />
              </DialogContent>
            </Dialog>
          }
        >
          <TextEditor
            path={fullPath(editor)}
            name={editor.name}
            onClose={() => setEditor(null)}
            onSaved={() => load(true)}
          />
        </Suspense>
      )}

      {mediaIdx !== null && (
        <Lightbox
          items={mediaItems}
          index={mediaIdx}
          urlOf={e => `/api/files/download?path=${encodeURIComponent(fullPath(e))}`}
          onClose={() => setMediaIdx(null)}
          onIndex={setMediaIdx}
          onShare={e => setDialog({ kind: 'share', entry: e })}
        />
      )}

      <Snackbar
        open={!!snack}
        autoHideDuration={4000}
        onClose={() => setSnack('')}
        message={snack}
      />
    </Box>
  )
}

function menuEntries(props: {
  entry: Entry
  onDownload: () => void
  onAction: (kind: 'rename' | 'move' | 'copy' | 'share' | 'delete') => void
  onDelete: () => void
}) {
  const { entry, onDownload, onAction, onDelete } = props
  const items = [
    { label: entry.is_dir ? 'Download (.zip)' : 'Download', icon: <DownloadIcon fontSize="small" />, onClick: onDownload },
    { label: 'Share…', icon: <ShareIcon fontSize="small" />, onClick: () => onAction('share') },
    { label: 'Rename…', icon: <EditOutlined fontSize="small" />, onClick: () => onAction('rename') },
    { label: 'Move…', icon: <DriveFileMoveOutlined fontSize="small" />, onClick: () => onAction('move') },
    { label: 'Copy…', icon: <FileCopyOutlined fontSize="small" />, onClick: () => onAction('copy') },
    { label: 'Delete', icon: <DeleteOutline fontSize="small" />, onClick: onDelete },
  ]
  return items.map((it, i) => (
    <MenuItem key={i} onClick={it.onClick} sx={{ gap: 1, display: 'flex', alignItems: 'center' }}>
      <Box sx={{ display: 'inline-flex', alignItems: 'center' }}>{it.icon}</Box>
      {it.label}
    </MenuItem>
  ))
}