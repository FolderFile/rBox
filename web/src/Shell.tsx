import { Suspense, useEffect, useState } from 'react'
import {
  Avatar, Badge, Box, Chip, CircularProgress, Divider, Drawer, IconButton, List,
  ListItemButton, ListItemIcon, ListItemText, LinearProgress, Menu, MenuItem,
  Tooltip, Typography, useMediaQuery, useTheme,
} from '@mui/material'
import FolderRounded from '@mui/icons-material/FolderRounded'
import ShareIcon from '@mui/icons-material/ShareRounded'
import PeopleAltRounded from '@mui/icons-material/PeopleAltRounded'
import SettingsRounded from '@mui/icons-material/SettingsRounded'
import Brightness4 from '@mui/icons-material/Brightness4Rounded'
import Brightness7 from '@mui/icons-material/Brightness7Rounded'
import MenuIcon from '@mui/icons-material/MenuRounded'
import Logout from '@mui/icons-material/LogoutRounded'
import SearchRounded from '@mui/icons-material/SearchRounded'
import CloudUploadRounded from '@mui/icons-material/CloudUploadRounded'
import RefreshRounded from '@mui/icons-material/RefreshRounded'
import FolderZipRounded from '@mui/icons-material/FolderZipRounded'
import ImageRounded from '@mui/icons-material/ImageRounded'
import MovieRounded from '@mui/icons-material/MovieRounded'
import AudiotrackRounded from '@mui/icons-material/AudiotrackRounded'
import DescriptionRounded from '@mui/icons-material/DescriptionRounded'
import CodeRounded from '@mui/icons-material/CodeRounded'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { api, fmtPercent, fmtSize } from './api'
import { useUploads } from './uploads'
import { useAuth } from './auth'
import { useThemeToggle } from './theme-ctx'
import { Wordmark } from './Wordmark'
import { CommandPalette } from './CommandPalette'
import { getEntryVisuals } from './fileicons'
import { DEFAULT_FOLDERS, kindBg, kindColor } from './filetypes'
import { SURFACE } from './theme'

export const DRAWER_W = 220

// deterministic hue per name, so a user keeps their color everywhere
export function UserAvatar({ name, size = 28 }: { name: string; size?: number }) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360
  return (
    <Avatar
      aria-hidden
      sx={{
        width: size, height: size, fontSize: size * 0.42, fontWeight: 700,
        bgcolor: `hsl(${h}, 62%, 46%)`, color: '#fff',
      }}
    >
      {(name[0] ?? '?').toUpperCase()}
    </Avatar>
  )
}

const SECTION_SX = {
  textTransform: 'uppercase',
  fontSize: '0.675rem',
  fontWeight: 700,
  letterSpacing: '0.08em',
  color: 'text.secondary',
  pt: 1.25,
  pb: 0.5,
  px: 2,
}

// compact enough that every section plus the storage card fits a 768p laptop
const ITEM_SX = {
  borderRadius: 1.5,
  mx: 1,
  my: 0.25,
  py: 0.4,
  px: 1.25,
  minHeight: 32,
}

function NavBadge({ icon, color, bg }: { icon: React.ReactNode; color: string; bg: string }) {
  return (
    <Box
      sx={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 26, height: 26, borderRadius: 1, bgcolor: bg, color, flexShrink: 0,
      }}
    >
      {icon}
    </Box>
  )
}

