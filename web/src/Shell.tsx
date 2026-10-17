import { useEffect, useState } from 'react'
import {
  Badge, Box, Chip, Divider, Drawer, IconButton, List,
  ListItemButton, ListItemIcon, ListItemText, LinearProgress, Menu, MenuItem,
  Tooltip, Typography, useMediaQuery, useTheme,
} from '@mui/material'
import DescriptionRounded from '@mui/icons-material/DescriptionRounded'
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
import { useAuth } from './auth'
import { useUploads } from './uploads'
import { useThemeToggle } from './App'
import { CommandPalette } from './CommandPalette'

const DRAWER_W = 260

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

function DrawerNav({ onPick }: { onPick: () => void }) {
  const { user } = useAuth()
  const nav = useNavigate()
  const { pathname } = useLocation()

  const items: { label: string; icon: React.ReactNode; to: string; active?: boolean }[] = [
    { label: 'All Files', icon: <DescriptionRounded />, to: '/', active: pathname === '/' || pathname.startsWith('/f/') },
    { label: 'Images', icon: <ImageIcon />, to: '/c/image' },
    { label: 'Videos', icon: <MovieRounded />, to: '/c/video' },
    { label: 'Audio', icon: <AudiotrackRounded />, to: '/c/audio' },
    { label: 'Documents', icon: <ArticleRounded />, to: '/c/doc' },
    { label: 'Code', icon: <CodeRounded />, to: '/c/code' },
    { label: 'Archives', icon: <FolderZipRounded />, to: '/c/archive' },
    { label: 'Shared Links', icon: <ShareIcon />, to: '/shares', active: pathname.startsWith('/shares') },
    { label: 'Account & Sessions', icon: <SecurityRounded />, to: '/account', active: pathname.startsWith('/account') },
    ...(user?.is_admin
      ? [{ label: 'Users & Quotas', icon: <PeopleAltRounded />, to: '/users', active: pathname.startsWith('/users') }]
      : []),
  ]

  return (
    <List sx={{ flex: 1, overflowY: 'auto', py: 0 }}>
      <ListItemButton selected={items[0].active} onClick={() => { nav('/'); onPick() }} sx={{ borderRadius: 2, mx: 1 }}>
        <ListItemIcon sx={{ minWidth: 36 }}>{items[0].icon}</ListItemIcon>
        <ListItemText primary={items[0].label} slotProps={{ primary: { fontWeight: items[0].active ? 600 : 400 } }} />
      </ListItemButton>
      <Typography variant="caption" color="text.secondary" sx={{ px: 3, pt: 1.5, pb: 0.5 }}>
        Categories
      </Typography>
      {items.slice(1, 7).map(it => (
        <ListItemButton
          key={it.to}
          selected={!!it.active}
          onClick={() => { nav(it.to); onPick() }}
          sx={{ borderRadius: 2, mx: 1 }}
        >
          <ListItemIcon sx={{ minWidth: 36 }}>{it.icon}</ListItemIcon>
          <ListItemText primary={it.label} slotProps={{ primary: { fontWeight: it.active ? 600 : 400 } }} />
        </ListItemButton>
      ))}
      <Divider sx={{ my: 1 }} />
      {items.slice(7).map(it => (
        <ListItemButton
          key={it.to}
          selected={!!it.active}
          onClick={() => { nav(it.to); onPick() }}
          sx={{ borderRadius: 2, mx: 1 }}
        >
          <ListItemIcon sx={{ minWidth: 36 }}>{it.icon}</ListItemIcon>
          <ListItemText primary={it.label} slotProps={{ primary: { fontWeight: it.active ? 600 : 400 } }} />
        </ListItemButton>
      ))}
    </List>
  )
}

export default function Shell() {
  const { user, logout, refresh } = useAuth()
  const { mode, toggle } = useThemeToggle()
  const nav = useNavigate()
  const theme = useTheme()
  const compact = useMediaQuery(theme.breakpoints.down('md'))
  const { pendingCount } = useUploads()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)

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
    if (target.startsWith('cat:')) {
      nav(`/c/${target.slice(4)}`)
      return
    }
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
      <Box
        component="header"
        sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: theme.zIndex.appBar,
          ...surfaceBar,
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, minHeight: 56 }}>
          {compact && (
            <IconButton onClick={() => setDrawerOpen(true)} sx={{ color: 'text.primary' }}>
              <MenuIcon />
            </IconButton>
          )}
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

      <Drawer
        variant={compact ? 'temporary' : 'permanent'}
        open={compact ? drawerOpen : true}
        onClose={() => setDrawerOpen(false)}
        slotProps={{
          paper: {
            sx: {
              width: DRAWER_W,
              boxSizing: 'border-box',
              borderRight: '1px solid',
              borderColor: 'divider',
              display: 'flex',
              flexDirection: 'column',
            },
          },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 2, flexShrink: 0 }}>
          <Inventory2Rounded sx={{ color: 'primary.main' }} />
          <Typography variant="h6" noWrap fontWeight={700}>rbox</Typography>
          <Chip label="v0.1" size="small" sx={{ borderRadius: 1, height: 18, fontSize: '0.65rem' }} />
        </Box>
        <Divider />
        <DrawerNav onPick={() => setDrawerOpen(false)} />
        <QuotaCard compact={compact} />
      </Drawer>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          minWidth: 0,
          p: { xs: 1.5, sm: 2 },
          pt: { xs: '68px', sm: '72px' },
          width: { md: `calc(100% - ${DRAWER_W}px)` },
        }}
      >
        <Outlet />
      </Box>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenPath={openPaletteResult}
      />
    </Box>
  )
}
