import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Alert, Box, Breadcrumbs, Button, Card, CardActionArea, CardContent, Checkbox,
  Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, IconButton, Link, List, ListItemButton, ListItemText, Menu,
  MenuItem, Paper, Slide, Snackbar, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
  useMediaQuery, useTheme,
} from '@mui/material'
import UploadIcon from '@mui/icons-material/CloudUploadRounded'
import CloudUploadOutlined from '@mui/icons-material/CloudUploadOutlined'
import GridViewRounded from '@mui/icons-material/GridViewRounded'
import ViewListRounded from '@mui/icons-material/ViewListRounded'
import TableRowsRounded from '@mui/icons-material/TableRowsRounded'
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
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded'
import ContentCutRounded from '@mui/icons-material/ContentCutRounded'
import ContentPasteRounded from '@mui/icons-material/ContentPasteRounded'
import DeleteOutline from '@mui/icons-material/DeleteOutline'
import CreateNewFolderOutlined from '@mui/icons-material/CreateNewFolderRounded'
import NoteAddOutlined from '@mui/icons-material/NoteAddRounded'
import InfoRounded from '@mui/icons-material/InfoRounded'
import FolderZipRounded from '@mui/icons-material/FolderZipRounded'
import FolderOpenOutlined from '@mui/icons-material/FolderOpenRounded'
import AddRounded from '@mui/icons-material/AddRounded'
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded'
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded'
import { alpha } from '@mui/material/styles'
import { api, Entry, fmtDate, fmtRelative, fmtSize, isEditable, joinPath, parentPath } from './api'
import { useUploads } from './uploads'
import { ConfirmDialog, DestinationPicker, PromptDialog, ShareDialog } from './dialogs'
import { FileBadge } from './fileicons'
import { DEFAULT_FOLDERS, isArchiveName, isMedia, kindLabel } from './filetypes'
import { PREFS, readPref } from './prefs'
import { lazyWithReload } from './lazy'

// the codemirror grammars are a third of the frontend; load them only when
// a file is actually opened for editing. the viewers and archive dialogs are
// equally off the listing's critical path
const TextEditor = lazyWithReload(() => import('./Editor'))
const Lightbox = lazyWithReload(() => import('./Lightbox'))
const InspectorDrawer = lazyWithReload(() => import('./Inspector').then(m => ({ default: m.InspectorDrawer })))
const CreateArchiveDialog = lazyWithReload(() => import('./ArchiveDialogs').then(m => ({ default: m.CreateArchiveDialog })))
const ArchiveViewerDialog = lazyWithReload(() => import('./ArchiveDialogs').then(m => ({ default: m.ArchiveViewerDialog })))

type View = 'table' | 'list' | 'grid'
type SortBy = 'name' | 'size' | 'modified'
type SortDir = 'asc' | 'desc'

const HOVER_SX = {
  transition: 'background-color 150ms cubic-bezier(0.2, 0, 0, 1), transform 150ms cubic-bezier(0.2, 0, 0, 1), box-shadow 150ms cubic-bezier(0.2, 0, 0, 1)',
}

// quiet, outlined toolbar controls; only Upload carries the brand color
const QUIET_BTN = {
  width: 34,
  height: 34,
  borderRadius: 1,
  border: '1px solid',
  borderColor: 'divider',
  color: 'text.secondary',
  '&:hover': { color: 'text.primary', bgcolor: 'action.hover' },
}

const VISUALLY_HIDDEN = {
  border: 0, clip: 'rect(0 0 0 0)', height: 1, margin: -1, overflow: 'hidden',
  padding: 0, position: 'absolute' as const, whiteSpace: 'nowrap' as const, width: 1,
}

/** size · relative date, for rows that hide the columns (phones, lists) */
function metaLine(e: Entry): string {
  const when = fmtRelative(e.modified)
  return e.is_dir ? when : `${fmtSize(e.size)} · ${when}`
}

const VIEW_ORDER: View[] = ['table', 'list', 'grid']

const plural = (n: number) => `${n} item${n === 1 ? '' : 's'}`

function downloadFile(entry: Entry, dir: string) {
  const url = `/api/files/${entry.is_dir ? 'zip' : 'download'}?path=${encodeURIComponent(joinPath(dir, entry.name))}`
  const a = document.createElement('a')
  a.href = url
  a.download = entry.name
  a.click()
}

// keyboard shortcuts and clipboard handling stay out of text fields, the
// code editor and every open modal (dialogs, drawers, the lightbox)
const isTypingTarget = (el: HTMLElement | null) =>
  !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable || !!el.closest('.cm-editor'))
const inOverlay = (el: HTMLElement | null) => !!el?.closest('.MuiModal-root')

