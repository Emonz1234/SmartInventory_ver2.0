import { deviceFaultSummary } from '../DeviceFaultDetails'
import { t as uiText, errorText, useLanguage, LanguageSelector } from '../../i18n';
import { AppBar, Toolbar, Box, Typography, Chip, IconButton, Stack, Tooltip, Avatar } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import api from '@api/client'
import { CloudSync, Circle, Logout, Menu, StorageOutlined } from '@mui/icons-material'

export const Header = ({ operatorName, onLogout, onMenu }: { operatorName: string; onLogout: () => void; onMenu: () => void }) => {
  const language = useLanguage();
  const query = useQuery({ queryKey: ['header-health'], queryFn: async () => (await api.get('/system/health')).data, refetchInterval: 2000 })
  const status = query.isError ? {} : query.data || {}
  return <AppBar position="fixed" elevation={0} sx={{ bgcolor: 'background.paper', color: 'text.primary', borderBottom: '1px solid', borderColor: 'divider', boxShadow: '0 2px 12px rgba(23, 52, 58, 0.035)', zIndex: theme => theme.zIndex.drawer + 1 }}>
    <Toolbar sx={{ gap: { xs: 1, md: 2 }, minHeight: '64px !important', px: { xs: 1.5, md: 2.5 }, '& .language-trigger': { width: 36, height: 36, borderRadius: '10px', background: '#f5f8f9', borderColor: '#e6edef' } }}>
      <IconButton aria-label={uiText("Mở menu")} onClick={onMenu} sx={{ display: { md: 'none' } }}><Menu fontSize="small" /></IconButton>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0, flexShrink: 1 }}>
        <Box sx={{ background: 'linear-gradient(135deg, #087c78, #0e9990)', color: 'white', width: 38, height: 38, flexShrink: 0, borderRadius: 2.5, boxShadow: '0 3px 8px #087c7826', display: { xs: 'none', sm: 'grid' }, placeItems: 'center' }}><StorageOutlined /></Box>
        <Box sx={{ minWidth: 0 }}><Typography noWrap sx={{ fontWeight: 750, fontSize: { xs: 14, sm: 16 }, letterSpacing: '-0.3px', lineHeight: 1.3 }}>Smart Inventory</Typography><Typography noWrap variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: 11, mt: 0.25 }}>{(status.device_id || 'IPCSIM')} · {status.device_type === 'IPC' ? uiText('Điều khiển thiết bị') : uiText('Mô phỏng vận hành')}</Typography></Box>
      </Stack><Box sx={{ flexGrow: 1 }} />
      <Stack direction="row" spacing={0.75} sx={{ display: { xs: 'none', lg: 'flex' }, alignItems: 'center', '& .MuiChip-root': { height: 28, borderRadius: '8px', fontSize: 11, bgcolor: '#f8fafb', borderColor: '#e4ecee' }, '& .MuiChip-colorSuccess': { bgcolor: '#edf8f3', borderColor: '#d5eee1' }, '& .MuiChip-colorWarning': { bgcolor: '#fff8ed', borderColor: '#f5e4c6' }, '& .MuiChip-colorError': { bgcolor: '#fff1ef', borderColor: '#f3d4ce' }, '& .MuiChip-icon': { fontSize: 16 } }}>
        <Tooltip title={status.hardware_status === 'FAULT' ? <Box sx={{ whiteSpace: 'pre-line' }}>{deviceFaultSummary(status, language)}</Box> : ''}><Chip size="small" icon={<Circle sx={{ fontSize: '10px !important' }} />} label={query.isError || query.isLoading ? uiText('Thiết bị: chưa xác định') : status.hardware_status === 'FAULT' ? uiText('Thiết bị: có lỗi') : status.serial_connected ? uiText('Thiết bị sẵn sàng') : uiText('Thiết bị mất kết nối')} color={status.hardware_status === 'FAULT' ? 'error' : status.serial_connected ? 'success' : 'default'} variant="outlined" /></Tooltip>
        <Tooltip title={uiText("Đồng bộ gần nhất: {0}{1}", (status.last_successful_sync || uiText('Chưa có')), status.sync_error ? ' · ' + errorText(status.sync_error) : '')}><Chip size="small" icon={<CloudSync />} label={query.isError || query.isLoading ? uiText('Server: chưa xác định') : status.server_online ? status.server_synced ? uiText('Đã đồng bộ') : uiText('Đang đồng bộ') : uiText('Server offline')} color={status.server_synced ? 'success' : 'warning'} variant="outlined" /></Tooltip>
        {status.pending_transactions > 0 && <Chip size="small" label={uiText("{0} giao dịch chờ", status.pending_transactions)} color="warning" />}
      </Stack>
      <LanguageSelector />
      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0, pl: { sm: 2 }, borderLeft: { sm: '1px solid' }, borderColor: 'divider' }}>
        <Avatar sx={{ width: 32, height: 32, border: '1px solid #d5e9e6', bgcolor: '#e7f3f2', color: 'primary.main', fontSize: 14, fontWeight: 700 }}>{operatorName.slice(0, 1).toUpperCase()}</Avatar>
        <Box sx={{ display: { xs: 'none', sm: 'block' }, maxWidth: { sm: 100, xl: 150 } }}><Typography variant="body2" noWrap fontWeight={650}>{operatorName}</Typography><Typography variant="caption" color="text.secondary">{uiText("Người vận hành")}</Typography></Box>
        <Tooltip title={uiText("Đăng xuất")}><IconButton aria-label={uiText("Đăng xuất")} onClick={onLogout} size="small" sx={{ color: 'text.secondary', borderRadius: 2, '&:hover': { bgcolor: '#fff1ef', color: 'error.main' } }}><Logout fontSize="small" /></IconButton></Tooltip>
      </Stack>
    </Toolbar>
  </AppBar>
}
