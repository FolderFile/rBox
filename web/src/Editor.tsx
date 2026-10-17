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
import { yaml } from '@codemirror/lang-yaml'
import { api } from './api'
import { useThemeToggle } from './App'
import { ConfirmDialog } from './dialogs'

const FONT_SIZES = [13, 16, 19]

function langFor(name: string): { code: Extension[]; label: string; notepad?: boolean } {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const plain = (label: string, notepad = false) => ({ code: [] as Extension[], label, notepad })
  switch (ext) {
    case 'html': case 'htm': return { code: [html()], label: 'HTML' }
    case 'xml': case 'svg': return { code: [xml()], label: 'XML' }
    case 'css': return { code: [css()], label: 'CSS' }
    case 'scss': return { code: [css()], label: 'SCSS' }
    case 'js': case 'mjs': case 'cjs': return { code: [javascript()], label: 'JavaScript' }
    case 'jsx': return { code: [javascript({ jsx: true })], label: 'JSX' }
    case 'ts': return { code: [javascript({ typescript: true })], label: 'TypeScript' }
    case 'tsx': return { code: [javascript({ typescript: true, jsx: true })], label: 'TSX' }
    case 'json': return { code: [json()], label: 'JSON' }
    case 'md': return { code: [markdown()], label: 'Markdown' }
    case 'rs': return { code: [rust()], label: 'Rust' }
    case 'py': return { code: [python()], label: 'Python' }
    case 'sql': return { code: [sql()], label: 'SQL' }
    case 'yaml': case 'yml': return { code: [yaml()], label: 'YAML' }
    case 'toml': return plain('TOML')
    case 'sh': case 'bash': return plain('Shell')
    case 'txt': case 'log': return plain('Text', true)
    default: return plain(ext ? ext.toUpperCase() : 'Text', true)
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
  const [fontIdx, setFontIdx] = useState(0)
  const [confirmClose, setConfirmClose] = useState(false)
  const [notice, setNotice] = useState('')
  const lang = langFor(name)
  const [wrap, setWrap] = useState(!!lang.notepad)

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
  const extensions = [
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
        fontFamily: '"Roboto Mono", "Consolas", monospace',
      },
    }),
  ]

  return (
    <Dialog open fullScreen onClose={requestClose}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 2,
          minHeight: 52,
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
                lineNumbers: !lang.notepad,
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
        message={`“${name}” has unsaved changes. Discard them and close?`}
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