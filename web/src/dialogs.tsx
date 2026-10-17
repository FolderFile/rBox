import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, MenuItem, Stack, TextField } from '@mui/material'
import { useState } from 'react'

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
  onShare: (opts: { expires_in_secs: number | null; password?: string }) => void
}) {
  const [expiry, setExpiry] = useState<number | null>(null)
  const [password, setPassword] = useState('')
  return (
    <Dialog open={props.open} onClose={props.onCancel}>
      <DialogTitle>Share “{props.path}”</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
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
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() =>
            props.onShare({ expires_in_secs: expiry, password: password || undefined })
          }
        >
          Create link
        </Button>
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

