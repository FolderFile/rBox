import { createTheme } from '@mui/material/styles'

// deep obsidian canvas with layered surfaces and real elevation; sharp 6px
// corners keep the product feeling like a tool, not a toy
const EASE = 'cubic-bezier(0.2, 0, 0, 1)'
export const MOTION = `background-color 150ms ${EASE}, transform 150ms ${EASE}, box-shadow 150ms ${EASE}, border-color 150ms ${EASE}`

// surfaces the shell and explorers reach for directly
export const SURFACE = {
  dark: {
    canvas: '#0a0c10',
    bar: '#11151d',
    paper: '#141923',
    tableHead: '#191f2c',
    rowHover: '#1c2331',
    border: '#1e2330',
  },
  light: {
    canvas: '#f1f5f9',
    bar: '#ffffff',
    paper: '#ffffff',
    tableHead: '#f8fafc',
    rowHover: '#eef2f7',
    border: '#e2e8f0',
  },
} as const

const darkShadow = {
  bar: '0 4px 20px rgba(0, 0, 0, 0.5)',
  card: '0 8px 28px rgba(0, 0, 0, 0.4)',
}
const lightShadow = {
  bar: '0 2px 12px rgba(15, 23, 42, 0.06)',
  card: '0 8px 24px rgba(15, 23, 42, 0.08)',
}

const FONT = '"Inter", "Segoe UI", "Helvetica Neue", Arial, sans-serif'

const base = {
  typography: {
    fontFamily: FONT,
    h6: { fontWeight: 700, letterSpacing: '-0.01em' },
    subtitle2: { fontWeight: 600 },
    button: { textTransform: 'none' as const, fontWeight: 600 },
  },
  shape: { borderRadius: 6 },
}

function shared(shadow: { bar: string; card: string }): any {
  return {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          borderRadius: 4,
          transition: `background-color 150ms ${EASE}, transform 150ms ${EASE}, box-shadow 150ms ${EASE}`,
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: { transition: `background-color 150ms ${EASE}, color 150ms ${EASE}, transform 150ms ${EASE}` },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: { root: { borderRadius: 4 } },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { transition: `background-color 150ms ${EASE}` },
        head: { fontWeight: 600 },
      },
    },
    MuiCard: {
      defaultProps: { variant: 'outlined' as const },
      styleOverrides: {
        root: {
          borderRadius: 6,
          boxShadow: shadow.card,
          transition: `transform 150ms ${EASE}, box-shadow 150ms ${EASE}, border-color 150ms ${EASE}`,
        },
      },
    },
    MuiDialog: {
      defaultProps: { fullWidth: true, maxWidth: 'sm' as const },
      styleOverrides: {
        // fullscreen surfaces (editor) sit flush against the viewport: no
        // rounded corner can ever let the page bleed through at the edges
        paper: {
          borderRadius: 6,
          border: 'none',
          margin: 0,
          '&.MuiDialog-paperFullScreen': {
            borderRadius: 0,
            border: 'none',
            margin: 0,
          },
        },
      },
    },
    MuiPaper: { defaultProps: { elevation: 0 } },
    MuiTable: { defaultProps: { size: 'small' as const } },
    MuiTextField: { defaultProps: { size: 'small' as const, variant: 'outlined' as const } },
    MuiButtonBase: { styleOverrides: { root: { borderRadius: 4 } } },
  }
}

export const light = createTheme({
  ...base,
  palette: {
    mode: 'light',
    primary: { main: '#e11d48' },
    secondary: { main: '#7c3aed' },
    background: { default: SURFACE.light.canvas, paper: SURFACE.light.paper },
    divider: SURFACE.light.border,
    text: { primary: '#0f172a', secondary: '#64748b' },
  },
  shadows: createTheme({ palette: { mode: 'light' } }).shadows,
  components: {
    ...shared(lightShadow),
    MuiTableHead: {
      styleOverrides: { root: { backgroundColor: SURFACE.light.tableHead } },
    },
    MuiTableRow: {
      styleOverrides: {
        root: { '&.MuiTableRow-hover:hover': { backgroundColor: SURFACE.light.rowHover } },
      },
    },
  },
})

export const dark = createTheme({
  ...base,
  palette: {
    mode: 'dark',
    primary: { main: '#f43f5e' },
    secondary: { main: '#a78bfa' },
    background: { default: SURFACE.dark.canvas, paper: SURFACE.dark.paper },
    divider: SURFACE.dark.border,
    text: { primary: '#e6e8ec', secondary: '#8b93a1' },
  },
  components: {
    ...shared(darkShadow),
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          '&.MuiMenu-paper, &.MuiPopover-paper, &.MuiDialog-paper': {
            backgroundColor: SURFACE.dark.paper,
            boxShadow: darkShadow.card,
          },
        },
      },
    },
    MuiTableHead: {
      styleOverrides: { root: { backgroundColor: SURFACE.dark.tableHead } },
    },
    MuiTableRow: {
      styleOverrides: {
        root: { '&.MuiTableRow-hover:hover': { backgroundColor: SURFACE.dark.rowHover } },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          '&.MuiChip-colorPrimary': {
            backgroundColor: 'rgba(244, 63, 94, 0.14)',
            color: '#fb7185',
          },
          '&.MuiChip-colorSuccess': {
            backgroundColor: 'rgba(16, 185, 129, 0.16)',
            color: '#34d399',
          },
        },
      },
    },
  },
})
