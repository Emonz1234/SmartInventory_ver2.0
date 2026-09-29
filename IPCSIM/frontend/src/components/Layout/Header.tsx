import { AppBar, Toolbar, Box, Typography, Chip, IconButton, Stack, Tooltip } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import api from '@api/client'
import { CloudSync, Circle, Logout } from '@mui/icons-material'

interface HeaderProps {
  operatorName: string
  onLogout: () => void
}

export const Header = ({ operatorName, onLogout }: HeaderProps) => {
  const query = useQuery({ queryKey: ['header-health'], queryFn: async () => (await api.get('/system/health')).data, refetchInterval: 2000 })
  const status = query.isError ? {} : query.data || {}

  return (
    <AppBar position="fixed" elevation={1} sx={{ backgroundColor: '#ffffff', color: '#111', borderBottom: '3px solid #f59e0b' }}>
      <Toolbar sx={{ minHeight: '64px' }}>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <Box sx={{ px: 1.25, py: 0.5, borderRadius: 1, backgroundColor: '#0f766e', color: '#fff', fontWeight: 800, letterSpacing: 1 }}>
            {status.device_id || 'Edge'}
          </Box>
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 800, lineHeight: 1.1 }}>
              {status.device_type === 'IPC' ? 'Hardware Control' : 'Simulation Control'}
            </Typography>
            <Typography variant="caption" sx={{ color: '#b45309', fontWeight: 700, letterSpacing: 0.8 }}>
              {status.device_type === 'IPC' ? 'HARDWARE NOT IMPLEMENTED' : 'SIMULATION ENVIRONMENT'}
            </Typography>
          </Box>
        </Stack>
        <Box sx={{ flexGrow: 1 }} />
        <Stack direction="row" spacing={2} alignItems="center">
          <Box sx={{ textAlign: 'right' }}>
            <Typography variant="body2" display="block">
              {operatorName}
            </Typography>
            <Typography variant="caption" display="block" sx={{ color: 'rgba(0,0,0,0.6)' }}>
              Server operator
            </Typography>
          </Box>
          <Chip
            size="medium"
            icon={<Circle sx={{ fontSize: '0.7rem !important' }} />}
            label={status.serial_connected ? 'Serial: Connected' : 'Serial: Offline'}
            color={status.serial_connected ? 'success' : 'default'}
            variant="outlined"
            sx={{ borderColor: 'rgba(0,0,0,0.12)' }}
          />
          <Tooltip title="Đăng xuất">
            <IconButton aria-label="Đăng xuất" onClick={onLogout} color="inherit">
              <Logout />
            </IconButton>
          </Tooltip>
          <Chip
            size="medium"
            icon={<CloudSync sx={{ fontSize: '0.9rem !important' }} />}
            label={status.server_online ? (status.server_synced ? 'Server: Synced' : 'Server: Syncing') : 'Server: Offline'}
            color={status.server_synced ? 'success' : 'warning'}
            variant="outlined"
            sx={{ borderColor: 'rgba(0,0,0,0.12)' }}
          />
        </Stack>
      </Toolbar>
    </AppBar>
  )
}
