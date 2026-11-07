import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box, Button, Chip, CircularProgress, Dialog, DialogContent, IconButton,
  Snackbar, Tooltip, Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import WrapText from '@mui/icons-material/WrapText'
import TextFields from '@mui/icons-material/TextFields'
import Save from '@mui/icons-material/Save'
import FormatAlignLeft from '@mui/icons-material/FormatAlignLeft'
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined'
import CodeMirror from '@uiw/react-codemirror'
import { EditorView, keymap } from '@codemirror/view'
import { Prec, type Extension } from '@codemirror/state'
import { StreamLanguage, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { oneDark } from '@codemirror/theme-one-dark'
import { api } from './api'
import { useThemeToggle } from './theme-ctx'
import { ConfirmDialog } from './dialogs'
import { PREFS, readPref } from './prefs'

const FONT_SIZES = [12, 14, 16]
const MONO = '"JetBrains Mono", ui-monospace, "SF Mono", Consolas, monospace'

// grammars are loaded on demand: each one is its own small chunk, so the
// editor core opens without shipping every language up front. languages
// without a lezer package ride CodeMirror 5's stream modes; dart has no
// stream mode, so it borrows java's (near-identical token family)
type Loader = () => Promise<Extension>
const legacy = (load: () => Promise<any>, key: string): Loader => () =>
  load().then(m => StreamLanguage.define(m[key]) as unknown as Extension)

const clike = () => import('@codemirror/legacy-modes/mode/clike')
const shellMode = () => import('@codemirror/legacy-modes/mode/shell')
const tomlMode = () => import('@codemirror/legacy-modes/mode/toml')
const dockerMode = () => import('@codemirror/legacy-modes/mode/dockerfile')
const propsMode = () => import('@codemirror/legacy-modes/mode/properties')
const erlangMode = () => import('@codemirror/legacy-modes/mode/erlang')
const html = () => import('@codemirror/lang-html').then(m => m.html())
const cssLang = () => import('@codemirror/lang-css').then(m => m.css())

interface LangSpec {
  label: string
  notepad?: boolean
  load?: Loader
}

function langFor(name: string): LangSpec {
  const lower = name.toLowerCase()
  const ext = lower.split('.').pop() ?? ''

  if (lower === 'makefile' || ext === 'mk') return { label: 'Makefile', load: legacy(shellMode, 'shell') }
  if (lower === 'dockerfile' || ext === 'dockerfile') return { label: 'Dockerfile', load: legacy(dockerMode, 'dockerFile') }
  if (lower === 'cargo.lock' || lower === 'go.sum' || lower === 'go.mod') return { label: 'Lockfile', load: legacy(tomlMode, 'toml') }

  switch (ext) {
    case 'html': case 'htm': return { label: 'HTML', load: html }
    case 'vue': case 'svelte': case 'astro': return { label: ext.toUpperCase(), load: html }
    case 'xml': case 'svg': return { label: 'XML', load: () => import('@codemirror/lang-xml').then(m => m.xml()) }
    case 'css': return { label: 'CSS', load: cssLang }
    case 'scss': case 'sass': case 'less': return { label: 'SCSS', load: cssLang }
    case 'js': case 'mjs': case 'cjs': return { label: 'JavaScript', load: () => import('@codemirror/lang-javascript').then(m => m.javascript()) }
    case 'jsx': return { label: 'JSX', load: () => import('@codemirror/lang-javascript').then(m => m.javascript({ jsx: true })) }
    case 'ts': return { label: 'TypeScript', load: () => import('@codemirror/lang-javascript').then(m => m.javascript({ typescript: true })) }
    case 'tsx': return { label: 'TSX', load: () => import('@codemirror/lang-javascript').then(m => m.javascript({ typescript: true, jsx: true })) }
    case 'json': case 'jsonc': return { label: 'JSON', load: () => import('@codemirror/lang-json').then(m => m.json()) }
    case 'md': case 'mdx': return { label: 'Markdown', load: () => import('@codemirror/lang-markdown').then(m => m.markdown()) }
    case 'rs': return { label: 'Rust', load: () => import('@codemirror/lang-rust').then(m => m.rust()) }
    case 'py': return { label: 'Python', load: () => import('@codemirror/lang-python').then(m => m.python()) }
    case 'sql': return { label: 'SQL', load: () => import('@codemirror/lang-sql').then(m => m.sql()) }
    case 'yaml': case 'yml': return { label: 'YAML', load: () => import('@codemirror/lang-yaml').then(m => m.yaml()) }
    case 'toml': return { label: 'TOML', load: legacy(tomlMode, 'toml') }
    case 'lua': return { label: 'Lua', load: legacy(() => import('@codemirror/legacy-modes/mode/lua'), 'lua') }
    case 'sh': case 'bash': case 'zsh': case 'fish': return { label: 'Shell', load: legacy(shellMode, 'shell') }
    case 'ps1': return { label: 'PowerShell', load: legacy(() => import('@codemirror/legacy-modes/mode/powershell'), 'powerShell') }
    case 'go': return { label: 'Go', load: legacy(() => import('@codemirror/legacy-modes/mode/go'), 'go') }
    case 'c': case 'h': return { label: 'C', load: legacy(clike, 'c') }
    case 'cpp': case 'hpp': case 'cc': return { label: 'C++', load: legacy(clike, 'cpp') }
    case 'cs': return { label: 'C#', load: legacy(clike, 'csharp') }
    case 'java': return { label: 'Java', load: legacy(clike, 'java') }
    case 'kt': return { label: 'Kotlin', load: legacy(clike, 'kotlin') }
    case 'swift': return { label: 'Swift', load: legacy(() => import('@codemirror/legacy-modes/mode/swift'), 'swift') }
    case 'scala': return { label: 'Scala', load: legacy(clike, 'scala') }
    case 'dart': return { label: 'Dart', load: legacy(clike, 'java') }
    case 'zig': return { label: 'Zig', load: legacy(clike, 'cpp') }
    case 'rb': return { label: 'Ruby', load: legacy(() => import('@codemirror/legacy-modes/mode/ruby'), 'ruby') }
    case 'ex': case 'exs': return { label: 'Elixir', load: legacy(erlangMode, 'erlang') }
    case 'erl': return { label: 'Erlang', load: legacy(erlangMode, 'erlang') }
    case 'diff': return { label: 'Diff', load: legacy(() => import('@codemirror/legacy-modes/mode/diff'), 'diff') }
    case 'ini': case 'cfg': case 'conf': case 'properties': case 'gitignore': return { label: 'Config', load: legacy(propsMode, 'properties') }
    case 'env': return { label: '.env', load: legacy(propsMode, 'properties') }
    case 'r': return { label: 'R', load: legacy(() => import('@codemirror/legacy-modes/mode/r'), 'r') }
    case 'pl': return { label: 'Perl', load: legacy(() => import('@codemirror/legacy-modes/mode/perl'), 'perl') }
    case 'hs': return { label: 'Haskell', load: legacy(() => import('@codemirror/legacy-modes/mode/haskell'), 'haskell') }
    case 'clj': return { label: 'Clojure', load: legacy(erlangMode, 'erlang') }
    case 'gradle': return { label: 'Gradle', load: legacy(() => import('@codemirror/legacy-modes/mode/groovy'), 'groovy') }
    case 'nix': return { label: 'Nix' }
    case 'php': return { label: 'PHP', load: legacy(clike, 'cpp') }
    case 'bat': case 'cmd': return { label: 'Batch' }
    case 'txt': case 'log': case 'csv': case 'rtf': return { label: 'Text', notepad: true }
    default: return { label: ext ? ext.toUpperCase() : 'Text' }
  }
}

// one Language instance per grammar for the whole session: reopening a file
// type reuses it instead of defining a fresh stream language
const langCache = new Map<string, Promise<Extension>>()
function loadLang(spec: LangSpec): Promise<Extension> {
  if (!spec.load) return Promise.resolve([])
  let p = langCache.get(spec.label)
  if (!p) {
    p = spec.load()
    // a failed chunk (offline, stale deploy) retries on the next open
    p.catch(() => langCache.delete(spec.label))
    langCache.set(spec.label, p)
  }
  return p
}

function loadErrorMessage(e: any): string {
  if (e?.status === 413) return 'This file is larger than the 5 MB editor limit. Download it instead.'
  if (e?.status === 415) return "This file isn't UTF-8 text, so it can't be edited here."
  return e?.message ?? 'Could not load the file.'
}

export default function TextEditor({
  path,
  name,
  onClose,
  onSaved,
}: {
  path: string
  name: string
  onClose: () => void
  onSaved: () => void
}) {
  const { mode } = useThemeToggle()
  // null until the file has loaded; while null (or after a load error) there
  // is nothing that could be saved back over the real file
  const [doc, setDoc] = useState<string | null>(null)
  const [loadError, setLoadError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  // editor defaults arrive from Settings (localStorage); the toolbar still
  // lets a session override them without touching the stored preference
  const [fontIdx, setFontIdx] = useState(() =>
    Math.max(0, FONT_SIZES.indexOf(Number(readPref(PREFS.fontSize) ?? 14))),
  )
  const [confirmClose, setConfirmClose] = useState(false)
  const [notice, setNotice] = useState('')
  const lang = useMemo(() => langFor(name), [name])
  const [langExt, setLangExt] = useState<Extension>([])
  const [wrap, setWrap] = useState(() => (lang.notepad ? true : (readPref(PREFS.wrap) ?? 'on') === 'on'))
  const [prefLineNums] = useState(() => (readPref(PREFS.lineNumbers) ?? 'on') === 'on')

  // the live text lives in the editor; mirroring it into react state would
  // re-render (and re-diff a multi-MB doc) on every keystroke
  const docRef = useRef('')
  const version = useRef(0)
  const viewRef = useRef<EditorView | null>(null)
  const loaded = doc !== null

  useEffect(() => {
    let cancelled = false
    setDoc(null)
    setLoadError('')
    api
      .get(`/api/files/content?path=${encodeURIComponent(path)}`)
      .then(res => {
        if (cancelled) return
        docRef.current = res.content
        setDoc(res.content)
      })
      .catch(e => {
        if (!cancelled) setLoadError(loadErrorMessage(e))
      })
    return () => {
      cancelled = true
    }
  }, [path])

  useEffect(() => {
    let cancelled = false
    loadLang(lang)
      .then(ext => {
        if (!cancelled) setLangExt(ext)
      })
      // no grammar: the file still opens as plain text
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [lang])

  // unsaved edits survive neither a tab close nor a reload: ask first
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const save = async () => {
    if (!loaded || saving) return
    const at = version.current
    setSaving(true)
    setSaveError('')
    try {
      await api.putText(`/api/files/content?path=${encodeURIComponent(path)}`, docRef.current)
      // edits typed while the request was in flight keep the dirty marker
      if (version.current === at) setDirty(false)
      setNotice('Saved')
      onSaved()
    } catch (e: any) {
      setSaveError(e.message)
      setNotice(`Save failed: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  const requestClose = () => (dirty ? setConfirmClose(true) : onClose())

  // client-side formatting is only trustworthy where a real parser exists;
  // other languages simply don't get the button
  const canFormat = lang.label === 'JSON'
  const format = () => {
    const view = viewRef.current
    if (!view) return
    try {
      const pretty = JSON.stringify(JSON.parse(docRef.current), null, 2)
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: pretty } })
      setNotice('Formatted')
    } catch (e: any) {
      setNotice(`cannot format: ${e.message}`)
    }
  }

  // the keymap closes over a ref so save() stays fresh without rebuilding
  // the editor state on every keystroke
  const saveRef = useRef(save)
  saveRef.current = save

  const onChange = useCallback((v: string) => {
    docRef.current = v
    version.current++
    setDirty(true)
  }, [])

  // every prop below is memoized: @uiw/react-codemirror reconfigures the
  // whole editor whenever one of them changes identity
  const extensions = useMemo(
    () => [
      // light mode has no theme-provided colors; fall back to the classic
      // highlight style so tokens are colored even before oneDark takes over
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      Prec.high(
        keymap.of([
          {
            key: 'Mod-s',
            run: () => {
              saveRef.current()
              return true
            },
          },
        ]),
      ),
      langExt,
      ...(wrap ? [EditorView.lineWrapping] : []),
      EditorView.theme({
        '&': { fontSize: `${FONT_SIZES[fontIdx]}px`, height: '100%' },
        '.cm-editor': { height: '100%' },
        '.cm-scroller': {
          overflow: 'auto',
          fontFamily: MONO,
        },
        '.cm-gutters': { fontFamily: MONO },
      }),
    ],
    [langExt, wrap, fontIdx],
  )
  // line numbers show on plain text only when the setting says so; source
  // files always keep them
  const basicSetup = useMemo(
    () => ({
      highlightActiveLine: !lang.notepad,
      foldGutter: !lang.notepad,
      lineNumbers: lang.notepad ? prefLineNums : true,
      // completion popups from words in the buffer are noise in a file manager
      autocompletion: false,
    }),
    [lang.notepad, prefLineNums],
  )

  return (
    <Dialog open fullScreen onClose={requestClose} aria-label={`Edit ${name}`}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          minHeight: 46,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Box sx={{ color: 'action.active', display: 'inline-flex' }}>
          <DescriptionOutlined fontSize="small" />
        </Box>
        <Typography variant="subtitle1" noWrap sx={{ fontWeight: 500 }}>
          {name}
        </Typography>
        <Chip label={lang.label} size="small" variant="outlined" sx={{ borderRadius: 1 }} />
        <Tooltip title={dirty ? 'Unsaved changes' : ''}>
          <Box
            aria-label={dirty ? 'Unsaved changes' : undefined}
            sx={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              bgcolor: dirty ? 'warning.main' : 'transparent',
              visibility: dirty ? 'visible' : 'hidden',
            }}
          />
        </Tooltip>
        <Box sx={{ flex: 1 }} />
        {canFormat && loaded && (
          <Tooltip title="Format (pretty-print JSON)">
            <IconButton aria-label="Format JSON" size="small" onClick={format}>
              <FormatAlignLeft fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title={wrap ? 'Word wrap: on' : 'Word wrap: off'}>
          <IconButton
            aria-label="Toggle word wrap"
            aria-pressed={wrap}
            size="small"
            onClick={() => setWrap(w => !w)}
            sx={{
              color: wrap ? 'primary.main' : 'inherit',
              bgcolor: wrap ? 'rgba(25, 118, 210, 0.12)' : 'transparent',
            }}
          >
            <WrapText fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={`Font size: ${FONT_SIZES[fontIdx]}px`}>
          <IconButton aria-label="Change font size" size="small" onClick={() => setFontIdx(i => (i + 1) % FONT_SIZES.length)}>
            <TextFields fontSize="small" />
          </IconButton>
        </Tooltip>
        <Button variant="contained" startIcon={<Save />} disabled={!dirty || !loaded || saving} onClick={save}>
          Save
        </Button>
        <Tooltip title="Close">
          <IconButton aria-label="Close editor" size="small" onClick={requestClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      <DialogContent
        sx={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          height: '100%',
          overflow: 'hidden',
          p: 0,
        }}
      >
        {saveError && (
          <Typography variant="caption" color="error" role="alert" sx={{ px: 2, pt: 1 }}>
            {saveError}
          </Typography>
        )}
        {loadError ? (
          <Box role="alert" sx={{ m: 'auto', p: 3, textAlign: 'center', maxWidth: 420 }}>
            <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 0.5 }}>
              Can't open "{name}"
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {loadError}
            </Typography>
            <Button variant="outlined" onClick={onClose}>Close</Button>
          </Box>
        ) : !loaded ? (
          <CircularProgress size={24} sx={{ m: 'auto' }} aria-label="Loading file" />
        ) : (
          <Box sx={{ flex: 1, minHeight: 0 }}>
            <CodeMirror
              value={doc}
              extensions={extensions}
              theme={mode === 'dark' ? oneDark : 'light'}
              height="100%"
              style={{ height: '100%' }}
              basicSetup={basicSetup}
              // the file is ready to type into the moment it opens. this also
              // pulls focus back from a closing dialog (the "new file" prompt
              // restores focus to its trigger), so Escape closes the editor
              autoFocus
              onCreateEditor={view => {
                viewRef.current = view
                requestAnimationFrame(() => view.focus())
              }}
              onChange={onChange}
            />
          </Box>
        )}
      </DialogContent>
      <ConfirmDialog
        open={confirmClose}
        title="Unsaved changes"
        message={`"${name}" has unsaved changes. Discard them and close?`}
        confirmLabel="Discard and close"
        onCancel={() => setConfirmClose(false)}
        onConfirm={() => {
          setConfirmClose(false)
          onClose()
        }}
      />
      <Snackbar
        open={!!notice}
        autoHideDuration={2500}
        onClose={() => setNotice('')}
        message={notice}
      />
    </Dialog>
  )
}
