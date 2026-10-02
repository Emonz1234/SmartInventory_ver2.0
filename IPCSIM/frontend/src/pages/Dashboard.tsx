import { Grid, Card, CardContent, Typography, Box, Chip, Stack, Divider, Skeleton, Alert, Button, ListItemButton } from '@mui/material'
import { Circle, StorageOutlined, Inventory2Outlined, WarningAmberOutlined, ThermostatOutlined, WaterDropOutlined, ScaleOutlined, ArrowForward, Refresh, CloudSyncOutlined, MemoryOutlined, HistoryOutlined } from '@mui/icons-material'
import { useQuery } from '@tanstack/react-query'
import { dashboardAPI } from '@api/dashboard'
import api from '@api/client'
import { formatDateTime } from '@utils/date'
import { Link as RouterLink } from 'react-router-dom'
import { PageHeader } from '@components/PageHeader'

const normalizeSmoke = (value: any) => {
  if (value == null || value === '') return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'number') return value === 0 ? 0 : 1
  const text = String(value).toLowerCase().trim()
  if (['1', 'true', 'yes', 'có', 'co', 'alert', 'detected', 'on'].includes(text)) return 1
  if (['0', 'false', 'no', 'không', 'khong', 'safe', 'off', 'none'].includes(text)) return 0
  return null
}
export const Dashboard = () => {
  const summary = useQuery({ queryKey: ['dashboard', 'summary'], queryFn: async () => (await dashboardAPI.getSummary()).data, refetchInterval: 5000 })
  const health = useQuery({ queryKey: ['header-health'], queryFn: async () => (await api.get('/system/health')).data, refetchInterval: 2000 })
  const data: any = summary.data || {}, state: any = health.data || {}
  const known = !!summary.data && !summary.isError
  const healthKnown = !!health.data && !health.isError
  const cabinets = data.cabinet_status || {}, stock = data.inventory_summary || {}, environment = data.environment_summary || {}
  const smoke = normalizeSmoke(environment.smoke_detected ?? environment.smoke)
  const number = (value: any) => known ? value ?? '—' : '—'
  return <Box>
    <PageHeader title="Tổng quan vận hành" description="Nắm nhanh tình hình kho hàng, hoạt động tủ và kết nối thiết bị trước khi bắt đầu công việc." action={<Button variant="outlined" startIcon={<Refresh />} disabled={summary.isFetching} onClick={() => { void summary.refetch(); void health.refetch() }}>Làm mới</Button>} />
    {summary.isError && <Alert severity="error" sx={{ mb: 2 }}>Không tải được dữ liệu tổng quan. Vui lòng thử làm mới.</Alert>}
    {health.isError && <Alert severity="warning" sx={{ mb: 2 }}>Chưa xác định được kết nối thiết bị. Kiểm tra tại trang Trạng thái hệ thống.</Alert>}
    {healthKnown && state.offline_mode && <Alert severity="info" sx={{ mb: 2 }}>Server đang offline. {state.local_operation_available ? 'Có thể vận hành với dữ liệu local.' : 'Thiết bị chưa sẵn sàng vận hành.'} Giao dịch sẽ đồng bộ khi kết nối trở lại.</Alert>}
    <Grid container spacing={1.5} sx={{ mb: 2 }}>{[
      { label: 'Nhóm tủ đang hoạt động', value: known ? `${cabinets.active_cabinets ?? 0} / ${cabinets.total_cabinets ?? 0}` : '—', detail: 'Có số đo trong 15 giây gần nhất', icon: StorageOutlined, color: '#087c78', link: '/cabinets' },
      { label: 'Tổng tồn kho', value: number(stock.total_stock), detail: known ? `${stock.total_items ?? 0} loại sản phẩm` : 'Chưa có số liệu', icon: Inventory2Outlined, color: '#3274ad', link: '/inventory' },
      { label: 'Sản phẩm dưới mức tối thiểu', value: number(stock.low_stock_count), detail: 'Cần kiểm tra và bổ sung hàng', icon: WarningAmberOutlined, color: '#bb7837', link: '/inventory' },
      { label: 'Rack trong nhóm hoạt động', value: known ? `${cabinets.active_racks ?? 0} / ${cabinets.total_racks ?? 0}` : '—', detail: 'Theo nhóm tủ đang nhận số đo', icon: StorageOutlined, color: '#9172bf', link: '/cabinets' }
    ].map(metric => <Grid item xs={12} sm={6} xl={3} key={metric.label}><Card sx={{ height: '100%' }}><ListItemButton component={RouterLink} to={metric.link} sx={{ display: 'block', height: '100%', p: 2, borderRadius: 4 }}><Stack direction="row" justifyContent="space-between" spacing={1}><Typography variant="body2" color="text.secondary">{metric.label}</Typography><Box sx={{ display: 'flex', p: 1.25, borderRadius: 2.5, color: metric.color, bgcolor: metric.color + '12' }}><metric.icon fontSize="small" /></Box></Stack>{summary.isLoading ? <Skeleton height={48} /> : <Typography variant="h4" fontWeight={750} sx={{ mt: 1.5 }}>{metric.value}</Typography>}<Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{metric.detail}</Typography></ListItemButton></Card></Grid>)}</Grid>
    <Grid container spacing={2}>
      <Grid item xs={12} lg={7}><Stack spacing={2}>
        <Card><CardContent sx={{ p: 2 }}><Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1.5} sx={{ mb: 1.75 }}><Typography variant="h6" fontWeight={700}>Kết nối & sẵn sàng vận hành</Typography><Chip size="small" icon={<Circle sx={{ fontSize: '8px !important' }} />} label={!healthKnown ? 'Chưa xác định' : state.local_operation_available ? 'Sẵn sàng' : 'Cần kiểm tra'} color={!healthKnown ? 'default' : state.local_operation_available ? 'success' : 'warning'} variant="outlined" /></Stack>
          <Stack spacing={1.5} divider={<Divider />}>{[
            { label: 'Kết nối thiết bị', icon: MemoryOutlined, good: state.serial_connected && state.hardware_status !== 'FAULT', text: state.hardware_status === 'FAULT' ? 'Thiết bị báo lỗi' : state.serial_connected ? 'Đã kết nối Serial' : 'Chưa kết nối Serial' },
            { label: 'Đồng bộ Server', icon: CloudSyncOutlined, good: state.server_synced, text: state.server_online ? state.server_synced ? 'Đã đồng bộ' : 'Đang đồng bộ' : 'Server offline' },
            { label: 'Dữ liệu local', icon: StorageOutlined, good: state.database_healthy, text: state.database_healthy ? 'Sẵn sàng' : 'Cần kiểm tra' }
          ].map(row => <Stack key={row.label} direction="row" alignItems="center" justifyContent="space-between" spacing={1.5}><Stack direction="row" alignItems="center" spacing={1.25}><row.icon fontSize="small" color="action" /><Typography variant="body2">{row.label}</Typography></Stack><Typography variant="body2" fontWeight={650} color={!healthKnown ? 'text.secondary' : row.good ? 'success.main' : 'warning.main'}>{healthKnown ? row.text : 'Chưa xác định'}</Typography></Stack>)}</Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1} sx={{ mt: 1.75 }}><Typography variant="caption" color="text.secondary">{healthKnown ? `${state.pending_transactions ?? 0} giao dịch chờ đồng bộ` : 'Chưa có dữ liệu đồng bộ'}</Typography><Button component={RouterLink} to="/system" size="small" endIcon={<ArrowForward />} sx={{ minHeight: 32, px: 0 }}>Chi tiết hệ thống</Button></Stack>
        </CardContent></Card>
        <Card><CardContent sx={{ p: 2 }}><Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}><Typography variant="h6" fontWeight={700}>Nhóm tủ đang hoạt động</Typography><Chip size="small" label={number(cabinets.active_cabinets)} variant="outlined" /></Stack>
          {summary.isLoading ? <Skeleton height={100} /> : known && cabinets.active_groups?.length ? <Stack spacing={1} sx={{ maxHeight: 300, overflowY: 'auto' }}>{cabinets.active_groups.map((cabinet: any) => <ListItemButton key={cabinet.id} component={RouterLink} to={`/cabinets/${cabinet.id}`} sx={{ borderRadius: 2, bgcolor: '#f7fafb', p: 1.5 }}><Box sx={{ flex: 1, minWidth: 0 }}><Typography variant="body2" fontWeight={650} sx={{ overflowWrap: 'anywhere' }}>{cabinet.name}</Typography><Typography variant="caption" color="text.secondary">{cabinet.code}</Typography></Box><Chip label="Hoạt động" size="small" color="success" variant="outlined" sx={{ mx: 1 }} /><ArrowForward fontSize="small" color="action" /></ListItemButton>)}</Stack> : <Typography variant="body2" color="text.secondary">{known ? 'Chưa có nhóm tủ nhận số đo trong 15 giây gần nhất.' : 'Chưa có dữ liệu nhóm tủ.'}</Typography>}
          <Button component={RouterLink} to="/cabinets" size="small" endIcon={<ArrowForward />} sx={{ mt: 1.5, minHeight: 36, px: 0 }}>Xem tất cả tủ & rack</Button>
        </CardContent></Card>
      </Stack></Grid>
      <Grid item xs={12} lg={5}><Card><CardContent sx={{ p: 2 }}><Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}><Typography variant="h6" fontWeight={700}>Số đo môi trường gần nhất</Typography><Chip size="small" label={!known || smoke == null ? 'Chưa có số đo khói' : smoke === 1 ? 'Phát hiện khói' : 'Không có khói'} color={known && smoke === 1 ? 'error' : known && smoke === 0 ? 'success' : 'default'} variant="outlined" /></Stack><Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Số đo mới nhất từ một rack; xem từng rack tại trang Môi trường.</Typography>
        <Stack spacing={1.5}>{[
          { label: 'Nhiệt độ', value: environment.temperature, unit: '°C', icon: ThermostatOutlined, color: '#bb7837' },
          { label: 'Độ ẩm', value: environment.humidity, unit: '%', icon: WaterDropOutlined, color: '#3274ad' },
          { label: 'Tải trọng', value: environment.weight, unit: 'kg', icon: ScaleOutlined, color: '#087c78' }
        ].map(metric => <Stack key={metric.label} direction="row" justifyContent="space-between" alignItems="center" sx={{ p: 2, borderRadius: 3, bgcolor: '#f7fafb' }}><Stack direction="row" spacing={1.25} alignItems="center"><metric.icon sx={{ color: metric.color }} /><Typography variant="body2" color="text.secondary">{metric.label}</Typography></Stack><Typography variant="h5" fontWeight={700}>{number(metric.value)} <Box component="span" sx={{ fontSize: 13, fontWeight: 400, color: 'text.secondary' }}>{metric.unit}</Box></Typography></Stack>)}</Stack>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>Cập nhật: {known ? formatDateTime(environment.last_updated) : '—'}</Typography><Button component={RouterLink} to="/environment" size="small" endIcon={<ArrowForward />} sx={{ mt: 1, px: 0, minHeight: 36 }}>Xem môi trường theo rack</Button>
      </CardContent></Card></Grid>
    </Grid>
    <Typography variant="h6" fontWeight={700} sx={{ mt: 3, mb: 1.5 }}>Truy cập nhanh</Typography>
    <Grid container spacing={1.5}>{[
      { title: 'Kho hàng', description: 'Tìm sản phẩm, xem vị trí và thực hiện PICK / PUT.', icon: Inventory2Outlined, path: '/inventory' },
      { title: 'Hoạt động thiết bị', description: 'Xem lịch sử mở, đóng và thông gió.', icon: HistoryOutlined, path: '/operation' },
      { title: 'Sự cố & phục hồi', description: 'Kiểm tra lỗi rack và các báo cáo gần nhất.', icon: WarningAmberOutlined, path: '/breakdown' }
    ].map(link => <Grid item xs={12} md={4} key={link.path}><Card sx={{ height: '100%' }}><ListItemButton component={RouterLink} to={link.path} sx={{ p: 2, height: '100%', borderRadius: 4, gap: 1.5 }}><link.icon color="primary" /><Box sx={{ flex: 1 }}><Typography fontWeight={700}>{link.title}</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{link.description}</Typography></Box><ArrowForward color="action" fontSize="small" /></ListItemButton></Card></Grid>)}</Grid>
    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>Tổng quan cập nhật mỗi 5 giây · kết nối thiết bị mỗi 2 giây.</Typography>
  </Box>
}
