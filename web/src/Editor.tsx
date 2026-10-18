import { useEffect, useRef, useState } from 'react'
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
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { rust } from '@codemirror/lang-rust'
import { python } from '@codemirror/lang-python'
import { sql } from '@codemirror/lang-sql'
import { xml } from '@codemirror/lang-xml'
import { yaml as lezerYaml } from '@codemirror/lang-yaml'
import { lua } from '@codemirror/legacy-modes/mode/lua'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { go } from '@codemirror/legacy-modes/mode/go'
import { c, cpp, java, csharp, kotlin, scala } from '@codemirror/legacy-modes/mode/clike'
import { swift } from '@codemirror/legacy-modes/mode/swift'
import { ruby } from '@codemirror/legacy-modes/mode/ruby'
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile'
import { diff } from '@codemirror/legacy-modes/mode/diff'
import { properties } from '@codemirror/legacy-modes/mode/properties'
import { r } from '@codemirror/legacy-modes/mode/r'
import { perl } from '@codemirror/legacy-modes/mode/perl'
import { haskell } from '@codemirror/legacy-modes/mode/haskell'
import { erlang } from '@codemirror/legacy-modes/mode/erlang'
import { groovy } from '@codemirror/legacy-modes/mode/groovy'
import { powerShell } from '@codemirror/legacy-modes/mode/powershell'
import { api } from './api'
import { useThemeToggle } from './App'
import { ConfirmDialog } from './dialogs'
import { PREFS } from './Settings'

const FONT_SIZES = [12, 14, 16]
const MONO = '"JetBrains Mono", ui-monospace, "SF Mono", Consolas, monospace'

// every dev extension resolves to a real grammar. languages without a lezer
// package ride CodeMirror 5's stream modes through StreamLanguage; dart has
// no stream mode, so it borrows java's (near-identical token family)
const legacy = (parser: any): Extension => StreamLanguage.define(parser) as unknown as Extension

