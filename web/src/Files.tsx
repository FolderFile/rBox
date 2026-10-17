import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Alert, Box, Breadcrumbs, Button, Card, CardActionArea, CardContent, Checkbox,
  Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, IconButton, Link, List, ListItemButton, ListItemText, Menu,
  MenuItem, Paper, Slide, Snackbar, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Tooltip, Typography, useMediaQuery, useTheme,
} from '@mui/material'
import Add from '@mui/icons-material/Add'
import UploadIcon from '@mui/icons-material/CloudUploadRounded'
import CloudUploadOutlined from '@mui/icons-material/CloudUploadOutlined'
import GridViewOutlined from '@mui/icons-material/GridViewRounded'
import ViewListOutlined from '@mui/icons-material/ViewListRounded'
import TableChartRounded from '@mui/icons-material/TableChartRounded'
import HomeRounded from '@mui/icons-material/HomeRounded'
import SortIcon from '@mui/icons-material/SortRounded'
import Close from '@mui/icons-material/CloseRounded'
import Check from '@mui/icons-material/CheckRounded'
import ArrowUpward from '@mui/icons-material/ArrowUpwardRounded'
import ArrowDownward from '@mui/icons-material/ArrowDownwardRounded'
import MoreVert from '@mui/icons-material/MoreVertRounded'
import DownloadIcon from '@mui/icons-material/DownloadRounded'
import ShareIcon from '@mui/icons-material/ShareRounded'
import EditOutlined from '@mui/icons-material/EditRounded'
import DriveFileMoveOutlined from '@mui/icons-material/DriveFileMoveRounded'
import FileCopyOutlined from '@mui/icons-material/FileCopyRounded'
import DeleteOutline from '@mui/icons-material/DeleteOutline'
import CreateNewFolderOutlined from '@mui/icons-material/CreateNewFolderRounded'
import NoteAddOutlined from '@mui/icons-material/NoteAddRounded'
import InfoRounded from '@mui/icons-material/InfoRounded'
import FolderZipRounded from '@mui/icons-material/FolderZipRounded'
import SearchOff from '@mui/icons-material/SearchOffRounded'
import FolderOpenOutlined from '@mui/icons-material/FolderOpenRounded'
import { api, Entry, fmtDate, fmtSize, isEditable, joinPath, SearchHit } from './api'
import { useUploads } from './uploads'
import { ConfirmDialog, PromptDialog, ShareDialog } from './dialogs'
import { isMedia, Lightbox } from './Lightbox'
import { FileBadge } from './fileicons'
import { kindOf } from './filetypes'
import { ArchiveViewerDialog, CreateArchiveDialog, isArchiveName } from './ArchiveDialogs'
import { InspectorDrawer } from './Inspector'

// the codemirror grammars are a third of the frontend; load them only when
// a file is actually opened for editing
const TextEditor = lazy(() => import('./Editor'))

type View = 'table' | 'list' | 'grid'
type SortBy = 'name' | 'size' | 'modified'
type SortDir = 'asc' | 'desc'

const HOVER_SX = {
  transition: 'background-color 150ms cubic-bezier(0.2, 0, 0, 1), transform 150ms cubic-bezier(0.2, 0, 0, 1), box-shadow 150ms cubic-bezier(0.2, 0, 0, 1)',
}

const CATEGORIES: Record<string, string> = {
  image: 'Images',
  video: 'Videos',
  audio: 'Audio',
  doc: 'Documents',
  code: 'Code',
  archive: 'Archives',
}

function downloadFile(entry: Entry, dir: string) {
  const url = `/api/files/${entry.is_dir ? 'zip' : 'download'}?path=${encodeURIComponent(joinPath(dir, entry.name))}`
  const a = document.createElement('a')
  a.href = url
  a.download = entry.name
  a.click()
}

