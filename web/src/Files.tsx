import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Alert, Box, Breadcrumbs, Button, Card, CardActionArea, CardContent, Checkbox,
  Dialog, DialogContent, IconButton, Link, Menu, MenuItem, Paper, Snackbar,
  Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography,
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
import UploadIcon from '@mui/icons-material/Upload'
import GridViewOutlined from '@mui/icons-material/GridViewOutlined'
import ViewListOutlined from '@mui/icons-material/ViewListOutlined'
import RefreshOutlined from '@mui/icons-material/RefreshOutlined'
import { api, Entry, fmtDate, fmtSize, isEditable, joinPath } from './api'
import { useUploads } from './uploads'
import { ConfirmDialog, PromptDialog, ShareDialog } from './dialogs'
import { TextEditor } from './Editor'

type View = 'table' | 'grid'

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

function isMedia(e: Entry) {
  const ext = e.name.split('.').pop()?.toLowerCase() ?? ''
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'mp4', 'webm', 'mov', 'mp3', 'flac', 'wav', 'ogg', 'm4a'].includes(ext)
}

export default function Files() {
  const params = useParams()['*'] ?? ''
  const cwd = params.replace(/\/+$/, '')
  const nav = useNavigate()
  const { upload } = useUploads()

  const [entries, setEntries] = useState<Entry[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [view, setView] = useState<View>('table')
  const [filter, setFilter] = useState('')
  const [error, setError] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; path: string; entry: Entry } | null>(null)
  const [dialog, setDialog] =
    useState<{ kind: 'mkdir' | 'rename' | 'move' | 'copy' | 'share' | 'delete'; entry: Entry } | null>(null)
  const [editor, setEditor] = useState<Entry | null>(null)
  const [media, setMedia] = useState<Entry | null>(null)
  const [snack, setSnack] = useState('')
  const [confirm, setConfirm] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const load = useCallback(
    async (silent = false) => {
      try {
        const res = await api.get(`/api/files?path=${encodeURIComponent(cwd)}`)
        setEntries(res.entries)
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
      if (editor || media || dialog || menu || confirm) return
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

  const shown = useMemo(
    () => entries.filter(e => e.name.toLowerCase().includes(filter.toLowerCase())),
    [entries, filter],
  )

  const go = (path: string) => nav(path ? `/f/${path}` : '/')

  const openEntry = (e: Entry) => {
    if (e.is_dir) return go(joinPath(cwd, e.name))
    if (isEditable(e.name)) return setEditor(e)
    if (isMedia(e)) return setMedia(e)
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

  const fullPath = (e: Entry) => joinPath(cwd, e.name)
  const dlUrl = (e: Entry) =>
    `/api/files/${e.is_dir ? 'zip' : 'download'}?path=${encodeURIComponent(fullPath(e))}`

  const delNames = useRef<string[] | null>(null)
  const confirmDelete = (names: string[]) => {
    delNames.current = names
    setConfirm(true)
  }
  const del = async (names: string[]) =>
    act(
      () => Promise.all(names.map(n => api.del(`/api/files?path=${encodeURIComponent(joinPath(cwd, n))}`))),
      `Deleted ${names.length} item${names.length > 1 ? 's' : ''}`,
    )

  const RowActions = ({ e }: { e: Entry }) => (
    <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
      <Tooltip title="Download">
        <IconButton size="small" component="a" href={dlUrl(e)} download>
          <DownloadIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title="Share">
        <IconButton size="small" onClick={() => setDialog({ kind: 'share', entry: e })}>
          <ShareIcon fontSize="small" />
        </IconButton>
      </Tooltip>
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

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
        <Breadcrumbs sx={{ flex: 1, minWidth: 120 }} itemsAfterCollapse={3}>
          <Link underline="hover" sx={{ cursor: 'pointer' }} onClick={() => go('')}>
            Home
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
        <Button startIcon={<UploadIcon />} variant="contained" onClick={() => fileInput.current?.click()}>
          Upload
        </Button>
        <Button
          startIcon={<CreateNewFolderOutlined />}
          variant="outlined"
          onClick={() => setDialog({ kind: 'mkdir', entry: { name: '', is_dir: true, size: 0, modified: 0 } })}
        >
          New Folder
        </Button>
        <Tooltip title="Refresh">
          <IconButton size="small" onClick={() => load()}>
            <RefreshOutlined fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={view === 'table' ? 'Grid view' : 'List view'}>
          <IconButton size="small" onClick={() => setView(v => (v === 'table' ? 'grid' : 'table'))}>
            {view === 'table' ? <GridViewOutlined fontSize="small" /> : <ViewListOutlined fontSize="small" />}
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

      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={e => {
          if (e.target.files?.length) upload(cwd, Array.from(e.target.files))
          e.target.value = ''
        }}
      />

      {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}

      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        {view === 'table' ? (
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox" />
                <TableCell>Name</TableCell>
                <TableCell align="right">Size</TableCell>
                <TableCell>Modified</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map(e => (
                <TableRow
                  key={e.name}
                  hover
                  selected={selected.has(e.name)}
                  sx={{ cursor: 'pointer' }}
                  onClick={() => openEntry(e)}
                  onContextMenu={ev => {
                    ev.preventDefault()
                    setMenu({ x: ev.clientX, y: ev.clientY, path: fullPath(e), entry: e })
                  }}
                >
                  <TableCell padding="checkbox">{checkbox(e)}</TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box sx={{ color: 'action.active' }}>{entryIcon(e)}</Box>
                      <Typography variant="body2" noWrap>{e.name}</Typography>
                    </Box>
                  </TableCell>
                  <TableCell align="right">{e.is_dir ? '-' : fmtSize(e.size)}</TableCell>
                  <TableCell>{fmtDate(e.modified)}</TableCell>
                  <TableCell onClick={ev => ev.stopPropagation()}>
                    <RowActions e={e} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(140px, 1fr))`, p: 1, gap: 1 }}>
            {shown.map(e => (
              <Card
                key={e.name}
                variant="outlined"
                onContextMenu={ev => {
                  ev.preventDefault()
                  setMenu({ x: ev.clientX, y: ev.clientY, path: fullPath(e), entry: e })
                }}
              >
                <CardActionArea onClick={() => openEntry(e)}>
                  <CardContent sx={{ textAlign: 'center', py: 3 }}>
                    <Box sx={{ color: 'action.active', mb: 1, display: 'flex', justifyContent: 'center' }}>
                      {entryIcon(e)}
                    </Box>
                    <Typography variant="body2" noWrap>{e.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {e.is_dir ? 'Folder' : fmtSize(e.size)}
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

      {dialog?.kind === 'mkdir' && (
        <PromptDialog
          title="New folder"
          label="Folder name"
          open
          onCancel={() => setDialog(null)}
          onSubmit={name =>
            act(() => api.post('/api/files/mkdir', { path: joinPath(cwd, name) }), `Created ${name}`)
          }
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

      {editor && (
        <TextEditor
          path={fullPath(editor)}
          name={editor.name}
          onClose={() => setEditor(null)}
          onSaved={() => load(true)}
        />
      )}

      <Dialog open={!!media} onClose={() => setMedia(null)} maxWidth="lg">
        <DialogContent sx={{ p: 0 }}>
          {media && (
            <Box sx={{ display: 'flex', justifyContent: 'center', bgcolor: 'rgba(0,0,0,0.9)', maxHeight: '80vh' }}>
              {/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(media.name) ? (
                <img
                  src={`/api/files/download?path=${encodeURIComponent(fullPath(media))}`}
                  alt={media.name}
                  style={{ maxWidth: '100%', maxHeight: '80vh' }}
                />
              ) : /\.(mp4|webm|mov)$/i.test(media.name) ? (
                <video
                  controls
                  style={{ maxWidth: '100%', maxHeight: '80vh' }}
                  src={`/api/files/download?path=${encodeURIComponent(fullPath(media))}`}
                />
              ) : (
                <audio
                  controls
                  src={`/api/files/download?path=${encodeURIComponent(fullPath(media))}`}
                  style={{ margin: 'auto', display: 'block', minHeight: 120 }}
                />
              )}
            </Box>
          )}
        </DialogContent>
      </Dialog>

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
    <MenuItem key={i} onClick={it.onClick} sx={{ gap: 1 }}>
      {it.icon}
      {it.label}
    </MenuItem>
  ))
}
