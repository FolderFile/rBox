import { createTheme } from '@mui/material/styles'

// M3-tonal surfaces: soft elevation instead of hard MD2 bars; crimson-rose
// accent instead of a solid red app bar
const EASE = 'cubic-bezier(0.2, 0, 0, 1)'

const base = {
  typography: {
    fontFamily: '"Roboto", "Helvetica Neue", "Segoe UI", sans-serif',
    h6: { fontWeight: 600 },
    button: { textTransform: 'none' as const, fontWeight: 600 },
  },
  shape: { borderRadius: 10 },
}

const transitions = {
  MuiButton: {
    defaultProps: { disableElevation: true },
    styleOverrides: {
      root: { transition: `background-color 150ms ${EASE}, transform 150ms ${EASE}, box-shadow 150ms ${EASE}` },
    },
  },
  MuiIconButton: {
    styleOverrides: {
      root: { transition: `background-color 150ms ${EASE}, color 150ms ${EASE}, transform 150ms ${EASE}` },
    },
  },
  MuiTableCell: {
    styleOverrides: {
      root: { transition: `background-color 150ms ${EASE}` },
    },
  },
  MuiCard: {
    defaultProps: { variant: 'outlined' as const },
    styleOverrides: {
      root: { transition: `transform 150ms ${EASE}, box-shadow 150ms ${EASE}, border-color 150ms ${EASE}` },
    },
  },
  MuiTextField: { defaultProps: { size: 'small' as const, variant: 'outlined' as const } },
  MuiDialog: {
    defaultProps: { fullWidth: true, maxWidth: 'sm' as const },
    styleOverrides: { paper: { borderRadius: 10 } },
  },
  MuiPaper: { defaultProps: { elevation: 0 } },
  MuiTable: { defaultProps: { size: 'small' as const } },
  MuiButtonBase: {
    styleOverrides: { root: { borderRadius: 8 } },
  },
}

export const light = createTheme({
  ...base,
  palette: {
    mode: 'light',
    primary: { main: '#e11d48' },
    secondary: { main: '#7c3aed' },
    background: { default: '#f8fafc', paper: '#ffffff' },
    divider: '#e2e8f0',
    text: { primary: '#0f172a', secondary: '#64748b' },
  },
  components: {
    ...transitions,
    MuiTextField: { defaultProps: { size: 'small' as const, variant: 'outlined' as const } },
  },
})

export const dark = createTheme({
  ...base,
  palette: {
    mode: 'dark',
    primary: { main: '#f43f5e' },
    secondary: { main: '#a78bfa' },
    background: { default: '#0f1115', paper: '#161920' },
    divider: 'rgba(255,255,255,0.07)',
    text: { primary: '#e6e8ec', secondary: '#8b93a1' },
  },
  components: {
    ...transitions,
    MuiTextField: { defaultProps: { size: 'small' as const, variant: 'outlined' as const } },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          '&.MuiMenu-paper, &.MuiPopover-paper, &.MuiDialog-paper': {
            backgroundColor: '#1c2029',
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          '&.MuiChip-colorPrimary': {
            backgroundColor: 'rgba(244, 63, 94, 0.14)',
            color: '#fb7185',
          },
        },
      },
    },
  },
})