import { useEffect, useRef, useState } from 'react'
import { Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'
import { api } from './api'

// monospace textarea + synced line-number gutter; a full code editor library
// would bloat the embedded binary for what is mostly config and notes files
export function TextEditor({
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
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const gutter = useRef<HTMLDivElement>(null)

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
      await fetch(`/api/files/content?path=${encodeURIComponent(path)}`, {
        method: 'PUT',
        body: content,
      }).then(async res => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || `HTTP ${res.status}`)
        }
      })
      setDirty(false)
      onSaved()
    } catch (e: any) {
      setError(e.message)
    }
  }

  const lines = content.split('\n').length

  return (
    <Dialog open fullScreen onClose={onClose}>
      <DialogTitle sx={{ pb: 0.5 }}>{name}</DialogTitle>
      <DialogActions sx={{ pt: 0.5, pr: 3 }}>
        {dirty && <Typography variant="caption" color="text.secondary">unsaved</Typography>}
        <Button onClick={onClose}>Close</Button>
        <Button variant="contained" disabled={!dirty || loading} onClick={save}>
          Save
        </Button>
      </DialogActions>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {error && (
          <Typography variant="caption" color="error" sx={{ mb: 0.5 }}>
            {error}
          </Typography>
        )}
        {loading ? (
          <CircularProgress size={24} sx={{ m: 'auto' }} />
        ) : (
          <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
            <Box
              ref={gutter}
              sx={{
                fontFamily: '"Roboto Mono", "Consolas", monospace',
                fontSize: 13,
                lineHeight: 1.6,
                color: 'text.secondary',
                textAlign: 'right',
                pr: 1,
                userSelect: 'none',
                overflow: 'hidden',
                whiteSpace: 'pre',
              }}
            >
              {Array.from({ length: lines }, (_, i) => i + 1).join('\n')}
            </Box>
            <textarea
              value={content}
              spellCheck={false}
              onChange={e => {
                setContent(e.target.value)
                setDirty(true)
              }}
              onScroll={e => {
                if (gutter.current) gutter.current.scrollTop = (e.target as HTMLTextAreaElement).scrollTop
              }}
              onKeyDown={e => {
                if (e.key === 'Tab') {
                  e.preventDefault()
                  const ta = e.currentTarget
                  const { selectionStart: s, selectionEnd: end } = ta
                  setContent(content.slice(0, s) + '  ' + content.slice(end))
                  setDirty(true)
                  requestAnimationFrame(() => {
                    ta.selectionStart = ta.selectionEnd = s + 2
                  })
                }
                if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                  e.preventDefault()
                  save()
                }
              }}
              style={{
                flex: 1,
                fontFamily: '"Roboto Mono", "Consolas", monospace',
                fontSize: 13,
                lineHeight: 1.6,
                border: 'none',
                outline: 'none',
                resize: 'none',
                background: 'transparent',
                color: 'inherit',
              }}
            />
          </Box>
        )}
      </DialogContent>
    </Dialog>
  )
}