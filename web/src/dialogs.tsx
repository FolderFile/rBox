import { useRef, useState } from 'react'
import { Button, Chip, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, InputAdornment, MenuItem, Stack, TextField } from '@mui/material'
import CheckIcon from '@mui/icons-material/Check'
import ContentCopy from '@mui/icons-material/ContentCopy'
import OpenInNew from '@mui/icons-material/OpenInNew'

// one dialog shape for every simple single-value prompt (mkdir, rename,
// move, copy) so the explorer doesn't carry five near-identical dialogs
export function PromptDialog(props: {
  title: string
  label: string
  initial?: string
  confirmLabel?: string
  open: boolean
  onCancel: () => void
  onSubmit: (value: string) => void
}) {
  const [value, setValue] = useState(props.initial ?? '')
  const [err, setErr] = useState('')
  const submit = () => {
    if (value.includes('..')) return setErr("'..' is not allowed")
    props.onSubmit(value)
  }
  return (
    <Dialog
      // remount each open so the initial value never sticks around
      key={`${props.open}-${props.initial ?? ''}`}
      open={props.open}
      onClose={props.onCancel}
    >
      <DialogTitle>{props.title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {err && <DialogContentText color="error">{err}</DialogContentText>}
          <TextField
            autoFocus
            value={value}
            onChange={e => setValue(e.target.value)}
            error={!!err}
            onKeyUp={e => e.key === 'Enter' && submit()}
            onKeyDown={e => e.key === 'Enter' && e.preventDefault()}
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button variant="contained" onClick={submit}>
          {props.confirmLabel ?? 'OK'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

const EXPIRY = [
  { label: 'Never', value: null as number | null },
  { label: '1 hour', value: 3600 },
  { label: '1 day', value: 86400 },
  { label: '7 days', value: 7 * 86400 },
  { label: '30 days', value: 30 * 86400 },
]

export function ShareDialog(props: {
  open: boolean
  path: string
  onCancel: () => void
  // creates the share and resolves to the public url
  onCreate: (opts: { expires_in_secs: number | null; password?: string }) => Promise<string>
}) {
  const [expiry, setExpiry] = useState<number | null>(null)
  const [password, setPassword] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const urlField = useRef<HTMLInputElement>(null)

  const create = async () => {
    setBusy(true)
    setError('')
    try {
      setUrl(await props.onCreate({ expires_in_secs: expiry, password: password || undefined }))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    // clipboard api can be blocked on mobile; the read-only field still
    // supports tap-select and long-press copy
    const ok = await navigator.clipboard.writeText(url).then(() => true).catch(() => false)
    if (!ok) urlField?.current?.select()
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog open={props.open} onClose={props.onCancel}>
      <DialogTitle>Share “{props.path}”</DialogTitle>
      <DialogContent>
        {url ? (
          <Stack spacing={2} sx={{ pt: 1, minWidth: 420 }}>
            <TextField
              inputRef={urlField}
              fullWidth
              value={url}
              onFocus={e => e.target.select()}
              label="Share link"
              InputProps={{
                readOnly: true,
                sx: { fontFamily: '"Roboto Mono", monospace', fontSize: '0.8rem' },
                endAdornment: (
                  <InputAdornment position="end">
                    <Chip size="small" label="public" sx={{ borderRadius: 1 }} />
                  </InputAdornment>
                ),
              }}
            />
            <DialogContentText>
              Anyone with this link can download the file. Send it via any messenger.
            </DialogContentText>
          </Stack>
        ) : (
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error && <DialogContentText color="error">{error}</DialogContentText>}
            <TextField
              select
              label="Expires"
              value={String(expiry)}
              onChange={e => setExpiry(e.target.value === 'null' ? null : Number(e.target.value))}
            >
              {EXPIRY.map(o => (
                <MenuItem key={String(o.value)} value={String(o.value)}>
                  {o.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Password (optional)"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {url ? (
          <>
            <Button onClick={() => window.open(url, '_blank')} startIcon={<OpenInNew />}>
              Open Link
            </Button>
            <Button
              variant="contained"
              onClick={copy}
              startIcon={copied ? <CheckIcon /> : <ContentCopy />}
              color={copied ? 'success' : 'primary'}
            >
              {copied ? 'Copied!' : 'Copy Link'}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={props.onCancel}>Cancel</Button>
            <Button variant="contained" disabled={busy} onClick={create}>
              Create Share Link
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}

export function ConfirmDialog(props: {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={props.open} onClose={props.onCancel}>
      <DialogTitle>{props.title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{props.message}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button variant="contained" color="error" onClick={props.onConfirm}>
          {props.confirmLabel ?? 'Delete'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

