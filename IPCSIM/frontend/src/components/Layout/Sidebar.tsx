import { Drawer, List, ListItemButton, ListItemIcon, ListItemText, Typography, Box, Stack, Chip } from '@mui/material'
import { NavLink } from 'react-router-dom'
import { DashboardOutlined, Inventory2Outlined, StorageOutlined, CloudOutlined, SettingsOutlined, ReceiptLongOutlined, HistoryOutlined, ReportProblemOutlined } from '@mui/icons-material'
export const DRAWER_WIDTH = 240
const groups = [
  { title: 'VẬN HÀNH', items: [
    { label: 'Tổng quan', icon: DashboardOutlined, path: '/' },
    { label: 'Kho hàng', icon: Inventory2Outlined, path: '/inventory' },
    { label: 'Tủ & rack', icon: StorageOutlined, path: '/cabinets' }
  ] },
  { title: 'THEO DÕI & LỊCH SỬ', items: [
    { label: 'Giao dịch hàng hóa', icon: ReceiptLongOutlined, path: '/transactions' },
    { label: 'Hoạt động thiết bị', icon: HistoryOutlined, path: '/operation' },
    { label: 'Sự cố & phục hồi', icon: ReportProblemOutlined, path: '/breakdown' },
    { label: 'Môi trường', icon: CloudOutlined, path: '/environment' }
  ] },
  { title: 'HỆ THỐNG', items: [{ label: 'Trạng thái hệ thống', icon: SettingsOutlined, path: '/system' }] }
]
export const Sidebar = ({ mobileOpen, onClose }: { mobileOpen: boolean; onClose: () => void }) => {
  const content = <Stack sx={{ height: '100%', px: 1.5, py: 2 }}>
    <Box sx={{ px: 1.5, mb: 1 }}><Typography variant="caption" color="text.secondary">KHÔNG GIAN LÀM VIỆC</Typography><Typography fontWeight={700} sx={{ mt: 0.5 }}>Điều khiển IPCSIM</Typography></Box>
    {groups.map(group => <Box key={group.title} sx={{ mt: 1.5 }}>
      <Typography sx={{ px: 1.5, mb: 1, fontSize: 10, fontWeight: 750, letterSpacing: 1.1, color: 'text.secondary' }}>{group.title}</Typography>
      <List disablePadding>{group.items.map(item => <ListItemButton key={item.path} component={NavLink} to={item.path} end={item.path === '/'} onClick={onClose} sx={{ mb: 0.5, minHeight: 40, borderRadius: 2, px: 1.5, color: 'text.secondary', '&.active': { bgcolor: '#e5f3f1', color: 'primary.main', '& .MuiListItemText-primary': { fontWeight: 700 } }, '&:hover': { bgcolor: '#eff6f5' } }}>
        <ListItemIcon sx={{ color: 'inherit', minWidth: 34 }}><item.icon fontSize="small" /></ListItemIcon><ListItemText primary={item.label} primaryTypographyProps={{ fontSize: 13 }} />
      </ListItemButton>)}</List>
    </Box>)}
    <Box sx={{ mt: 'auto', pt: 3, px: 1.5 }}><Chip size="small" label="Dữ liệu local" variant="outlined" /><Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 1 }}>Danh mục được quản lý và đồng bộ từ Server.</Typography></Box>
  </Stack>
  const paper = { width: DRAWER_WIDTH, boxSizing: 'border-box', borderRight: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }
  return <Box component="nav" aria-label="Điều hướng chính" sx={{ width: { md: DRAWER_WIDTH }, flexShrink: 0 }}>
    <Drawer variant="temporary" open={mobileOpen} onClose={onClose} ModalProps={{ keepMounted: true }} sx={{ display: { xs: 'block', md: 'none' }, '& .MuiDrawer-paper': { ...paper, top: 64, height: 'calc(100% - 64px)' } }}>{content}</Drawer>
    <Drawer variant="permanent" sx={{ display: { xs: 'none', md: 'block' }, '& .MuiDrawer-paper': { ...paper, top: 64, height: 'calc(100% - 64px)' } }}>{content}</Drawer>
  </Box>
}
