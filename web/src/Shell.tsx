import { useEffect, useState } from 'react'
import {
  Badge, Box, Chip, Divider, Drawer, IconButton, List,
  ListItemButton, ListItemText, LinearProgress, Menu, MenuItem,
  Tooltip, Typography, useMediaQuery, useTheme,
} from '@mui/material'
import FolderRounded from '@mui/icons-material/FolderRounded'
import ImageIcon from '@mui/icons-material/ImageRounded'
import MovieRounded from '@mui/icons-material/MovieRounded'
import AudiotrackRounded from '@mui/icons-material/AudiotrackRounded'
import ArticleRounded from '@mui/icons-material/ArticleRounded'
import CodeRounded from '@mui/icons-material/CodeRounded'
import FolderZipRounded from '@mui/icons-material/FolderZipRounded'
import ShareIcon from '@mui/icons-material/ShareRounded'
import PeopleAltRounded from '@mui/icons-material/PeopleAltRounded'
import SecurityRounded from '@mui/icons-material/SecurityRounded'
import Brightness4 from '@mui/icons-material/Brightness4Rounded'
import Brightness7 from '@mui/icons-material/Brightness7Rounded'
import MenuIcon from '@mui/icons-material/MenuRounded'
import Logout from '@mui/icons-material/LogoutRounded'
import SearchRounded from '@mui/icons-material/SearchRounded'
import AccountCircleRounded from '@mui/icons-material/AccountCircleRounded'
import CloudUploadRounded from '@mui/icons-material/CloudUploadRounded'
import RefreshRounded from '@mui/icons-material/RefreshRounded'
import Inventory2Rounded from '@mui/icons-material/Inventory2Rounded'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { api, fmtSize } from './api'
import { useUploads } from './uploads'
import { useAuth } from './auth'
import { useThemeToggle } from './App'
import { CommandPalette } from './CommandPalette'
import { kindBg, kindColor } from './filetypes'

const DRAWER_W = 240

const SECTION_SX = {
  textTransform: 'uppercase',
  fontSize: '0.70rem',
  fontWeight: 700,
  letterSpacing: '0.08em',
  color: 'text.secondary',
  pt: 2.5,
  pb: 0.75,
  px: 2.5,
}

const ITEM_SX = {
  borderRadius: 2,
  mx: 1.5,
  my: 0.5,
}

function NavBadge({
  icon, color, bg,
}: { icon: React.ReactNode; color: string; bg: string }) {
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 32,
        height: 32,
        borderRadius: '30%',
        bgcolor: bg,
        color,
        flexShrink: 0,
      }}
    >
      {icon}
    </Box>
  )
}