export default function Files() {
  const params = useParams()['*'] ?? ''
  // the URL is the single source of truth for where we are; both sidebar and
  // breadcrumb clicks just navigate, and this component re-derives everything
  const cwd = params.replace(/^\/+|\/+$/g, '')
  const [searchParams] = useSearchParams()
  const focus = searchParams.get('focus')
  const { pathname } = useLocation()
  const nav = useNavigate()
  const { upload, setTarget } = useUploads()
  const theme = useTheme()
  const narrow = useMediaQuery(theme.breakpoints.down('sm'))
  const xs = useMediaQuery(theme.breakpoints.only('xs'))
  const wide = useMediaQuery(theme.breakpoints.up('lg'))
  const [newAnchor, setNewAnchor] = useState<HTMLElement | null>(null)

  const [listing, setListing] = useState<{ dir: string; entries: Entry[] }>({ dir: '', entries: [] })
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [view, setView] = useState<View>(() => {
    const saved = readPref(PREFS.view)
    return saved === 'list' || saved === 'grid' ? saved : 'table'
  })
  const [sort, setSort] = useState<{ by: SortBy; dir: SortDir }>({ by: 'name', dir: 'asc' })
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null)
  const [error, setError] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; path: string; entry: Entry } | null>(null)
  const [dialog, setDialog] =
    useState<{ kind: 'mkdir' | 'newfile' | 'rename' | 'share' | 'archive-view'; entry: Entry } | null>(null)
  const [picker, setPicker] = useState<{ action: 'move' | 'copy'; paths: string[] } | null>(null)
  const [clip, setClip] = useState<{ mode: 'cut' | 'copy'; paths: string[] } | null>(null)
  // the editor keeps the path it was opened with, whatever the listing does
  const [editor, setEditor] = useState<{ path: string; name: string } | null>(null)
  // the lightbox follows a file by name: a refresh that reorders or grows the
  // folder must not silently swap the picture being looked at
  const [mediaName, setMediaName] = useState<string | null>(null)
  const [inspect, setInspect] = useState<Entry | null>(null)
  const [snack, setSnack] = useState('')
  const [toDelete, setToDelete] = useState<string[] | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [staged, setStaged] = useState<File[]>([])
  const [dropOver, setDropOver] = useState(false)
  const [archiveTargets, setArchiveTargets] = useState<{ dir: string; paths: string[] } | null>(null)
  const browseInput = useRef<HTMLInputElement>(null)

  // entries always travel with the directory they were fetched from. a new
  // navigation keeps the previous list on screen (dimmed, with a progress
  // bar) until the new one resolves, so the explorer can never flash "this
  // folder is empty" for data it has not loaded yet. every request carries
  // an AbortController and only an aborted controller may discard a result.
  const ensured = useRef<Set<string>>(new Set())
  const listingSeq = useRef(0)
  const listingCtrl = useRef<AbortController | null>(null)
  const load = useCallback(
    async (silent = false) => {
      const seq = ++listingSeq.current
      const ctrl = new AbortController()
      listingCtrl.current = ctrl
      const target = cwd
      const isStale = () => listingSeq.current !== seq || ctrl.signal.aborted
      if (!silent) setLoading(true)
      try {
        const res = await api.get(`/api/files?path=${encodeURIComponent(target)}`, ctrl.signal)
        if (isStale()) return
        const names = new Set((res.entries as Entry[]).map(e => e.name))
        setListing({ dir: target, entries: res.entries })
        // a background refresh (upload finished, file saved) keeps whatever
        // is still there selected; a real navigation starts clean
        setSelected(sel => (silent ? new Set([...sel].filter(n => names.has(n))) : new Set()))
        setError('')
      } catch (err: any) {
        if (isStale()) return
        if (
          !ensured.current.has(target) &&
          DEFAULT_FOLDERS.includes(target) &&
          (err.status === 404 || /not found/i.test(err.message))
        ) {
          ensured.current.add(target)
          await api.post('/api/files/mkdir', { path: target }).catch(() => {})
          // the user may have moved on while the folder was being created
          if (isStale()) return
          return load(silent)
        }
        // never leave another folder's entries under this folder's breadcrumb
        setListing({ dir: target, entries: [] })
        setSelected(new Set())
        setError(err.message)
      } finally {
        if (!isStale()) setLoading(false)
      }
    },
    [cwd],
  )

  useEffect(() => {
    load()
    return () => listingCtrl.current?.abort()
  }, [load])

  // per-folder overlays never outlive the folder they were opened in (the
  // browser back button included); only the editor keeps its own path
  useEffect(() => {
    setSelected(new Set())
    setMediaName(null)
    setInspect(null)
    setMenu(null)
    setDialog(null)
    setPicker(null)
    setToDelete(null)
    setArchiveTargets(null)
  }, [cwd])

  const listDir = listing.dir
  const entries = listing.entries

  // window drops land where the breadcrumb says we are
  useEffect(() => {
    setTarget(cwd)
  }, [cwd, setTarget])
  useEffect(() => () => setTarget(null), [setTarget])

  useEffect(() => {
    const onRefresh = () => load(true)
    window.addEventListener('rbox:refresh', onRefresh)
    return () => window.removeEventListener('rbox:refresh', onRefresh)
  }, [load])

  // open the inspector for a file jumped to from the command palette, once:
  // the param is consumed right away so later refreshes can't reopen it
  useEffect(() => {
    if (!focus || listDir !== cwd || loading) return
    const hit = entries.find(e => e.name === focus)
    if (hit) setInspect(hit)
    nav(pathname, { replace: true })
  }, [focus, listDir, cwd, loading, entries, nav, pathname])

  const shown = useMemo(() => {
    const by = (a: Entry, b: Entry) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1
      let v: number
      if (sort.by === 'name') v = a.name.localeCompare(b.name)
      else v = (a.is_dir ? 0 : a[sort.by]) - (b.is_dir ? 0 : b[sort.by])
      return sort.dir === 'asc' ? v : -v
    }
    return [...entries].sort(by)
  }, [entries, sort])

  const mediaItems = useMemo(() => shown.filter(isMedia), [shown])
  const mediaIdx = mediaName === null ? -1 : mediaItems.findIndex(m => m.name === mediaName)
  // the file being viewed was deleted or renamed: close instead of jumping
  useEffect(() => {
    if (mediaName !== null && listDir === cwd && mediaIdx < 0) setMediaName(null)
  }, [mediaName, mediaIdx, listDir, cwd])

  const stampName = (f: File): File => {
    if (!/^image\./i.test(f.name)) return f
    const ext = f.name.split('.').pop() ?? 'png'
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
    return new File([f], `paste-${stamp}.${ext}`, { type: f.type })
  }

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
    if (isEditable(e.name)) return setEditor({ path: fullPath(e), name: e.name })
    if (isMedia(e)) return setMediaName(e.name)
  }

  const fullPath = (e: Entry) => joinPath(listDir, e.name)
  // thumbnails stream the original; FileBadge only uses it for small images
  const fileUrl = (e: Entry) => `/api/files/download?path=${encodeURIComponent(fullPath(e))}`

  // bulk operations settle every item, refresh no matter what, and report a
  // partial failure instead of leaving deleted rows on screen
  const runAll = async (paths: string[], op: (path: string) => Promise<unknown>, verb: string) => {
    const results = await Promise.allSettled(paths.map(op))
    const failed = paths.filter((_, i) => results[i].status === 'rejected')
    const firstErr = (results.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined)?.reason
    load(true)
    if (!failed.length) setSnack(`${verb} ${plural(paths.length)}`)
    else if (paths.length === 1) setSnack(firstErr?.message ?? 'Failed')
    else setSnack(`${verb} ${paths.length - failed.length} of ${paths.length}: ${firstErr?.message ?? 'failed'}`)
    return failed
  }

  // prompt dialogs show a thrown error inline and stay open
  const submitPrompt = async (fn: () => Promise<unknown>, msg: string) => {
    await fn()
    setDialog(null)
    setMenu(null)
    setSnack(msg)
    load(true)
  }

  const del = (names: string[]) =>
    runAll(
      names.map(n => joinPath(listDir, n)),
      path => api.del(`/api/files?path=${encodeURIComponent(path)}`),
      'Deleted',
    )

  const startUpload = () => {
    if (!staged.length) return
    upload(cwd, staged)
    setStaged([])
    setUploadOpen(false)
  }

  const createFile = (name: string) =>
    submitPrompt(async () => {
      // the backend refuses to overwrite too (create=1), but say so early
      if (listDir === cwd && entries.some(e => e.name === name)) throw new Error(`'${name}' already exists`)
      const path = joinPath(cwd, name)
      await api.putText(`/api/files/content?path=${encodeURIComponent(path)}&create=1`, '')
      setEditor({ path, name })
    }, `Created ${name}`)

  const openArchiveCreate = (paths: string[]) => {
    setArchiveTargets({ dir: listDir, paths })
    setMenu(null)
  }

  const openPicker = (action: 'move' | 'copy', paths: string[]) => {
    if (!paths.length) return
    setPicker({ action, paths })
    setMenu(null)
  }
  const moveCopyMulti = (action: 'move' | 'copy') =>
    openPicker(action, [...selected].map(n => joinPath(listDir, n)))

  const applyPicker = async (dest: string) => {
    const p = picker
    if (!p) return
    await runAll(
      p.paths,
      path => api.post(`/api/files/${p.action}`, { path, dest_dir: dest }),
      p.action === 'move' ? 'Moved' : 'Copied',
    )
    setPicker(null)
  }

  // in-app clipboard: cut/copy a selection, wander somewhere else, paste.
  // cut empties after a successful paste (failed items stay armed); copy
  // stays armed
  const copySelection = (mode: 'cut' | 'copy', names: string[]) => {
    if (!names.length) return
    setClip({ mode, paths: names.map(n => joinPath(listDir, n)) })
    setSnack(`${plural(names.length)} ready to ${mode === 'cut' ? 'move' : 'copy'}`)
  }
  const pasteClip = async () => {
    if (!clip) return
    const c = clip
    const failed = await runAll(
      c.paths,
      path => api.post(`/api/files/${c.mode === 'cut' ? 'move' : 'copy'}`, { path, dest_dir: cwd }),
      c.mode === 'cut' ? 'Moved' : 'Copied',
    )
    if (c.mode === 'cut') setClip(failed.length ? { mode: 'cut', paths: failed } : null)
  }
  const pasteClipRef = useRef(pasteClip)
  pasteClipRef.current = pasteClip
  // ctrl+v arms this; the paste event that follows either carries files from
  // the OS clipboard (upload them) or doesn't (run the in-app paste). the
  // timer covers browsers that fire no paste event outside editable elements
  const pendingClipPaste = useRef(0)

  useEffect(() => {
    const onPaste = (ev: ClipboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      if (isTypingTarget(el)) return
      const files: File[] = []
      for (const item of Array.from(ev.clipboardData?.items ?? [])) {
        // strictly files: plain-text strings are never treated as uploads
        if (item.kind !== 'file') continue
        const f = item.getAsFile()
        if (f) files.push(stampName(f))
      }
      const armed = pendingClipPaste.current
      window.clearTimeout(armed)
      pendingClipPaste.current = 0
      if (files.length) {
        ev.preventDefault()
        if (uploadOpen) setStaged(s => [...s, ...files])
        else if (!inOverlay(el)) upload(cwd, files)
        return
      }
      if (armed) {
        ev.preventDefault()
        pasteClipRef.current()
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [uploadOpen, cwd, upload])

  // ctrl+c / ctrl+x / ctrl+v over the listing; inputs, the code editor and
  // open dialogs keep their native clipboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      if (isTypingTarget(el) || inOverlay(el) || e.altKey) return
      const mod = e.ctrlKey || e.metaKey
      // plain keys a file manager is expected to answer
      if (!mod && !e.shiftKey) {
        if (e.key === 'Escape' && selected.size) {
          setSelected(new Set())
        } else if (e.key === 'Delete' && selected.size) {
          e.preventDefault()
          setToDelete([...selected])
        } else if (e.key === 'F2' && selected.size === 1) {
          const entry = entries.find(en => selected.has(en.name))
          if (entry) {
            e.preventDefault()
            setDialog({ kind: 'rename', entry })
          }
        }
        return
      }
      if (!mod || e.shiftKey) return
      const key = e.key.toLowerCase()
      if (key === 'a') {
        // select files, not the page's text
        e.preventDefault()
        setSelected(new Set(entries.map(en => en.name)))
        return
      }
      if (key === 'backspace' && e.metaKey && selected.size) {
        e.preventDefault()
        setToDelete([...selected])
        return
      }
      if (key === 'c' || key === 'x') {
        if (!selected.size) return
        // the user is copying page text (a file name, a size), not files
        if (key === 'c' && window.getSelection()?.toString()) return
        e.preventDefault()
        copySelection(key === 'x' ? 'cut' : 'copy', [...selected])
      } else if (key === 'v' && clip) {
        // no preventDefault: that would suppress the paste event and with it
        // pasting screenshots from the OS clipboard
        window.clearTimeout(pendingClipPaste.current)
        pendingClipPaste.current = window.setTimeout(() => {
          pendingClipPaste.current = 0
          pasteClipRef.current()
        }, 150)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(pendingClipPaste.current)
    }
    // the listener rebinds whenever the selection, listing or clipboard changes
  }, [selected, clip, listDir, entries])

  const toggleSelected = (name: string, on: boolean) => {
    const next = new Set(selected)
    if (on) next.add(name)
    else next.delete(name)
    setSelected(next)
  }

  const checkbox = (e: Entry) => (
    <TableCell padding="checkbox" onClick={ev => ev.stopPropagation()}>
      <Checkbox
        size="small"
        checked={selected.has(e.name)}
        onChange={ev => toggleSelected(e.name, ev.target.checked)}
        inputProps={{ 'aria-label': `Select ${e.name}` }}
      />
    </TableCell>
  )

  const openMenuAt = (el: HTMLElement, e: Entry) => {
    const r = el.getBoundingClientRect()
    setMenu({ x: r.left + 24, y: r.bottom, path: e.name, entry: e })
  }

  const sortItems: { label: string; value: SortBy }[] = [
    { label: 'Name', value: 'name' },
    { label: 'Size', value: 'size' },
    { label: 'Modified date', value: 'modified' },
  ]
  const sortLabel = sortItems.find(it => it.value === sort.by)!.label
  const openCreate = (kind: 'mkdir' | 'newfile') => {
    setDialog({ kind, entry: { name: '', is_dir: kind === 'mkdir', size: 0, modified: 0 } })
  }
  const viewName = view === 'table' ? 'Table' : view === 'list' ? 'Compact list' : 'Grid'
  const cycleView = () =>
    setView(VIEW_ORDER[(VIEW_ORDER.indexOf(view) + 1) % VIEW_ORDER.length])

  const downloadSelected = () => {
    const list = [...selected]
      .map(n => entries.find(en => en.name === n))
      .filter((e): e is Entry => !!e)
    // browsers drop back-to-back programmatic downloads; space them out
    list.forEach((e, i) => window.setTimeout(() => downloadFile(e, listDir), i * 400))
    if (list.length > 1) setSnack(`Downloading ${plural(list.length)}. Allow multiple downloads if your browser asks.`)
  }

  // a plain function, not a component: a component defined inside Files
  // would be a new type every render and remount (losing focus) each time
  const rowActions = (e: Entry, { compact, reveal }: { compact?: boolean; reveal?: boolean } = {}) => {
    const quick = reveal ? 'quick' : undefined
    return (
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
        {!xs && !compact && (
          <Tooltip title="Details">
            <IconButton aria-label={`Details for ${e.name}`} className={quick} size="small" sx={{ color: 'text.secondary' }} onClick={() => setInspect(e)}>
              <InfoRounded fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        {!xs && (
          <Tooltip title="Download">
            <IconButton aria-label={`Download ${e.name}`} className={quick} size="small" sx={{ color: 'text.secondary' }} component="a" href={`/api/files/${e.is_dir ? 'zip' : 'download'}?path=${encodeURIComponent(joinPath(listDir, e.name))}`} download>
              <DownloadIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        {!xs && !compact && (
          <Tooltip title="Share">
            <IconButton aria-label={`Share ${e.name}`} className={quick} size="small" sx={{ color: 'text.secondary' }} onClick={() => setDialog({ kind: 'share', entry: e })}>
              <ShareIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title="More">
          <IconButton
            aria-label={`More actions for ${e.name}`}
            aria-haspopup="menu"
            size="small"
            onClick={ev => setMenu({ x: ev.clientX, y: ev.clientY, path: e.name, entry: e })}
          >
            <MoreVert fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    )
  }

  const crumbs = cwd.split('/').filter(Boolean)
  const title = crumbs.length ? crumbs[crumbs.length - 1] : 'All files'
  const nFolders = entries.filter(e => e.is_dir).length
  const nFiles = entries.length - nFolders
  const bytes = entries.reduce((n, e) => n + (e.is_dir ? 0 : e.size), 0)
  const summary = loading && listDir !== cwd
    ? 'Loading…'
    : entries.length === 0
      ? (error ? 'Unavailable' : 'Empty folder')
      : [
          nFolders ? `${nFolders} folder${nFolders === 1 ? '' : 's'}` : '',
          nFiles ? `${nFiles} file${nFiles === 1 ? '' : 's'}` : '',
          nFiles ? fmtSize(bytes) : '',
        ].filter(Boolean).join(' · ')

  const toolbarRows = (
    <Box sx={{ mb: 1.5 }}>
      {crumbs.length > 0 && <Breadcrumbs
        separator={<ChevronRightRounded sx={{ fontSize: 16, color: 'text.disabled' }} />}
        maxItems={xs ? 3 : 6}
        itemsAfterCollapse={2}
        aria-label="Current folder"
        sx={{ mb: 0.25, minHeight: 22, '& .MuiBreadcrumbs-li': { minWidth: 0 }, '& .MuiBreadcrumbs-separator': { mx: 0.25 } }}
      >
        <Link
          component="button"
          underline="hover"
          color="text.secondary"
          sx={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 0.5, fontSize: '0.8125rem' }}
          onClick={() => go('')}
        >
          <HomeRounded sx={{ fontSize: 16 }} />
          Home
        </Link>
        {/* ancestors only: the heading below already names this folder */}
        {crumbs.slice(0, -1).map((part, i) => (
          <Link
            key={i}
            component="button"
            underline="hover"
            color="text.secondary"
            sx={{ cursor: 'pointer', fontSize: '0.8125rem', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}
            onClick={() => go(crumbs.slice(0, i + 1).join('/'))}
          >
            {part}
          </Link>
        ))}
      </Breadcrumbs>}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', rowGap: 1 }}>
        <Box sx={{ flex: 1, minWidth: 160 }}>
          <Typography
            component="h1"
            noWrap
            sx={{ fontWeight: 700, fontSize: { xs: '1.25rem', sm: '1.5rem' }, letterSpacing: '-0.02em', lineHeight: 1.25 }}
          >
            {title}
          </Typography>
          <Typography variant="caption" color="text.secondary" aria-live="polite" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {summary}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          {xs ? (
            <Tooltip title="Upload files">
              <IconButton
                aria-label="Upload files"
                onClick={() => setUploadOpen(true)}
                sx={{ ...QUIET_BTN, bgcolor: 'primary.main', borderColor: 'primary.main', color: 'primary.contrastText', '&:hover': { bgcolor: 'primary.dark' } }}
              >
                <UploadIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          ) : (
            <Button variant="contained" aria-label="Upload files" startIcon={<UploadIcon />} onClick={() => setUploadOpen(true)} sx={{ height: 34, px: 1.75 }}>
              Upload
            </Button>
          )}
          {xs ? (
            <Tooltip title="New folder or file">
              <IconButton aria-label="New folder or file" aria-haspopup="menu" onClick={e => setNewAnchor(e.currentTarget)} sx={QUIET_BTN}>
                <AddRounded sx={{ fontSize: 20 }} />
              </IconButton>
            </Tooltip>
          ) : (
            <Button
              variant="outlined"
              color="inherit"
              aria-haspopup="menu"
              startIcon={<AddRounded />}
              endIcon={<ExpandMoreRounded sx={{ opacity: 0.6 }} />}
              onClick={e => setNewAnchor(e.currentTarget)}
              sx={{ height: 34, borderColor: 'divider', color: 'text.primary', '&:hover': { borderColor: 'text.disabled', bgcolor: 'action.hover' } }}
            >
              New
            </Button>
          )}
          <Menu
            anchorEl={newAnchor}
            open={!!newAnchor}
            onClose={() => setNewAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            slotProps={{ paper: { sx: { mt: 0.5, minWidth: 190 } } }}
          >
            <MenuItem onClick={() => { setNewAnchor(null); openCreate('mkdir') }}>
              <CreateNewFolderOutlined fontSize="small" sx={{ mr: 1.25, color: '#f59e0b' }} /> Folder
            </MenuItem>
            <MenuItem onClick={() => { setNewAnchor(null); openCreate('newfile') }}>
              <NoteAddOutlined fontSize="small" sx={{ mr: 1.25, color: 'rgb(59, 130, 246)' }} /> Text file
            </MenuItem>
            <Divider sx={{ my: 0.5 }} />
            <MenuItem onClick={() => { setNewAnchor(null); setUploadOpen(true) }}>
              <UploadIcon fontSize="small" sx={{ mr: 1.25, color: 'text.secondary' }} /> Upload files…
            </MenuItem>
          </Menu>
          <Divider orientation="vertical" flexItem sx={{ mx: 0.25, my: 0.5, display: { xs: 'none', sm: 'block' } }} />
          <Tooltip title={`Sort by ${sortLabel.toLowerCase()} (${sort.dir === 'asc' ? 'ascending' : 'descending'})`}>
            <IconButton aria-label="Sort" aria-haspopup="menu" onClick={e => setSortAnchor(e.currentTarget)} sx={QUIET_BTN}>
              <SortIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          {xs ? (
            <Tooltip title={`View: ${viewName}`}>
              <IconButton aria-label={`Switch view (current: ${viewName})`} onClick={cycleView} sx={QUIET_BTN}>
                {view === 'table' ? <TableRowsRounded sx={{ fontSize: 18 }} />
                  : view === 'list' ? <ViewListRounded sx={{ fontSize: 18 }} />
                  : <GridViewRounded sx={{ fontSize: 18 }} />}
              </IconButton>
            </Tooltip>
          ) : (
            <ToggleButtonGroup
              exclusive
              size="small"
              value={view}
              onChange={(_, v: View | null) => v && setView(v)}
              aria-label="View"
              sx={{
                height: 34,
                '& .MuiToggleButton-root': { px: 1, color: 'text.secondary', borderColor: 'divider' },
                '& .Mui-selected': { color: 'text.primary' },
              }}
            >
              <ToggleButton value="table" aria-label="Table view"><Tooltip title="Table"><TableRowsRounded sx={{ fontSize: 18 }} /></Tooltip></ToggleButton>
              <ToggleButton value="list" aria-label="Compact list view"><Tooltip title="Compact list"><ViewListRounded sx={{ fontSize: 18 }} /></Tooltip></ToggleButton>
              <ToggleButton value="grid" aria-label="Grid view"><Tooltip title="Grid"><GridViewRounded sx={{ fontSize: 18 }} /></Tooltip></ToggleButton>
            </ToggleButtonGroup>
          )}
        </Box>
      </Box>
    </Box>
  )

  const rowMenuItems = (e: Entry) => [
    ...(isArchiveName(e.name)
      ? [
          { label: 'Browse Archive', icon: <FolderZipRounded fontSize="small" />, onClick: () => { setMenu(null); setDialog({ kind: 'archive-view', entry: e }) } },
          { label: 'Extract to Folder...', icon: <DriveFileMoveOutlined fontSize="small" />, onClick: () => { setMenu(null); setDialog({ kind: 'archive-view', entry: e }) } },
        ]
      : []),
    { label: 'Archive...', icon: <FolderZipRounded fontSize="small" />, onClick: () => openArchiveCreate([fullPath(e)]) },
    { label: e.is_dir ? 'Download (.zip)' : 'Download', icon: <DownloadIcon fontSize="small" />, onClick: () => { downloadFile(e, listDir); setMenu(null) } },
    { label: 'Share...', icon: <ShareIcon fontSize="small" />, onClick: () => { setMenu(null); setDialog({ kind: 'share', entry: e }) } },
    { label: 'Details', icon: <InfoRounded fontSize="small" />, onClick: () => { setMenu(null); setInspect(e) } },
    { label: 'Rename...', icon: <EditOutlined fontSize="small" />, onClick: () => { setMenu(null); setDialog({ kind: 'rename', entry: e }) } },
    { label: 'Move to...', icon: <DriveFileMoveOutlined fontSize="small" />, onClick: () => openPicker('move', [fullPath(e)]) },
    { label: 'Copy to...', icon: <FileCopyOutlined fontSize="small" />, onClick: () => openPicker('copy', [fullPath(e)]) },
    { label: 'Cut', icon: <ContentCutRounded fontSize="small" />, onClick: () => { setMenu(null); copySelection('cut', [e.name]) } },
    { label: 'Copy', icon: <ContentCopyRounded fontSize="small" />, onClick: () => { setMenu(null); copySelection('copy', [e.name]) } },
    { label: 'Delete', icon: <DeleteOutline fontSize="small" />, onClick: () => { setMenu(null); setToDelete([e.name]) } },
  ]

  const archiveEntry = dialog?.kind === 'archive-view' ? dialog.entry : null
  const dialogPath = dialog ? fullPath(dialog.entry) : ''
  // keep the last rows clear of the fixed selection / clipboard bars
  const barSpace = (selected.size > 0 ? 7 : 0) + (clip ? 7 : 0)

  return (
    <Box>
      {toolbarRows}

      {error && (
        <Alert
          severity="error"
          sx={{ mb: 1 }}
          action={
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              {cwd && (
                <Button color="inherit" size="small" onClick={() => go(parentPath(cwd))}>
                  Go up
                </Button>
              )}
              <Button color="inherit" size="small" onClick={() => load()}>
                Retry
              </Button>
            </Box>
          }
        >
          {error}
        </Alert>
      )}

      <Box sx={{ position: 'relative', pb: barSpace }}>
        {loading && (
          <Box
            role="progressbar"
            aria-label="Loading folder"
            sx={{
              position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2,
              borderRadius: 1, overflow: 'hidden',
            }}
          >
            <Box
              sx={{
                height: 2,
                bgcolor: 'primary.main',
                width: '40%',
                animation: 'rbox-indeterminate 1.1s cubic-bezier(0.2, 0, 0, 1) infinite',
                '@keyframes rbox-indeterminate': {
                  '0%': { transform: 'translateX(-100%)' },
                  '100%': { transform: 'translateX(250%)' },
                },
              }}
            />
          </Box>
        )}
      <TableContainer component={Paper} variant="outlined" sx={{ width: '100%', overflowX: 'auto', borderRadius: 1.5 }}>
        {view === 'table' ? (
          <Table size="small" stickyHeader>
            <TableHead sx={{ display: shown.length ? undefined : 'none' }}>
              <TableRow>
                <TableCell padding="checkbox" />
                <TableCell>Name</TableCell>
                {wide && <TableCell>Kind</TableCell>}
                {!narrow && <TableCell align="right">Size</TableCell>}
                {!narrow && <TableCell>Modified</TableCell>}
                <TableCell align="right"><Box component="span" sx={VISUALLY_HIDDEN}>Actions</Box></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map(e => (
                <TableRow
                  key={e.name}
                  hover
                  selected={selected.has(e.name)}
                  // rows are keyboard targets: Enter opens, the context-menu
                  // key (or Shift+F10) opens the actions menu
                  tabIndex={0}
                  sx={{
                    cursor: 'pointer',
                    ...HOVER_SX,
                    '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
                  }}
                  onClick={() => openEntry(e)}
                  onKeyDown={ev => {
                    if (ev.target !== ev.currentTarget) return
                    if (ev.key === 'Enter') {
                      ev.preventDefault()
                      openEntry(e)
                    } else if (ev.key === 'ContextMenu' || (ev.shiftKey && ev.key === 'F10')) {
                      ev.preventDefault()
                      openMenuAt(ev.currentTarget, e)
                    }
                  }}
                  onContextMenu={ev => {
                    ev.preventDefault()
                    setMenu({ x: ev.clientX, y: ev.clientY, path: e.name, entry: e })
                  }}
                >
                  {checkbox(e)}
                  <TableCell sx={{ maxWidth: narrow ? 0 : 420, width: narrow ? '100%' : undefined, py: 0.75 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
                      <FileBadge entry={e} thumb={fileUrl(e)} />
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" noWrap fontWeight={e.is_dir ? 600 : 500}>{e.name}</Typography>
                        {narrow && (
                          <Typography variant="caption" color="text.secondary" noWrap component="div">
                            {metaLine(e)}
                          </Typography>
                        )}
                      </Box>
                    </Box>
                  </TableCell>
                  {wide && <TableCell sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>{kindLabel(e)}</TableCell>}
                  {!narrow && (
                    <TableCell align="right" sx={{ color: 'text.secondary', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      {e.is_dir ? '—' : fmtSize(e.size)}
                    </TableCell>
                  )}
                  {!narrow && (
                    <TableCell sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
                      <Tooltip title={fmtDate(e.modified)} placement="top-start">
                        <span>{fmtRelative(e.modified)}</span>
                      </Tooltip>
                    </TableCell>
                  )}
                  <TableCell
                    onClick={ev => ev.stopPropagation()}
                    padding={narrow ? 'none' : 'normal'}
                    sx={{
                      whiteSpace: 'nowrap',
                      // quick icons stay out of sight until the row is aimed at
                      '& .quick': { opacity: 0, transition: 'opacity 150ms cubic-bezier(0.2, 0, 0, 1)' },
                      'tr:hover & .quick, tr:focus-within & .quick, & .quick:focus-visible': { opacity: 1 },
                    }}
                  >
                    {rowActions(e, { reveal: true })}
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
                onKeyDown={ev => {
                  if (ev.target === ev.currentTarget && (ev.key === 'ContextMenu' || (ev.shiftKey && ev.key === 'F10'))) {
                    ev.preventDefault()
                    openMenuAt(ev.currentTarget, e)
                  }
                }}
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
                    onChange={ev => toggleSelected(e.name, ev.target.checked)}
                    inputProps={{ 'aria-label': `Select ${e.name}` }}
                  />
                </Box>
                <FileBadge entry={e} size={18} thumb={fileUrl(e)} />
                <ListItemText
                  primary={e.name}
                  slotProps={{ primary: { noWrap: true, fontWeight: e.is_dir ? 600 : 400 } }}
                  sx={{ ml: 1.25, minWidth: 0 }}
                />
                <Typography variant="caption" color="text.secondary" sx={{ ml: 2, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  {narrow ? (e.is_dir ? '' : fmtSize(e.size)) : metaLine(e)}
                </Typography>
                <Box onClick={ev => ev.stopPropagation()}>
                  {rowActions(e, { compact: true })}
                </Box>
              </ListItemButton>
            ))}
          </List>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(auto-fill, minmax(132px, 1fr))', sm: 'repeat(auto-fill, minmax(160px, 1fr))' }, p: { xs: 1, sm: 1.5 }, gap: { xs: 1, sm: 1.5 } }}>
            {shown.map(e => (
              <Card
                key={e.name}
                sx={{
                  ...HOVER_SX,
                  position: 'relative',
                  boxShadow: 'none',
                  borderColor: selected.has(e.name) ? 'primary.main' : 'divider',
                  outline: selected.has(e.name) ? '1px solid' : 'none',
                  outlineColor: 'primary.main',
                  '&:hover': { transform: 'translateY(-2px)', boxShadow: 3 },
                  '& .grid-check': { opacity: selected.has(e.name) ? 1 : 0, transition: 'opacity 150ms' },
                  '&:hover .grid-check, &:focus-within .grid-check': { opacity: 1 },
                }}
                onContextMenu={ev => {
                  ev.preventDefault()
                  setMenu({ x: ev.clientX, y: ev.clientY, path: e.name, entry: e })
                }}
              >
                <CardActionArea
                  onClick={() => openEntry(e)}
                  onKeyDown={ev => {
                    if (ev.key === 'ContextMenu' || (ev.shiftKey && ev.key === 'F10')) {
                      ev.preventDefault()
                      openMenuAt(ev.currentTarget, e)
                    }
                  }}
                  sx={{ ...HOVER_SX }}
                >
                  <Box sx={{ aspectRatio: '4 / 3', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', bgcolor: 'action.hover' }}>
                    <FileBadge entry={e} size={40} thumb={fileUrl(e)} square />
                  </Box>
                  <CardContent sx={{ py: 1, px: 1.25 }}>
                    <Typography variant="body2" noWrap fontWeight={500} title={e.name}>{e.name}</Typography>
                    <Typography variant="caption" color="text.secondary" noWrap component="div">
                      {e.is_dir ? 'Folder' : metaLine(e)}
                    </Typography>
                  </CardContent>
                </CardActionArea>
                <Box className="grid-check" sx={{ position: 'absolute', top: 4, left: 4 }} onClick={ev => ev.stopPropagation()}>
                  <Checkbox
                    size="small"
                    checked={selected.has(e.name)}
                    onChange={ev => toggleSelected(e.name, ev.target.checked)}
                    inputProps={{ 'aria-label': `Select ${e.name}` }}
                    sx={{ p: 0.5, bgcolor: 'background.paper', borderRadius: 1, boxShadow: 1, '&:hover': { bgcolor: 'background.paper' } }}
                  />
                </Box>
              </Card>
            ))}
          </Box>
        )}
        {shown.length === 0 && !loading && !error && (
          <Box sx={{ px: 3, py: { xs: 6, sm: 8 }, textAlign: 'center' }}>
            <Box
              sx={{
                width: 64, height: 64, mx: 'auto', mb: 2, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                bgcolor: t => alpha(t.palette.primary.main, 0.1), color: 'primary.main',
              }}
            >
              <FolderOpenOutlined sx={{ fontSize: 30 }} />
            </Box>
            <Typography variant="subtitle1" fontWeight={700}>This folder is empty</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2.5, maxWidth: 360, mx: 'auto' }}>
              Drag files anywhere on this page, paste an image, or use the buttons below.
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Button variant="contained" startIcon={<UploadIcon />} onClick={() => setUploadOpen(true)}>Upload files</Button>
              <Button variant="outlined" color="inherit" startIcon={<CreateNewFolderOutlined />} onClick={() => openCreate('mkdir')} sx={{ borderColor: 'divider' }}>
                New folder
              </Button>
            </Box>
          </Box>
        )}
        {shown.length === 0 && !loading && error && (
          <Box sx={{ p: 6, textAlign: 'center', color: 'text.secondary' }}>
            <Typography variant="body2">This folder could not be opened. It may have been moved or deleted.</Typography>
          </Box>
        )}
        {shown.length === 0 && loading && (
          <Box sx={{ p: 6, display: 'flex', justifyContent: 'center' }}>
            <CircularProgress size={22} aria-label="Loading folder" />
          </Box>
        )}
      </TableContainer>
      </Box>

      <Slide in={!!clip} direction="up" mountOnEnter unmountOnExit>
        <Paper
          elevation={8}
          role="region"
          aria-label="Clipboard"
          sx={{
            position: 'fixed',
            left: '50%',
            transform: 'translateX(-50%)',
            bottom: selected.size > 0 ? 76 : 20,
            zIndex: t => t.zIndex.appBar,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 1.75,
            py: 1,
            borderRadius: 2,
            bgcolor: theme.palette.mode === 'dark' ? '#1c2029' : undefined,
            maxWidth: '95vw',
          }}
        >
          <ContentPasteRounded fontSize="small" sx={{ color: clip?.mode === 'cut' ? 'warning.main' : 'info.main' }} />
          <Typography variant="body2" noWrap>
            {plural(clip?.paths.length ?? 0)} ready to {clip?.mode === 'cut' ? 'move' : 'copy'}
          </Typography>
          <Button size="small" variant="contained" onClick={pasteClip}>
            Paste into {cwd ? cwd.split('/').pop() : 'Home'}
          </Button>
          <Button size="small" onClick={() => setClip(null)}>
            Cancel
          </Button>
        </Paper>
      </Slide>

      <Slide in={selected.size > 0} direction="up" mountOnEnter unmountOnExit>
        <Paper
          elevation={8}
          role="region"
          aria-label="Selection actions"
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
          <Button size="small" startIcon={<DownloadIcon />} onClick={downloadSelected}>
            Download
          </Button>
          <Button size="small" startIcon={<DriveFileMoveOutlined />} onClick={() => moveCopyMulti('move')}>Move</Button>
          <Button size="small" startIcon={<FileCopyOutlined />} onClick={() => moveCopyMulti('copy')}>Copy</Button>
          <Button size="small" startIcon={<ContentCutRounded />} onClick={() => copySelection('cut', [...selected])}>Cut</Button>
          <Button size="small" startIcon={<DeleteOutline />} color="error" onClick={() => setToDelete([...selected])}>
            Delete
          </Button>
          <Tooltip title="Clear selection">
            <IconButton aria-label="Clear selection" size="small" onClick={() => setSelected(new Set())}>
              <Close fontSize="small" />
            </IconButton>
          </Tooltip>
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
            submitPrompt(() => api.post('/api/files/mkdir', { path: joinPath(cwd, name) }), `Created ${name}`)
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
            submitPrompt(
              () => api.post('/api/files/rename', { path: dialogPath, new_name: name }),
              'Renamed',
            )
          }
          confirmLabel="Rename"
        />
      )}
      {picker && (
        <DestinationPicker
          open
          action={picker.action}
          title={picker.action === 'move'
            ? `Move ${picker.paths.length === 1 ? `"${picker.paths[0].split('/').pop()}"` : `${picker.paths.length} items`} to...`
            : `Copy ${picker.paths.length === 1 ? `"${picker.paths[0].split('/').pop()}"` : `${picker.paths.length} items`} to...`}
          forbiddenPrefixes={picker.action === 'move' ? picker.paths : []}
          startDir={listDir}
          onCancel={() => setPicker(null)}
          onConfirm={applyPicker}
        />
      )}
      <ConfirmDialog
        open={!!toDelete}
        title="Delete"
        message={toDelete?.length === 1
          ? `Delete "${toDelete[0]}" permanently?`
          : `Delete ${plural(toDelete?.length ?? 0)} permanently?`}
        onCancel={() => setToDelete(null)}
        onConfirm={() => {
          const names = toDelete
          setToDelete(null)
          if (names) del(names)
        }}
      />
      {dialog?.kind === 'share' && (
        <ShareDialog
          open
          path={dialog.entry.name}
          onCancel={() => setDialog(null)}
          onCreate={async opts => {
            const res = await api.post('/api/shares', { path: dialogPath, ...opts })
            return `${location.origin}/s/${res.token}`
          }}
        />
      )}

      {archiveTargets && (
        <Suspense fallback={null}>
          <CreateArchiveDialog
            open
            dir={archiveTargets.dir}
            paths={archiveTargets.paths}
            suggestedName={
              archiveTargets.paths.length === 1
                ? `${archiveTargets.paths[0].split('/').pop()?.replace(/\.[^.]*$/, '') || 'archive'}.zip`
                : 'archive.zip'
            }
            onCancel={() => setArchiveTargets(null)}
            onCreated={name => {
              setArchiveTargets(null)
              setSnack(`Created ${name}`)
              load(true)
            }}
          />
        </Suspense>
      )}

      {archiveEntry && dialogPath && (
        <Suspense fallback={null}>
          <ArchiveViewerDialog
            open
            path={dialogPath}
            onCancel={() => setDialog(null)}
            onExtracted={msg => {
              setSnack(msg)
              load(true)
            }}
          />
        </Suspense>
      )}

      <Dialog open={uploadOpen} onClose={() => { setUploadOpen(false); setStaged([]) }} maxWidth="sm" fullWidth>
        <DialogTitle>Upload to {cwd ? `/${cwd}` : 'Home'}</DialogTitle>
        <DialogContent>
          <Box
            role="button"
            tabIndex={0}
            aria-label="Choose files to upload"
            onClick={() => browseInput.current?.click()}
            onKeyDown={ev => {
              if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault()
                browseInput.current?.click()
              }
            }}
            // stopPropagation: the window-level drop zone must not also
            // upload these files straight away
            onDragOver={ev => {
              ev.preventDefault()
              ev.stopPropagation()
              setDropOver(true)
            }}
            onDragLeave={() => setDropOver(false)}
            onDrop={ev => {
              ev.preventDefault()
              ev.stopPropagation()
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
              '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' },
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
                  <IconButton aria-label={`Remove ${f.name}`} size="small" onClick={() => setStaged(s => s.filter((_, j) => j !== i))}>
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
                <CircularProgress aria-label="Loading editor" />
              </DialogContent>
            </Dialog>
          }
        >
          <TextEditor
            path={editor.path}
            name={editor.name}
            onClose={() => setEditor(null)}
            onSaved={() => load(true)}
          />
        </Suspense>
      )}

      {mediaIdx >= 0 && (
        <Suspense fallback={null}>
          <Lightbox
            items={mediaItems}
            index={mediaIdx}
            urlOf={e => `/api/files/download?path=${encodeURIComponent(fullPath(e))}`}
            onClose={() => setMediaName(null)}
            onIndex={i => setMediaName(mediaItems[i]?.name ?? null)}
            // the share dialog must not open underneath the viewer
            onShare={e => { setMediaName(null); setDialog({ kind: 'share', entry: e }) }}
          />
        </Suspense>
      )}

      {inspect && (
        <Suspense fallback={null}>
          <InspectorDrawer
            entry={inspect}
            path={fullPath(inspect)}
            open
            onClose={() => setInspect(null)}
            onShare={e => { setInspect(null); setDialog({ kind: 'share', entry: e }) }}
            onDownload={e => { downloadFile(e, listDir); setInspect(null) }}
          />
        </Suspense>
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