function QuotaCard() {
  const { user, refresh } = useAuth()
  const [busy, setBusy] = useState(false)
  if (!user) return null
  const ratio = user.quota_bytes ? user.used_bytes / user.quota_bytes : 0
  const pct = Math.min(ratio * 100, 100)
  // a non-empty vault always shows a sliver, so the bar never reads as empty
  const shown = user.used_bytes > 0 ? Math.max(pct, 1.5) : 0
  const tone = pct > 95 ? 'error' : pct > 80 ? 'warning' : 'primary'
  const recalc = async () => {
    setBusy(true)
    try {
      await api.post(`/api/admin/users/${encodeURIComponent(user.username)}/recalc`)
      await refresh()
    } catch {
      // non-admins hit the same endpoint harmlessly on next load
    } finally {
      setBusy(false)
    }
  }
  return (
    <Box sx={{ p: 1.5, m: 1.25, mt: 1, borderRadius: 1.5, border: '1px solid', borderColor: 'divider', flexShrink: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', mb: 0.75 }}>
        <Typography variant="body2" fontWeight={600} sx={{ flex: 1 }}>Storage</Typography>
        <Typography
          variant="caption"
          fontWeight={600}
          color={tone === 'primary' ? 'text.secondary' : `${tone}.main`}
          sx={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {fmtPercent(user.used_bytes, user.quota_bytes)}
        </Typography>
        {user.is_admin && (
          <Tooltip title="Recalculate usage from disk">
            <span>
              <IconButton aria-label="Recalculate usage" size="small" onClick={recalc} disabled={busy} sx={{ ml: 0.25, my: -0.5, mr: -0.75 }}>
                <RefreshRounded sx={{ fontSize: 15, animation: busy ? 'rbox-spin 900ms linear infinite' : 'none', '@keyframes rbox-spin': { to: { transform: 'rotate(360deg)' } } }} />
              </IconButton>
            </span>
          </Tooltip>
        )}
      </Box>
      <LinearProgress
        variant="determinate"
        value={shown}
        color={tone}
        aria-label={`Storage ${fmtPercent(user.used_bytes, user.quota_bytes)} used`}
        sx={{ height: 6, borderRadius: 3 }}
      />
      <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', mt: 0.75 }}>
        <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>{fmtSize(user.used_bytes)}</Box>
        {' '}of {fmtSize(user.quota_bytes)} used
      </Typography>
    </Box>
  )
}

// sidebar-size icons keyed by the same iconKey vocabulary FileBadge emits
const SIDEBAR_ICONS: Record<string, React.ElementType> = {
  image: ImageRounded,
  movie: MovieRounded,
  audio: AudiotrackRounded,
  doc: DescriptionRounded,
  code: CodeRounded,
  archive: FolderZipRounded,
  folder: FolderRounded,
  share: ShareIcon,
  settings: SettingsRounded,
  users: PeopleAltRounded,
}

function SidebarIcon({ iconKey, color }: { iconKey: string; color: string }) {
  const Icon = SIDEBAR_ICONS[iconKey] ?? FolderRounded
  return <Icon sx={{ fontSize: 18, color }} />
}

function SidebarBody({ onPick }: { onPick: () => void }) {
  const { user } = useAuth()
  const nav = useNavigate()
  const { pathname } = useLocation()

  // folder icons are resolved through the same helper the explorer uses, so
  // a "Code" folder in the sidebar and in My Files wear the same badge
  const folderItems = DEFAULT_FOLDERS.map(name => {
    const v = getEntryVisuals({ name, is_dir: true })
    return { label: name, to: `/f/${name}`, iconKey: v.iconKey, color: v.color, bg: v.bg }
  })
  const shortcut = DEFAULT_FOLDERS.find(name => {
    const to = `/f/${encodeURIComponent(name)}`
    return pathname === to || pathname.startsWith(`${to}/`) || pathname === `/f/${name}` || pathname.startsWith(`/f/${name}/`)
  })
  const isAt = (to: string) => {
    if (to === '/') return (pathname === '/' || pathname.startsWith('/f/')) && !shortcut
    if (to.startsWith('/f/')) return to === `/f/${shortcut}`
    return pathname === to || pathname.startsWith(`${to}/`)
  }
  const item = (it: { label: string; to: string; iconKey: string; color: string; bg: string }) => (
    <ListItemButton
      key={it.to}
      selected={isAt(it.to)}
      aria-current={isAt(it.to) ? 'page' : undefined}
      onClick={() => { nav(it.to); onPick() }}
      sx={ITEM_SX}
    >
      <NavBadge icon={<SidebarIcon iconKey={it.iconKey} color={it.color} />} color={it.color} bg={it.bg} />
      <ListItemText
        primary={it.label}
        slotProps={{ primary: { fontWeight: isAt(it.to) ? 600 : 400, fontSize: '0.8125rem' } }}
        sx={{ ml: 1.25 }}
      />
    </ListItemButton>
  )

  return (
    <Box sx={{
      width: DRAWER_W, display: 'flex', flexDirection: 'column', height: '100%',
      overflowX: 'hidden',
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.5, flexShrink: 0 }}>
        <Wordmark />
        {user?.version && (
          <Chip label={`v${user.version}`} size="small" sx={{ borderRadius: 1, height: 18, fontSize: '0.65rem', fontVariantNumeric: 'tabular-nums' }} />
        )}
      </Box>
      <Divider sx={{ opacity: 0.7 }} />
      <List sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', py: 0, whiteSpace: 'nowrap' }}>
        <Typography variant="body2" sx={SECTION_SX}>Workspace</Typography>
        {item({
          label: 'All Files', to: '/',
          iconKey: 'folder',
          color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.14)',
        })}
        {item({
          label: 'Shared Links', to: '/shares',
          iconKey: 'share',
          color: kindColor.video, bg: kindBg.video,
        })}
        <Typography variant="body2" sx={SECTION_SX}>Folders</Typography>
        {folderItems.map(item)}
        <Typography variant="body2" sx={SECTION_SX}>System</Typography>
        {item({
          label: 'Settings', to: '/settings',
          iconKey: 'settings',
          color: kindColor.doc, bg: kindBg.doc,
        })}
        {user?.is_admin && item({
          label: 'Users & Quotas', to: '/users',
          iconKey: 'users',
          color: kindColor.code, bg: kindBg.code,
        })}
      </List>
      <QuotaCard />
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

  const bar = SURFACE[theme.palette.mode]
  const surfaceBar = {
    bgcolor: bar.bar,
    boxShadow: bar === SURFACE.dark ? '0 4px 20px rgba(0,0,0,0.5)' : '0 2px 12px rgba(15,23,42,0.06)',
    borderBottom: '1px solid',
    borderColor: 'divider',
  }

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', maxWidth: '100vw', overflowX: 'hidden', boxSizing: 'border-box' }}>
      {/* desktop rail: a flex child in the layout flow, so the app bar and
          content are pushed beside it and can never slide underneath */}
      <Box
        component="nav"
        sx={{
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
          width: sidebarOpen ? DRAWER_W : 0,
          flexShrink: 0,
          overflow: 'hidden',
          overflowX: 'hidden',
          transition: 'width 200ms cubic-bezier(0.2, 0, 0, 1)',
          bgcolor: bar.bar,
          borderRight: sidebarOpen ? '1px solid' : 'none',
          borderColor: 'divider',
          // the rail floats on top of the canvas
          boxShadow: sidebarOpen && theme.palette.mode === 'dark' ? '0 0 28px rgba(0,0,0,0.35)' : 'none',
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
                bgcolor: bar.bar,
                overflowX: 'hidden',
              },
            },
          }}
        >
          <SidebarBody onPick={() => setSidebarOpen(false)} />
        </Drawer>
      )}

      <Box component="main" sx={{
        flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
        maxWidth: '100%', overflowX: 'hidden',
      }}>
        <Box
          component="header"
          sx={{
            position: 'sticky',
            top: 0,
            zIndex: theme.zIndex.appBar,
            ...surfaceBar,
            overflowX: 'hidden',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, minHeight: 48, maxWidth: '100%', overflowX: 'hidden' }}>
            <Tooltip title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}>
              <IconButton
                aria-label="Toggle sidebar"
                onClick={() => setSidebarOpen(o => !o)}
                sx={{ color: 'text.primary', flexShrink: 0 }}
              >
                <MenuIcon />
              </IconButton>
            </Tooltip>
            {!md && <Wordmark size={20} />}
            <Box
              role="button"
              tabIndex={0}
              aria-label="Search files (Ctrl+K)"
              onClick={() => setPaletteOpen(true)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setPaletteOpen(true)
                }
              }}
              sx={{
                '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' },
                display: 'flex', alignItems: 'center', gap: 1, flex: 1,
                maxWidth: 420, cursor: 'text', borderRadius: 1,
                px: 1.5, py: 0.5, mx: { xs: 0, sm: 1 },
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
                label="Ctrl K" size="small"
                sx={{ display: { xs: 'none', md: 'flex' }, borderRadius: 1, height: 18, fontSize: '0.65rem', bgcolor: 'transparent', border: '1px solid', borderColor: 'divider' }}
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
              <IconButton aria-label="Toggle theme" onClick={toggle} sx={{ color: 'text.secondary' }}>
                {mode === 'dark' ? <Brightness7 /> : <Brightness4 />}
              </IconButton>
            </Tooltip>
            <Tooltip title="Account">
              <IconButton
                aria-label="Account menu"
                aria-haspopup="menu"
                aria-expanded={!!anchor}
                onClick={e => setAnchor(e.currentTarget)}
                sx={{ p: 0.5, ml: 0.25 }}
              >
                <UserAvatar name={user?.username ?? ''} size={28} />
              </IconButton>
            </Tooltip>
            <Menu
              anchorEl={anchor}
              open={!!anchor}
              onClose={() => setAnchor(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
              slotProps={{ paper: { sx: { minWidth: 220, mt: 0.5 } } }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 2, py: 1.25 }}>
                <UserAvatar name={user?.username ?? ''} size={34} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={600} noWrap>{user?.username}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {user?.is_admin ? 'Administrator' : 'Member'}
                  </Typography>
                </Box>
              </Box>
              <Divider sx={{ my: 0.5 }} />
              <MenuItem onClick={() => { setAnchor(null); nav('/settings'); refresh() }}>
                <ListItemIcon><SettingsRounded fontSize="small" /></ListItemIcon> Settings
              </MenuItem>
              <MenuItem onClick={() => { setAnchor(null); toggle() }}>
                <ListItemIcon>{mode === 'dark' ? <Brightness7 fontSize="small" /> : <Brightness4 fontSize="small" />}</ListItemIcon>
                {mode === 'dark' ? 'Light mode' : 'Dark mode'}
              </MenuItem>
              <Divider sx={{ my: 0.5 }} />
              <MenuItem onClick={doLogout}>
                <ListItemIcon><Logout fontSize="small" /></ListItemIcon> Sign out
              </MenuItem>
            </Menu>
          </Box>
        </Box>

        <Box sx={{ p: { xs: 1.25, sm: 1.5 }, flexGrow: 1, maxWidth: '100%', boxSizing: 'border-box' }}>
          {/* settings, shares and users are split into their own chunks */}
          <Suspense
            fallback={
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                <CircularProgress size={22} />
              </Box>
            }
          >
            <Outlet />
          </Suspense>
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