function QuotaCard({ compact }: { compact: boolean }) {
  const { user, refresh } = useAuth()
  const [busy, setBusy] = useState(false)
  if (!user) return null
  const pct = user.quota_bytes ? Math.min((user.used_bytes / user.quota_bytes) * 100, 100) : 0
  const recalc = async () => {
    setBusy(true)
    try {
      await api.post(`/api/admin/users/${encodeURIComponent(user.username)}/recalc`)
      await refresh()
    } catch {
      // non-admins and races are fine; the value revalidates on next load
    } finally {
      setBusy(false)
    }
  }
  return (
    <Box sx={{ p: 1.5, m: 1.5, borderRadius: 2, bgcolor: 'action.hover' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.75 }}>
        <Typography variant="body2" fontWeight={600} sx={{ flex: 1 }}>Storage</Typography>
        <Chip
          size="small"
          label={`${pct.toFixed(pct < 10 ? 1 : 0)}%`}
          color={pct > 95 ? 'error' : pct > 80 ? 'warning' : 'default'}
          sx={{ borderRadius: 2, height: 20 }}
        />
        {user.is_admin && (
          <Tooltip title="Recalculate usage">
            <IconButton size="small" onClick={recalc} disabled={busy} sx={{ ml: 0.5 }}>
              <RefreshRounded sx={{ fontSize: 15 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      <LinearProgress
        variant="determinate"
        value={pct}
        color={pct > 95 ? 'error' : pct > 80 ? 'warning' : 'primary'}
        sx={{ height: 6, borderRadius: 3 }}
      />
      {!compact && (
        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', mt: 0.5 }}>
          {fmtSize(user.used_bytes)} of {fmtSize(user.quota_bytes)}
        </Typography>
      )}
    </Box>
  )
}

function SidebarBody({ onPick }: { onPick: () => void }) {
  const { user } = useAuth()
  const nav = useNavigate()
  const { pathname } = useLocation()

  const folderItems = [
    { label: 'Images', to: '/f/Images', icon: <ImageIcon fontSize="small" />, color: kindColor.image, bg: kindBg.image },
    { label: 'Videos', to: '/f/Videos', icon: <MovieRounded fontSize="small" />, color: kindColor.video, bg: kindBg.video },
    { label: 'Audio', to: '/f/Audio', icon: <AudiotrackRounded fontSize="small" />, color: kindColor.audio, bg: kindBg.audio },
    { label: 'Documents', to: '/f/Documents', icon: <ArticleRounded fontSize="small" />, color: kindColor.doc, bg: kindBg.doc },
    { label: 'Code', to: '/f/Code', icon: <CodeRounded fontSize="small" />, color: kindColor.code, bg: kindBg.code },
    { label: 'Archives', to: '/f/Archives', icon: <FolderZipRounded fontSize="small" />, color: kindColor.archive, bg: kindBg.archive },
  ]
  const isAt = (to: string) => {
    if (to === '/') return pathname === '/' || pathname.startsWith('/f/')
    return pathname === to || pathname.startsWith(`${to}/`)
  }
  const item = (it: { label: string; to: string; icon: React.ReactNode; color: string; bg: string }) => (
    <ListItemButton
      key={it.to}
      selected={isAt(it.to)}
      onClick={() => { nav(it.to); onPick() }}
      sx={ITEM_SX}
    >
      <NavBadge icon={it.icon} color={it.color} bg={it.bg} />
      <ListItemText
        primary={it.label}
        slotProps={{ primary: { fontWeight: isAt(it.to) ? 600 : 400 } }}
        sx={{ ml: 1.5 }}
      />
    </ListItemButton>
  )

  return (
    <Box sx={{ width: DRAWER_W, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2.5, py: 2.25, flexShrink: 0 }}>
        <Inventory2Rounded sx={{ color: 'primary.main' }} />
        <Typography variant="h6" noWrap fontWeight={700}>rbox</Typography>
        <Chip label="v0.2" size="small" sx={{ borderRadius: 1, height: 18, fontSize: '0.65rem' }} />
      </Box>
      <Divider />
      <List sx={{ flex: 1, overflowY: 'auto', py: 0, whiteSpace: 'nowrap' }}>
        <Typography variant="body2" sx={SECTION_SX}>Workspace</Typography>
        {item({
          label: 'All Files', to: '/',
          icon: <FolderRounded fontSize="small" />,
          color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.14)',
        })}
        {item({
          label: 'Shared Links', to: '/shares',
          icon: <ShareIcon fontSize="small" />,
          color: kindColor.video, bg: kindBg.video,
        })}
        <Typography variant="body2" sx={SECTION_SX}>Folders</Typography>
        {folderItems.map(item)}
        <Typography variant="body2" sx={SECTION_SX}>System</Typography>
        {item({
          label: 'Account & Sessions', to: '/account',
          icon: <SecurityRounded fontSize="small" />,
          color: kindColor.doc, bg: kindBg.doc,
        })}
        {user?.is_admin && item({
          label: 'Users & Quotas', to: '/users',
          icon: <PeopleAltRounded fontSize="small" />,
          color: kindColor.code, bg: kindBg.code,
        })}
      </List>
      <QuotaCard compact={false} />
    </Box>
  )
}

export default function Shell() {
  const { user, logout, refresh } = useAuth()
  const { mode, toggle } = useThemeToggle()
  const nav = useNavigate()
  const theme = useTheme()
  const md = useMediaQuery(theme.breakpoints.up('md'))
  const { pendingCount } = useUploads()
  // open by default on desktop, closed on mobile; the breakpoint crossing
  // resnaps the default
  const [sidebarOpen, setSidebarOpen] = useState(md)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => { setSidebarOpen(md) }, [md])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(o => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const doLogout = async () => {
    setAnchor(null)
    await logout()
    nav('/login')
  }

  const openPaletteResult = (target: string, isDir: boolean) => {
    if (isDir) {
      nav(`/f/${target}`)
    } else {
      const i = target.lastIndexOf('/')
      if (i > 0) nav(`/f/${target.slice(0, i)}?focus=${encodeURIComponent(target.slice(i + 1))}`)
      else nav(`/?focus=${encodeURIComponent(target)}`)
    }
  }

  const surfaceBar =
    theme.palette.mode === 'dark'
      ? { bgcolor: 'rgba(15,17,21,0.85)' }
      : { bgcolor: 'rgba(248,250,252,0.85)' }

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {/* desktop rail: a flex child, so the app bar and content are pushed
          beside it and can never slide underneath */}
      <Box
        component="nav"
        sx={{
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
          width: sidebarOpen ? DRAWER_W : 0,
          flexShrink: 0,
          overflow: 'hidden',
          transition: 'width 200ms cubic-bezier(0.2, 0, 0, 1)',
        }}
      >
        <SidebarBody onPick={() => {}} />
      </Box>

      {!md && (
        <Drawer
          variant="temporary"
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          slotProps={{
            paper: {
              sx: {
                width: DRAWER_W,
                boxSizing: 'border-box',
                borderRight: '1px solid',
                borderColor: 'divider',
              },
            },
          }}
        >
          <SidebarBody onPick={() => setSidebarOpen(false)} />
        </Drawer>
      )}

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Box
          component="header"
          sx={{
            position: 'sticky',
            top: 0,
            zIndex: theme.zIndex.appBar,
            ...surfaceBar,
            backdropFilter: 'blur(12px)',
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, minHeight: 56 }}>
            <Tooltip title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}>
              <IconButton
                aria-label="Toggle sidebar"
                onClick={() => setSidebarOpen(o => !o)}
                sx={{ color: 'text.primary' }}
              >
                <MenuIcon />
              </IconButton>
            </Tooltip>
            <Box
              onClick={() => setPaletteOpen(true)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                flex: 1,
                maxWidth: 480,
                cursor: 'text',
                borderRadius: 2,
                px: 1.5,
                py: 0.75,
                bgcolor: 'action.hover',
                transition: 'background-color 150ms cubic-bezier(0.2, 0, 0, 1)',
                '&:hover': { bgcolor: 'action.selected' },
              }}
            >
              <SearchRounded sx={{ fontSize: 18, color: 'text.secondary' }} />
              <Typography variant="body2" color="text.secondary" sx={{ flex: 1, display: { xs: 'none', sm: 'block' } }}>
                Search files or press Ctrl+K
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ flex: 1, display: { xs: 'block', sm: 'none' } }}>
                Search
              </Typography>
              <Chip
                label="Ctrl K"
                size="small"
                sx={{
                  display: { xs: 'none', md: 'flex' },
                  borderRadius: 1,
                  height: 18,
                  fontSize: '0.65rem',
                  bgcolor: 'transparent',
                  border: '1px solid',
                  borderColor: 'divider',
                }}
              />
            </Box>
            <Box sx={{ flex: 1 }} />
            {pendingCount > 0 && (
              <Tooltip title={`${pendingCount} upload${pendingCount > 1 ? 's' : ''} in progress`}>
                <Badge badgeContent={pendingCount} color="primary">
                  <CloudUploadRounded sx={{ color: 'text.secondary', mx: 0.5 }} />
                </Badge>
              </Tooltip>
            )}
            <Tooltip title={mode === 'dark' ? 'Light mode' : 'Dark mode'}>
              <IconButton onClick={toggle} sx={{ color: 'text.secondary' }}>
                {mode === 'dark' ? <Brightness7 /> : <Brightness4 />}
              </IconButton>
            </Tooltip>
            <Tooltip title="Account">
              <IconButton onClick={e => setAnchor(e.currentTarget)} sx={{ color: 'text.primary' }}>
                <AccountCircleRounded />
              </IconButton>
            </Tooltip>
            <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
              <MenuItem disabled>
                {user?.username}{user?.is_admin ? ' (admin)' : ''}
              </MenuItem>
              <MenuItem onClick={() => { setAnchor(null); nav('/account'); refresh() }}>
                <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', mr: 1 }}><SecurityRounded fontSize="small" /></Box> Account &amp; Sessions
              </MenuItem>
              <MenuItem onClick={doLogout}>
                <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', mr: 1 }}><Logout fontSize="small" /></Box> Sign out
              </MenuItem>
            </Menu>
          </Box>
        </Box>

        <Box sx={{ p: { xs: 1.5, sm: 2 }, flexGrow: 1 }}>
          <Outlet />
        </Box>
      </Box>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenPath={openPaletteResult}
      />
    </Box>
  )
}