export default function Files() {
  const { cat } = useParams()
  const category = cat && CATEGORIES[cat] ? cat : null
  const params = useParams()['*'] ?? ''
  const cwd = category ? '' : params.replace(/\/+$/, '')
  const [searchParams] = useSearchParams()
  const focus = searchParams.get('focus')
  const nav = useNavigate()
  const upload = useUploads().upload
  const theme = useTheme()
  const narrow = useMediaQuery(theme.breakpoints.down('sm'))
  const xs = useMediaQuery(theme.breakpoints.only('xs'))

  const [entries, setEntries] = useState<Entry[]>([])
  const [listDir, setListDir] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [view, setView] = useState<View>('table')
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<{ by: SortBy; dir: SortDir }>({ by: 'name', dir: 'asc' })
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null)
  const [createAnchor, setCreateAnchor] = useState<HTMLElement | null>(null)
  const [error, setError] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; path: string; entry: Entry } | null>(null)
  const [dialog, setDialog] =
    useState<{ kind: 'mkdir' | 'newfile' | 'rename' | 'move' | 'copy' | 'share' | 'archive' | 'archive-view' | 'delete'; entry: Entry } | null>(null)
  const [editor, setEditor] = useState<Entry | null>(null)
  const [mediaIdx, setMediaIdx] = useState<number | null>(null)
  const [inspect, setInspect] = useState<Entry | null>(null)
  const [snack, setSnack] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [staged, setStaged] = useState<File[]>([])
  const [dropOver, setDropOver] = useState(false)
  const [archiveTargets, setArchiveTargets] = useState<string[] | null>(null)
  const browseInput = useRef<HTMLInputElement>(null)

  const load = useCallback(
    async (silent = false) => {
      try {
        if (category) {
          const res = await api.get(`/api/files/search?q=&type=${category}`)
          const hits: SearchHit[] = res.results
          const seen = new Set<string>()
          const list: Entry[] = hits.map(h => ({
            name: h.path.split('/').pop() ?? h.name,
            is_dir: h.is_dir,
            size: h.size,
            modified: h.modified,
          })).filter(e => !e.is_dir && !seen.has(e.name) && seen.add(e.name))
          setEntries(list)
          setListDir('')
          setSelected(new Set())
        } else {
          const res = await api.get(`/api/files?path=${encodeURIComponent(cwd)}`)
          setEntries(res.entries)
          setListDir(cwd)
          setSelected(new Set())
        }
        if (!silent) setError('')
      } catch (err: any) {
        setError(err.message)
      }
    },
    [cwd, category],
  )

  useEffect(() => {
    load()
  }, [load])

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

  // open the inspector for a file jumped to from the command palette
  useEffect(() => {
    if (!focus || !entries.length) return
    const hit = entries.find(e => e.name === focus)
    if (hit) setInspect(hit)
  }, [focus, entries])

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
        // strictly files: plain-text strings are never treated as uploads
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

  const lastNav = useRef<{ target: string; at: number } | null>(null)
  const openEntry = (e: Entry) => {
    if (e.is_dir) {
      const target = joinPath(listDir, e.name)
      const now = Date.now()
      if (lastNav.current && lastNav.current.target === target && now - lastNav.current.at < 600) return
      lastNav.current = { target, at: now }
      return go(target)
    }
    if (isArchiveName(e.name)) return setDialog({ kind: 'archive-view', entry: e })
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
  // in category mode entries carry no directory context, so row actions route
  // through the inspector instead
  const rowPath = category ? null : fullPath
  const rowDisabled = !!category

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

  const openArchiveCreate = (paths: string[]) => {
    setArchiveTargets(paths)
    setMenu(null)
  }

  const moveCopyMulti = (kind: 'move' | 'copy') => {
    const names = [...selected]
    if (!names.length) return
    if (names.length === 1) {
      const entry = entries.find(e => e.name === names[0])
      if (entry) setDialog({ kind, entry })
      return
    }
    // multi-selection: one prompt drives a folder-to-folder pass over each
    setDialog({ kind: kind === 'move' ? 'move' : 'copy', entry: { name: '', is_dir: false, size: 0, modified: 0 } })
    multiBatch.current = { kind, names }
  }
  const multiBatch = useRef<{ kind: 'move' | 'copy'; names: string[] } | null>(null)

  const applyBatch = (dest: string) => {
    const batch = multiBatch.current
    if (!batch) return
    act(
      () => Promise.all(batch.names.map(n =>
        api.post(`/api/files/${batch.kind}`, { path: joinPath(listDir, n), dest_dir: dest }))),
      `${batch.kind === 'move' ? 'Moved' : 'Copied'} ${batch.names.length} items`,
    )
    multiBatch.current = null
  }

  const checkbox = (e: Entry) => (
    <TableCell padding="checkbox" onClick={ev => ev.stopPropagation()}>
      <Checkbox
        size="small"
        checked={selected.has(e.name)}
        onChange={ev => {
          const next = new Set(selected)
          if (ev.target.checked) next.add(e.name)
          else next.delete(e.name)
          setSelected(next)
        }}
      />
    </TableCell>
  )

  const sortItems: { label: string; value: SortBy }[] = [
    { label: 'Name', value: 'name' },
    { label: 'Size', value: 'size' },
    { label: 'Modified date', value: 'modified' },
  ]
  const sortLabel = sortItems.find(it => it.value === sort.by)!.label
  const openCreate = (kind: 'mkdir' | 'newfile') => {
    setCreateAnchor(null)
    setDialog({ kind, entry: { name: '', is_dir: kind === 'mkdir', size: 0, modified: 0 } })
  }

  const toolbarRows = category ? (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
      <Typography variant="h6" sx={{ flex: 1 }}>{CATEGORIES[category]}</Typography>
      <Button
        size="small"
        startIcon={<SortIcon />}
        onClick={e => setSortAnchor(e.currentTarget)}
        sx={{ textTransform: 'none' }}
      >
        Sort: {sortLabel}
      </Button>
      {viewToggle()}
    </Box>
  ) : (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <Typography variant="h6" sx={{ flex: 1 }}>My Files</Typography>
        <Button variant="contained" startIcon={<UploadIcon />} onClick={() => setUploadOpen(true)}>
          Upload
        </Button>
        <Button startIcon={<Add />} onClick={e => setCreateAnchor(e.currentTarget)}>
          Create
        </Button>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
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
        <Button
          size="small"
          startIcon={<SortIcon />}
          onClick={e => setSortAnchor(e.currentTarget)}
          sx={{ textTransform: 'none' }}
        >
          Sort: {sortLabel}
        </Button>
        {viewToggle()}
      </Box>
    </>
  )

  function viewToggle() {
    return (
      <Box sx={{ display: 'flex', borderRadius: 2, border: '1px solid', borderColor: 'divider', p: 0.25, gap: 0.25 }}>
        {(['table', 'list', 'grid'] as View[]).map(v => {
          const icon = v === 'table' ? <TableChartRounded sx={{ fontSize: 17 }} />
            : v === 'list' ? <ViewListOutlined sx={{ fontSize: 17 }} />
            : <GridViewOutlined sx={{ fontSize: 17 }} />
          return (
            <Tooltip key={v} title={v === 'table' ? 'Comfortable table' : v === 'list' ? 'Compact list' : 'Visual grid'}>
              <IconButton
                size="small"
                onClick={() => setView(v)}
                sx={{ borderRadius: 1.5, bgcolor: view === v ? 'action.selected' : 'transparent' }}
              >
                {icon}
              </IconButton>
            </Tooltip>
          )
        })}
      </Box>
    )
  }

  const rowMenuItems = (e: Entry) => [
    ...(isArchiveName(e.name)
      ? [
          { label: 'Browse Archive', icon: <FolderZipRounded fontSize="small" />, onClick: () => setDialog({ kind: 'archive-view', entry: e }) },
          { label: 'Extract to Folder...', icon: <DriveFileMoveOutlined fontSize="small" />, onClick: () => { setMenu(null); setDialog({ kind: 'archive-view', entry: e }) } },
        ]
      : []),
    { label: 'Archive...', icon: <FolderZipRounded fontSize="small" />, onClick: () => openArchiveCreate([rowPath?.(e) ?? e.name]) },
    { label: e.is_dir ? 'Download (.zip)' : 'Download', icon: <DownloadIcon fontSize="small" />, onClick: () => { downloadFile(e, listDir); setMenu(null) } },
    { label: 'Share...', icon: <ShareIcon fontSize="small" />, onClick: () => { setMenu(null); setDialog({ kind: 'share', entry: e }) } },
    { label: 'Details', icon: <InfoRounded fontSize="small" />, onClick: () => { setMenu(null); setInspect(e) } },
    { label: 'Rename...', icon: <EditOutlined fontSize="small" />, onClick: () => { setMenu(null); setDialog({ kind: 'rename', entry: e }) } },
    { label: 'Move...', icon: <DriveFileMoveOutlined fontSize="small" />, onClick: () => { setMenu(null); setDialog({ kind: 'move', entry: e }) } },
    { label: 'Copy...', icon: <FileCopyOutlined fontSize="small" />, onClick: () => { setMenu(null); setDialog({ kind: 'copy', entry: e }) } },
    { label: 'Delete', icon: <DeleteOutline fontSize="small" />, onClick: () => { setMenu(null); confirmDelete([e.name]) } },
  ]

  const archiveEntry = dialog?.kind === 'archive-view' ? dialog.entry : null
  const dialogPath = dialog ? rowPath?.(dialog.entry) ?? dialog.entry.name : ''

  return (
    <Box>
      {toolbarRows}

      {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}

      <TableContainer component={Paper} variant="outlined" sx={{ width: '100%', overflowX: 'auto', borderRadius: 2 }}>
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
                    setMenu({ x: ev.clientX, y: ev.clientY, path: e.name, entry: e })
                  }}
                >
                  {checkbox(e)}
                  <TableCell sx={{ maxWidth: narrow ? undefined : 400 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <FileBadge entry={e} />
                      <Typography variant="body2" noWrap>{e.name}</Typography>
                    </Box>
                  </TableCell>
                  {!narrow && <TableCell align="right">{e.is_dir ? '' : fmtSize(e.size)}</TableCell>}
                  {!narrow && <TableCell>{fmtDate(e.modified)}</TableCell>}
                  <TableCell onClick={ev => ev.stopPropagation()} padding={narrow ? 'none' : 'normal'} sx={{ whiteSpace: 'nowrap' }}>
                    <RowActions e={e} onInspect={() => setInspect(e)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : view === 'list' ? (
          <List dense disablePadding>
            {shown.map(e => (
              <ListItemButton
                key={e.name}
                onClick={() => openEntry(e)}
                onContextMenu={ev => {
                  ev.preventDefault()
                  setMenu({ x: ev.clientX, y: ev.clientY, path: e.name, entry: e })
                }}
                sx={{ py: 0.5, ...HOVER_SX }}
              >
                <Box sx={{ width: 34, display: 'flex', justifyContent: 'center', pr: 1 }} onClick={ev => ev.stopPropagation()}>
                  <Checkbox
                    size="small"
                    checked={selected.has(e.name)}
                    onChange={ev => {
                      const next = new Set(selected)
                      if (ev.target.checked) next.add(e.name)
                      else next.delete(e.name)
                      setSelected(next)
                    }}
                  />
                </Box>
                <FileBadge entry={e} size={18} />
                <ListItemText
                  primary={e.name}
                  slotProps={{ primary: { noWrap: true } }}
                  sx={{ ml: 1 }}
                />
                <Typography variant="caption" color="text.secondary" sx={{ ml: 2, whiteSpace: 'nowrap' }}>
                  {e.is_dir ? '' : fmtSize(e.size)}
                </Typography>
                <Box onClick={ev => ev.stopPropagation()}>
                  <RowActions e={e} onInspect={() => setInspect(e)} compact />
                </Box>
              </ListItemButton>
            ))}
          </List>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', p: 1.5, gap: 1.5 }}>
            {shown.map(e => (
              <Card
                key={e.name}
                sx={{ ...HOVER_SX, '&:hover': { transform: 'translateY(-2px)', boxShadow: 4, borderColor: 'primary.main' } }}
                onContextMenu={ev => {
                  ev.preventDefault()
                  setMenu({ x: ev.clientX, y: ev.clientY, path: e.name, entry: e })
                }}
              >
                <CardActionArea onClick={() => openEntry(e)} sx={{ ...HOVER_SX }}>
                  <Box sx={{ aspectRatio: '1 / 1', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', bgcolor: 'action.hover' }}>
                    {kindOf(e.name, e.is_dir) === 'image' && !e.is_dir ? (
                      <img
                        src={`/api/files/download?path=${encodeURIComponent(joinPath(listDir, e.name))}`}
                        alt={e.name}
                        loading="lazy"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <FileBadge entry={e} size={44} />
                    )}
                  </Box>
                  <CardContent sx={{ py: 1, textAlign: 'center' }}>
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
            {filter || category ? (
              <>
                <SearchOff />
                <Typography variant="body2" sx={{ mt: 1 }}>
                  {category ? `No ${CATEGORIES[category].toLowerCase()} in your vault yet.` : `Nothing matches "${filter}".`}
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
      </TableContainer>

      <Slide in={selected.size > 0} direction="up" mountOnEnter unmountOnExit>
        <Paper
          elevation={8}
          sx={{
            position: 'fixed',
            left: '50%',
            transform: 'translateX(-50%)',
            bottom: 20,
            zIndex: t => t.zIndex.appBar + 1,
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            px: 1.5,
            py: 1,
            borderRadius: 3,
            bgcolor: theme.palette.mode === 'dark' ? '#1c2029' : undefined,
            maxWidth: '95vw',
            overflowX: 'auto',
          }}
        >
          <Chip label={`${selected.size} selected`} size="small" color="primary" sx={{ borderRadius: 2, mr: 0.5 }} />
          <Button size="small" startIcon={<FolderZipRounded />} onClick={() => openArchiveCreate([...selected].map(n => joinPath(listDir, n)))}>
            Archive
          </Button>
          <Button size="small" startIcon={<DownloadIcon />} onClick={() => {
            [...selected].forEach(n => {
              const e = entries.find(en => en.name === n)
              if (e) downloadFile(e, listDir)
            })
          }}>
            Download
          </Button>
          <Button size="small" startIcon={<DriveFileMoveOutlined />} onClick={() => moveCopyMulti('move')}>Move</Button>
          <Button size="small" startIcon={<FileCopyOutlined />} onClick={() => moveCopyMulti('copy')}>Copy</Button>
          <Button size="small" color="error" startIcon={<DeleteOutline />} onClick={() => confirmDelete([...selected])}>
            Delete
          </Button>
          <IconButton size="small" onClick={() => setSelected(new Set())}>
            <Close fontSize="small" />
          </IconButton>
        </Paper>
      </Slide>

      <Menu open={!!menu} anchorReference="anchorPosition" anchorPosition={menu ? { top: menu.y, left: menu.x } : undefined} onClose={() => setMenu(null)}>
        {menu && rowMenuItems(menu.entry).map((it, i) => (
          <MenuItem key={i} onClick={it.onClick} sx={{ gap: 1, display: 'flex', alignItems: 'center' }}>
            <Box sx={{ display: 'inline-flex', alignItems: 'center' }}>{it.icon}</Box>
            {it.label}
          </MenuItem>
        ))}
      </Menu>

      <Menu open={!!createAnchor} anchorEl={createAnchor} onClose={() => setCreateAnchor(null)}>
        <MenuItem onClick={() => openCreate('mkdir')} sx={{ gap: 1, display: 'flex', alignItems: 'center' }}>
          <CreateNewFolderOutlined fontSize="small" /> New Folder
        </MenuItem>
        <MenuItem onClick={() => openCreate('newfile')} sx={{ gap: 1, display: 'flex', alignItems: 'center' }}>
          <NoteAddOutlined fontSize="small" /> New File
        </MenuItem>
      </Menu>

      <Menu open={!!sortAnchor} anchorEl={sortAnchor} onClose={() => setSortAnchor(null)}>
        {sortItems.map(it => (
          <MenuItem key={it.value} onClick={() => setSort(s => ({ ...s, by: it.value }))} sx={{ gap: 1 }}>
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
          label={`New name for "${dialog.entry.name}"`}
          initial={dialog.entry.name}
          open
          onCancel={() => setDialog(null)}
          onSubmit={name =>
            act(
              () => api.post('/api/files/rename', { path: dialogPath, new_name: name }),
              'Renamed',
            )
          }
          confirmLabel="Rename"
        />
      )}
      {(dialog?.kind === 'move' || dialog?.kind === 'copy') && (
        <PromptDialog
          title={dialog.kind === 'move' ? 'Move' : 'Copy'}
          label={
            multiBatch.current
              ? `Destination folder for ${multiBatch.current.names.length} items`
              : `Destination folder for "${dialog.entry.name}"`
          }
          initial={cwd}
          open
          onCancel={() => { multiBatch.current = null; setDialog(null) }}
          onSubmit={dest => (multiBatch.current ? applyBatch(dest) : act(
            () => api.post(`/api/files/${dialog!.kind}`, { path: dialogPath, dest_dir: dest }),
            dialog!.kind === 'move' ? 'Moved' : 'Copied',
          ))}
          confirmLabel={dialog.kind === 'move' ? 'Move' : 'Copy'}
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
          onCreate={async opts => {
            const res = await api.post('/api/shares', { path: dialogPath, ...opts })
            load(true)
            return `${location.origin}/s/${res.token}`
          }}
        />
      )}

      <CreateArchiveDialog
        open={!!archiveTargets}
        paths={archiveTargets ?? []}
        suggestedName={
          archiveTargets?.length === 1
            ? `${archiveTargets[0].split('/').pop()?.replace(/\.[^.]*$/, '') ?? 'archive'}.zip`
            : 'archive.zip'
        }
        onCancel={() => setArchiveTargets(null)}
        onCreated={name => {
          setArchiveTargets(null)
          setSnack(`Created ${name}`)
          load(true)
        }}
      />

      {archiveEntry && dialogPath && (
        <ArchiveViewerDialog
          open
          path={dialogPath}
          onCancel={() => setDialog(null)}
          onExtracted={msg => {
            setSnack(msg)
            load(true)
          }}
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
              borderRadius: 2,
              bgcolor: dropOver ? 'action.hover' : 'transparent',
              textAlign: 'center',
              py: 5,
              px: 2,
              cursor: 'pointer',
              transition: 'background-color 150ms cubic-bezier(0.2, 0, 0, 1), border-color 150ms cubic-bezier(0.2, 0, 0, 1)',
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
            sx={{ mr: 'auto', borderRadius: 2, display: staged.length ? 'inline-flex' : 'none' }}
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

      <InspectorDrawer
        entry={inspect}
        path={inspect ? (category ? inspect.name : fullPath(inspect)) : ''}
        open={!!inspect}
        onClose={() => { setInspect(null); if (focus) nav(location.pathname, { replace: true }) }}
        onShare={e => { setInspect(null); setDialog({ kind: 'share', entry: e }) }}
        onDownload={e => { downloadFile(e, category ? '' : listDir); setInspect(null) }}
      />

      <Snackbar
        open={!!snack}
        autoHideDuration={4000}
        onClose={() => setSnack('')}
        message={snack}
      />
    </Box>
  )

  function RowActions({ e, onInspect, compact }: { e: Entry; onInspect: () => void; compact?: boolean }) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
        {!xs && !compact && (
          <Tooltip title="Details">
            <IconButton size="small" onClick={onInspect}>
              <InfoRounded fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        {!xs && (
          <Tooltip title="Download">
            <IconButton size="small" component="a" href={rowDisabled ? undefined : `/api/files/${e.is_dir ? 'zip' : 'download'}?path=${encodeURIComponent(joinPath(listDir, e.name))}`} download>
              <DownloadIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        {!xs && !compact && (
          <Tooltip title="Share">
            <IconButton size="small" onClick={() => setDialog({ kind: 'share', entry: e })}>
              <ShareIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title="More">
          <IconButton
            size="small"
            onClick={ev => setMenu({ x: ev.clientX, y: ev.clientY, path: e.name, entry: e })}
          >
            <MoreVert fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    )
  }
}