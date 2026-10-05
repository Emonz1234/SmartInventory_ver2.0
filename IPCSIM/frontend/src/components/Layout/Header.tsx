import { t as uiText, errorText, useLanguage, LanguageSelector } from '../../i18n';
import { AppBar, Toolbar, Box, Typography, Chip, IconButton, Stack, Tooltip, Avatar } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import api from '@api/client'
import { CloudSync, Circle, Logout, Menu, StorageOutlined } from '@mui/icons-material'

export const Header = ({ operatorName, onLogout, onMenu }: { operatorName: string; onLogout: () => void; onMenu: () => void }) => {
  useLanguage();
  const query = useQuery({ queryKey: ['header-health'], queryFn: async () => (await api.get('/system/health')).data, refetchInterval: 2000 })
  const status = query.isError ? {} : query.data || {}
  return <AppBar position="fixed" elevation={0} sx={{ bgcolor: 'background.paper', color: 'text.primary', borderBottom: '1px solid', borderColor: 'divider', zIndex: theme => theme.zIndex.drawer + 1 }}>
    <Toolbar sx={{ gap: 1.5, minHeight: '64px !important', px: { xs: 1.5, md: 2 } }}>
      <IconButton aria-label={uiText("Mở menu")} onClick={onMenu} sx={{ display: { md: 'none' } }}><Menu /></IconButton>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0 }}>
        <Box sx={{ bgcolor: 'primary.main', color: 'white', width: 40, height: 40, borderRadius: 2.5, display: { xs: 'none', sm: 'grid' }, placeItems: 'center' }}><StorageOutlined /></Box>
        <Box><Typography fontWeight={800}>Smart Inventory</Typography><Typography variant="caption" color="text.secondary">{(status.device_id || 'IPCSIM')} · {status.device_type === 'IPC' ? uiText('Điều khiển thiết bị') : uiText('Mô phỏng vận hành')}</Typography></Box>
      </Stack><Box sx={{ flexGrow: 1 }} />
      <LanguageSelector />
      <Stack direction="row" spacing={1} sx={{ display: { xs: 'none', lg: 'flex' } }}>
        <Chip size="small" icon={<Circle sx={{ fontSize: '10px !important' }} />} label={query.isError || query.isLoading ? uiText('Thiết bị: chưa xác định') : status.hardware_status === 'FAULT' ? uiText('Thiết bị: có lỗi') : status.serial_connected ? uiText('Thiết bị sẵn sàng') : uiText('Thiết bị mất kết nối')} color={status.hardware_status === 'FAULT' ? 'error' : status.serial_connected ? 'success' : 'default'} variant="outlined" />
        <Tooltip title={uiText("Đồng bộ gần nhất: {0}{1}", (status.last_successful_sync || uiText('Chưa có')), status.sync_error ? ' · ' + errorText(status.sync_error) : '')}><Chip size="small" icon={<CloudSync />} label={query.isError || query.isLoading ? uiText('Server: chưa xác định') : status.server_online ? status.server_synced ? uiText('Đã đồng bộ') : uiText('Đang đồng bộ') : uiText('Server offline')} color={status.server_synced ? 'success' : 'warning'} variant="outlined" /></Tooltip>
        {status.pending_transactions > 0 && <Chip size="small" label={uiText("{0} giao dịch chờ", status.pending_transactions)} color="warning" />}
      </Stack>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ pl: { sm: 2 }, borderLeft: { sm: '1px solid' }, borderColor: 'divider' }}>
        <Avatar sx={{ width: 34, height: 34, bgcolor: '#e7f3f2', color: 'primary.main', fontSize: 14, fontWeight: 700 }}>{operatorName.slice(0, 1).toUpperCase()}</Avatar>
        <Box sx={{ display: { xs: 'none', sm: 'block' }, maxWidth: 150 }}><Typography variant="body2" noWrap fontWeight={650}>{operatorName}</Typography><Typography variant="caption" color="text.secondary">{uiText("Người vận hành")}</Typography></Box>
        <Tooltip title={uiText("Đăng xuất")}><IconButton aria-label={uiText("Đăng xuất")} onClick={onLogout} size="small"><Logout fontSize="small" /></IconButton></Tooltip>
      </Stack>
    </Toolbar>
  </AppBar>
}
