import { Box, Divider, Drawer, IconButton, List, ListItemButton, ListItemIcon, ListItemText, LinearProgress, Tooltip, Typography, useMediaQuery, useTheme, InputBase, Menu, MenuItem } from '@mui/material'
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined'
import ShareIcon from '@mui/icons-material/Share'
import PeopleAltOutlined from '@mui/icons-material/PeopleAltOutlined'
import Brightness4 from '@mui/icons-material/Brightness4'
import Brightness7 from '@mui/icons-material/Brightness7'
import MenuIcon from '@mui/icons-material/Menu'
import Logout from '@mui/icons-material/Logout'
import SearchIcon from '@mui/icons-material/Search'
import AccountCircleOutlined from '@mui/icons-material/AccountCircleOutlined'
import { useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { fmtSize } from './api'
import { useAuth } from './auth'
import { UploadProvider } from './uploads'
import { useThemeToggle } from './App'

const DRAWER_W = 240

export function QuotaBar() {
  const { user } = useAuth()
  if (!user) return null
  const pct = user.quota_bytes ? (user.used_bytes / user.quota_bytes) * 100 : 0
  return (
    <Box sx={{ px: 2, py: 1 }}>
      <Typography variant="body2" noWrap sx={{ mb: 0.5 }}>
        {fmtSize(user.used_bytes)} of {fmtSize(user.quota_bytes)} used
      </Typography>
      <LinearProgress
        variant="determinate"
        value={Math.min(pct, 100)}
        color={pct > 95 ? 'error' : pct > 80 ? 'warning' : 'primary'}
        sx={{ height: 8, borderRadius: 4 }}
      />
    </Box>
  )
}

function DrawerNav({ onPick }: { onPick: () => void }) {
  const { user } = useAuth()
  const nav = useNavigate()
  const { pathname } = useLocation()
  const items = [
    { label: 'My Files', icon: <DescriptionOutlined />, to: '/' },
    { label: 'Shared Links', icon: <ShareIcon />, to: '/shares' },
    ...(user?.is_admin ? [{ label: 'Users (Admin)', icon: <PeopleAltOutlined />, to: '/users' }] : []),
  ]
  return (
    <List>
      {items.map(it => (
        <ListItemButton key={it.to} selected={pathname === it.to} onClick={() => { nav(it.to); onPick() }}>
          <ListItemIcon sx={{ minWidth: 36 }}>{it.icon}</ListItemIcon>
          <ListItemText primary={it.label} />
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
  const { pathname } = useLocation()
  const onFiles = pathname === '/' || pathname.startsWith('/f/')
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [search, setSearch] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    // the explorer reads the filter through this event; a context for one
    // string would be overkill
    const t = setTimeout(() => window.dispatchEvent(new CustomEvent('rbox:filter', { detail: search })), 150)
    return () => clearTimeout(t)
  }, [search])

  const doLogout = async () => {
    setAnchor(null)
    await logout()
    nav('/login')
  }

  return (
    <Box sx={{ display: 'flex' }}>
      <Box
        component="header"
        sx={{
          position: 'fixed',
          width: { xs: '100%', md: `calc(100% - ${DRAWER_W}px)` },
          ml: { md: `${DRAWER_W}px` },
          zIndex: theme.zIndex.appBar,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', bgcolor: 'primary.main', color: 'primary.contrastText', px: 1, minHeight: 48 }}>
          {compact && (
            <IconButton color="inherit" edge="start" onClick={() => setDrawerOpen(true)} sx={{ mr: 0.5 }}>
              <MenuIcon />
            </IconButton>
          )}
          {onFiles && (
            <Box sx={{ display: 'flex', alignItems: 'center', ml: { xs: 0, md: 2 }, bgcolor: 'rgba(255,255,255,0.15)', borderRadius: 1, px: 1, width: { xs: '50%', sm: 220 } }}>
              <SearchIcon fontSize="small" />
              <InputBase
                placeholder="Filter…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                sx={{ ml: 1, flex: 1, color: 'inherit', fontSize: '0.85rem' }}
                inputProps={{ 'aria-label': 'filter files' }}
              />
            </Box>
          )}
          <Box sx={{ flex: 1 }} />
          <Tooltip title={mode === 'dark' ? 'Light mode' : 'Dark mode'}>
            <IconButton color="inherit" onClick={toggle} size="small" sx={{ mx: 0.5 }}>
              {mode === 'dark' ? <Brightness7 /> : <Brightness4 />}
            </IconButton>
          </Tooltip>
          <IconButton color="inherit" onClick={e => setAnchor(e.currentTarget)} size="small" sx={{ mx: 0.5 }}>
            <AccountCircleOutlined />
          </IconButton>
          <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
            <MenuItem disabled>
              {user?.username}{user?.is_admin ? ' (admin)' : ''}
            </MenuItem>
            <MenuItem onClick={doLogout}>
              <Logout fontSize="small" sx={{ mr: 1 }} /> Sign out
            </MenuItem>
          </Menu>
        </Box>
      </Box>

      <Drawer
        variant={compact ? 'temporary' : 'permanent'}
        open={compact ? drawerOpen : true}
        onClose={() => setDrawerOpen(false)}
        sx={{
          width: DRAWER_W,
          flexShrink: 0,
          '& .MuiDrawer-paper': { width: DRAWER_W, boxSizing: 'border-box' },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', minHeight: 48, px: 2 }}>
          <Typography variant="h6" noWrap sx={{ fontWeight: 500 }}>rbox</Typography>
        </Box>
        <Divider />
        <DrawerNav onPick={() => setDrawerOpen(false)} />
        <Box sx={{ flex: 1 }} />
        <Divider />
        <QuotaBar />
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1, p: 2, minWidth: 0, mt: 6 }}>
        <UploadProvider
          onDone={() => {
            refresh()
            window.dispatchEvent(new Event('rbox:refresh'))
          }}
        >
          <Outlet />
        </UploadProvider>
      </Box>
    </Box>
  )
}