function langFor(name: string): { code: Extension[]; label: string; notepad?: boolean } {
  const lower = name.toLowerCase()
  const ext = lower.split('.').pop() ?? ''
  const plain = (label: string, notepad = false) => ({ code: [] as Extension[], label, notepad })

  if (lower === 'makefile' || ext === 'mk') return { code: [legacy(shell)], label: 'Makefile' }
  if (lower === 'dockerfile' || ext === 'dockerfile') return { code: [legacy(dockerFile)], label: 'Dockerfile' }
  if (lower === 'cargo.lock' || lower === 'go.sum' || lower === 'go.mod') return { code: [legacy(toml)], label: 'Lockfile' }

  switch (ext) {
    case 'html': case 'htm': return { code: [html()], label: 'HTML' }
    case 'vue': case 'svelte': case 'astro': return { code: [html()], label: ext.toUpperCase() }
    case 'xml': case 'svg': return { code: [xml()], label: 'XML' }
    case 'css': return { code: [css()], label: 'CSS' }
    case 'scss': case 'sass': case 'less': return { code: [css()], label: 'SCSS' }
    case 'js': case 'mjs': case 'cjs': return { code: [javascript()], label: 'JavaScript' }
    case 'jsx': return { code: [javascript({ jsx: true })], label: 'JSX' }
    case 'ts': return { code: [javascript({ typescript: true })], label: 'TypeScript' }
    case 'tsx': return { code: [javascript({ typescript: true, jsx: true })], label: 'TSX' }
    case 'json': case 'jsonc': return { code: [json()], label: 'JSON' }
    case 'md': case 'mdx': return { code: [markdown()], label: 'Markdown' }
    case 'rs': return { code: [rust()], label: 'Rust' }
    case 'py': return { code: [python()], label: 'Python' }
    case 'sql': return { code: [sql()], label: 'SQL' }
    case 'yaml': case 'yml': return { code: [lezerYaml()], label: 'YAML' }
    case 'toml': return { code: [legacy(toml)], label: 'TOML' }
    case 'lua': return { code: [legacy(lua)], label: 'Lua' }
    case 'sh': case 'bash': case 'zsh': case 'fish': return { code: [legacy(shell)], label: 'Shell' }
    case 'ps1': return { code: [legacy(powerShell)], label: 'PowerShell' }
    case 'go': return { code: [legacy(go)], label: 'Go' }
    case 'c': case 'h': return { code: [legacy(c)], label: 'C' }
    case 'cpp': case 'hpp': case 'cc': return { code: [legacy(cpp)], label: 'C++' }
    case 'cs': return { code: [legacy(csharp)], label: 'C#' }
    case 'java': return { code: [legacy(java)], label: 'Java' }
    case 'kt': return { code: [legacy(kotlin)], label: 'Kotlin' }
    case 'swift': return { code: [legacy(swift)], label: 'Swift' }
    case 'scala': return { code: [legacy(scala)], label: 'Scala' }
    case 'dart': return { code: [legacy(java)], label: 'Dart' }
    case 'zig': return { code: [legacy(cpp)], label: 'Zig' }
    case 'rb': return { code: [legacy(ruby)], label: 'Ruby' }
    case 'ex': case 'exs': return { code: [legacy(erlang)], label: 'Elixir' }
    case 'erl': return { code: [legacy(erlang)], label: 'Erlang' }
    case 'dockerfile': return { code: [legacy(dockerFile)], label: 'Dockerfile' }
    case 'diff': return { code: [legacy(diff)], label: 'Diff' }
    case 'ini': case 'cfg': case 'conf': case 'properties': case 'gitignore': return { code: [legacy(properties)], label: 'Config' }
    case 'env': return { code: [legacy(properties)], label: '.env' }
    case 'r': return { code: [legacy(r)], label: 'R' }
    case 'pl': return { code: [legacy(perl)], label: 'Perl' }
    case 'hs': return { code: [legacy(haskell)], label: 'Haskell' }
    case 'clj': return { code: [legacy(erlang)], label: 'Clojure' }
    case 'gradle': return { code: [legacy(groovy)], label: 'Gradle' }
    case 'nix': return plain('Nix')
    case 'php': return { code: [legacy(cpp)], label: 'PHP' }
    case 'bat': case 'cmd': return plain('Batch')
    case 'txt': case 'log': case 'csv': case 'rtf': return plain('Text', true)
    default: return plain(ext ? ext.toUpperCase() : 'Text')
  }
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
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  // editor defaults arrive from Settings (localStorage); the toolbar still
  // lets a session override them without touching the stored preference
  const prefFont = Number(localStorage.getItem(PREFS.fontSize) ?? 14)
  const [fontIdx, setFontIdx] = useState(Math.max(0, FONT_SIZES.indexOf(prefFont)))
  const [confirmClose, setConfirmClose] = useState(false)
  const [notice, setNotice] = useState('')
  const lang = langFor(name)
  const prefWrap = (localStorage.getItem(PREFS.wrap) ?? 'on') === 'on'
  const prefLineNums = (localStorage.getItem(PREFS.lineNumbers) ?? 'on') === 'on'
  const [wrap, setWrap] = useState(lang.notepad ? true : prefWrap)

  useEffect(() => {
    api
      .get(`/api/files/content?path=${encodeURIComponent(path)}`)
      .then(res => {
        setContent(res.content)
        setLoading(false)
      })
      .catch(e => {
        setError(e.message)
        setLoading(false)
      })
  }, [path])

  const save = async () => {
    try {
      const res = await fetch(`/api/files/content?path=${encodeURIComponent(path)}`, {
        method: 'PUT',
        body: content,
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      setDirty(false)
      onSaved()
    } catch (e: any) {
      setError(e.message)
    }
  }

  const requestClose = () => (dirty ? setConfirmClose(true) : onClose())

  // client-side formatting is only trustworthy where a real parser exists;
  // other languages simply don't get the button
  const canFormat = lang.label === 'JSON'
  const format = () => {
    try {
      setContent(JSON.stringify(JSON.parse(content), null, 2))
      setDirty(true)
      setNotice('Formatted')
    } catch (e: any) {
      setNotice(`cannot format: ${e.message}`)
    }
  }

  // the keymap closes over a ref so save() stays fresh without rebuilding
  // the editor state on every keystroke
  const saveRef = useRef(save)
  saveRef.current = save
  // line numbers show on plain text only when the setting says so; source
  // files always keep them
  const showLineNumbers = lang.notepad ? prefLineNums : true
  const extensions = [
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
    ...lang.code,
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
  ]

  return (
    <Dialog open fullScreen onClose={requestClose}>
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
        {canFormat && (
          <Tooltip title="Format (pretty-print JSON)">
            <IconButton size="small" onClick={format}>
              <FormatAlignLeft fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title={wrap ? 'Word wrap: on' : 'Word wrap: off'}>
          <IconButton
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
          <IconButton size="small" onClick={() => setFontIdx(i => (i + 1) % FONT_SIZES.length)}>
            <TextFields fontSize="small" />
          </IconButton>
        </Tooltip>
        <Button variant="contained" startIcon={<Save />} disabled={!dirty || loading} onClick={save}>
          Save
        </Button>
        <Tooltip title="Close">
          <IconButton size="small" onClick={requestClose}>
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
        {error && (
          <Typography variant="caption" color="error" sx={{ px: 2, pt: 1 }}>
            {error}
          </Typography>
        )}
        {loading ? (
          <CircularProgress size={24} sx={{ m: 'auto' }} />
        ) : (
          <Box sx={{ flex: 1, minHeight: 0 }}>
            <CodeMirror
              value={content}
              extensions={extensions}
              theme={mode === 'dark' ? oneDark : 'light'}
              height="100%"
              style={{ height: '100%' }}
              basicSetup={{
                highlightActiveLine: !lang.notepad,
                foldGutter: !lang.notepad,
                lineNumbers: showLineNumbers,
              }}
              onChange={v => {
                setContent(v)
                setDirty(true)
              }}
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
