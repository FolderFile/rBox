import { createTheme } from '@mui/material/styles'

// classic MD2 crimson red, not the M3 tonal palette
const base = {
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
    button: { textTransform: 'none' as const },
  },
  shape: { borderRadius: 4 },
}

export const light = createTheme({
  ...base,
  palette: {
    primary: { main: '#d32f2f' },
    secondary: { main: '#dc004e' },
    background: { default: '#fafafa', paper: '#ffffff' },
  },
  components: {
    MuiTable: { defaultProps: { size: 'small' } },
    MuiButton: { defaultProps: { size: 'small', disableElevation: false } },
    MuiTextField: { defaultProps: { size: 'small', variant: 'outlined' } },
    MuiPaper: { defaultProps: { elevation: 1 } },
    MuiAppBar: { defaultProps: { elevation: 4 } },
    MuiDialog: { defaultProps: { fullWidth: true, maxWidth: 'sm' } },
  },
})

export const dark = createTheme({
  ...base,
  palette: {
    mode: 'dark',
    primary: { main: '#e53935' },
    secondary: { main: '#f50057' },
    background: { default: '#121212', paper: '#1e1e1e' },
  },
  components: {
    MuiTable: { defaultProps: { size: 'small' } },
    MuiButton: { defaultProps: { size: 'small', disableElevation: false } },
    MuiTextField: { defaultProps: { size: 'small', variant: 'outlined' } },
    MuiPaper: { defaultProps: { elevation: 1 } },
    MuiAppBar: { defaultProps: { elevation: 4 } },
    MuiDialog: { defaultProps: { fullWidth: true, maxWidth: 'sm' } },
  },
})