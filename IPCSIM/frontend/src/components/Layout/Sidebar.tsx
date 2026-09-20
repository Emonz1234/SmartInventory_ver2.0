import { Drawer, List, ListItem, ListItemIcon, ListItemText, Divider, Typography, Box } from '@mui/material'
import { NavLink } from 'react-router-dom'
import {
  Dashboard,
  Inventory2,
  StorageOutlined,
  Cloud,
  HistoryOutlined,
  Settings,
  Build,
  ReceiptLong,
  TrendingUp
} from '@mui/icons-material'
import { useAuthStore } from '@store/authStore'

const DRAWER_WIDTH = 250

const menuItems = [
  { label: 'Dashboard', icon: Dashboard, path: '/', minRole: 'OPERATOR' },
  { label: 'Inventory', icon: Inventory2, path: '/inventory', minRole: 'OPERATOR' },
  { label: 'Cabinets', icon: StorageOutlined, path: '/cabinets', minRole: 'OPERATOR' },
  { label: 'Transactions', icon: ReceiptLong, path: '/transactions', minRole: 'OPERATOR' },
  { label: 'Breakdown', icon: HistoryOutlined, path: '/breakdown', minRole: 'OPERATOR' },
  { label: 'Environment', icon: Cloud, path: '/environment', minRole: 'OPERATOR' },
  { label: 'Operation', icon: TrendingUp, path: '/operation', minRole: 'OPERATOR' },
  { label: 'Logs', icon: HistoryOutlined, path: '/logs', minRole: 'OPERATOR' },
  { label: 'System', icon: Settings, path: '/system', minRole: 'OPERATOR' }
]

export const Sidebar = () => {
  const user = useAuthStore((s) => s.user)
  const canAccess = useAuthStore((s) => s.canAccess)

  return (
    <Drawer
      variant="permanent"
      sx={{
        width: DRAWER_WIDTH,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: DRAWER_WIDTH,
          top: '64px',
          height: 'calc(100vh - 64px)',
          boxSizing: 'border-box',
          backgroundColor: '#ffffff',
          color: '#111',
          borderRight: '1px solid rgba(0,0,0,0.08)'
        }
      }}
    >
      <Divider sx={{ backgroundColor: 'rgba(255,255,255,0.2)' }} />
      <List>
        {menuItems.map(
          (item) =>
            canAccess(item.minRole) && (
              <ListItem
                key={item.path}
                component={NavLink}
                to={item.path}
                sx={{
                  color: 'inherit',
                  textDecoration: 'none',
                  '&.active': {
                    backgroundColor: 'rgba(0,150,136,0.08)',
                    borderLeft: '4px solid #0077a3'
                  },
                  '&:hover': {
                    backgroundColor: 'rgba(0,0,0,0.02)'
                  },
                  py: 1.5,
                  minHeight: 64
                }}
              >
                <ListItemIcon sx={{ color: 'inherit', minWidth: 40 }}>
                  <item.icon />
                </ListItemIcon>
                <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: '0.9rem' }} />
              </ListItem>
            )
        )}
      </List>
    </Drawer>
  )
}

export { DRAWER_WIDTH }
