import { useQuery } from '@tanstack/react-query'
import { Alert, Box, Button, Card, CardContent, Chip, Divider, Grid, Skeleton, Stack, Typography } from '@mui/material'
import { CloudSyncOutlined, MemoryOutlined, StorageOutlined, Refresh, CheckCircleOutline, HighlightOff } from '@mui/icons-material'
import { systemAPI } from '@api/system'
import { formatDateTime } from '@utils/date'
import { PageHeader } from '@components/PageHeader'
export const System = () => {
  const query = useQuery({ queryKey: ['system-health'], queryFn: async () => (await systemAPI.getSystemHealth()).data, refetchInterval: 2000 })
  const data = query.data || {} as any
  const known = !query.isLoading && !query.isError
  const value = (text: any) => known ? text ?? '—' : '—'
  const details = [ ['Mã thiết bị', data.device_id], ['Loại thiết bị', data.device_type], ['Phiên bản dữ liệu', data.revision], ['Đồng bộ thành công gần nhất', data.last_successful_sync ? formatDateTime(data.last_successful_sync) : 'Chưa có'], ['Giao dịch chờ đồng bộ', data.pending_transactions ?? 0], ['Chế độ hoạt động', data.offline_mode ? 'Offline · lưu dữ liệu tại local' : 'Kết nối Server'] ]
  return <Box>
    <PageHeader title="Trạng thái hệ thống" description="Kiểm tra kết nối thiết bị, dữ liệu local và tiến trình đồng bộ Server tại một nơi." action={<Button variant="outlined" startIcon={<Refresh />} disabled={query.isFetching} onClick={() => void query.refetch()}>Làm mới</Button>} />
    {query.isError && <Alert severity="error" sx={{ mb: 2 }}>Không kết nối được API local. Thử làm mới và kiểm tra IPCSIM đang chạy.</Alert>}
    <Grid container spacing={1.5} sx={{ mb: 2 }}>{[
      { label: 'Kết nối thiết bị', icon: MemoryOutlined, good: data.serial_connected && data.hardware_status !== 'FAULT', title: data.hardware_status === 'FAULT' ? 'Có lỗi thiết bị' : data.serial_connected ? 'Đã kết nối' : 'Chưa kết nối', description: 'Kết nối Serial tới bộ mô phỏng / phần cứng.' },
      { label: 'Đồng bộ Server', icon: CloudSyncOutlined, good: data.server_synced, title: data.server_online ? data.server_synced ? 'Đã đồng bộ' : 'Đang đồng bộ' : 'Server offline', description: 'Danh mục và giao dịch được đồng bộ khi có kết nối.' },
      { label: 'Dữ liệu local', icon: StorageOutlined, good: data.database_healthy, title: data.database_healthy ? 'Sẵn sàng' : 'Cần kiểm tra', description: 'Cơ sở dữ liệu lưu trữ tại thiết bị.' }
    ].map(stat => <Grid item xs={12} md={4} key={stat.label}><Card sx={{ height: '100%' }}><CardContent sx={{ p: 2 }}><Stack direction="row" justifyContent="space-between" alignItems="center"><Box sx={{ bgcolor: '#eaf4f3', color: 'primary.main', display: 'flex', p: 1.5, borderRadius: 3 }}><stat.icon /></Box><Chip size="small" label={!known ? 'Chưa xác định' : stat.good ? 'Ổn định' : 'Cần chú ý'} color={!known ? 'default' : stat.good ? 'success' : 'warning'} variant="outlined" /></Stack><Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>{stat.label}</Typography>{query.isLoading ? <Skeleton height={40} /> : <Typography variant="h5" fontWeight={700} sx={{ mt: 0.5 }}>{value(stat.title)}</Typography>}<Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{stat.description}</Typography></CardContent></Card></Grid>)}</Grid>
    {known && data.sync_error && <Alert severity="warning" sx={{ mb: 2 }}>Đồng bộ chưa thành công: {data.sync_error}</Alert>}
    <Grid container spacing={2}>
      <Grid item xs={12} md={7}><Card><CardContent sx={{ p: 2 }}><Typography variant="h6" fontWeight={700} sx={{ mb: 1.5 }}>Thông tin thiết bị & đồng bộ</Typography><Stack divider={<Divider />} spacing={1.25}>{details.map(([label, detail]) => <Stack key={String(label)} direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={0.5}><Typography variant="body2" color="text.secondary">{label}</Typography><Typography variant="body2" fontWeight={650} sx={{ overflowWrap: 'anywhere', textAlign: { sm: 'right' } }}>{value(detail)}</Typography></Stack>)}</Stack></CardContent></Card></Grid>
      <Grid item xs={12} md={5}><Stack spacing={2}><Card><CardContent sx={{ p: 2 }}><Typography variant="h6" fontWeight={700} sx={{ mb: 1.5 }}>Sẵn sàng vận hành</Typography><Stack direction="row" alignItems="center" spacing={1}>{known && data.local_operation_available ? <CheckCircleOutline color="success" /> : <HighlightOff color="action" />}<Typography fontWeight={650}>{!known ? 'Chưa xác định' : data.local_operation_available ? 'Có thể thao tác tại local' : 'Chưa sẵn sàng'}</Typography></Stack><Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Cần dữ liệu đã đồng bộ, tài khoản hợp lệ và kết nối Serial để vận hành.</Typography></CardContent></Card>
      <Card><CardContent sx={{ p: 2 }}><Typography variant="h6" fontWeight={700} sx={{ mb: 1.5 }}>Kết nối Serial theo nhóm</Typography><Stack spacing={1}>{Object.entries(data.serial_groups || {}).length ? Object.entries(data.serial_groups).map(([id, connected]) => <Stack key={id} direction="row" justifyContent="space-between"><Typography variant="body2">Nhóm {id}</Typography><Chip size="small" label={known ? connected ? 'Kết nối' : 'Mất kết nối' : 'Chưa xác định'} color={known && connected ? 'success' : 'default'} variant="outlined" /></Stack>) : <Typography variant="body2" color="text.secondary">{known ? 'Thiết bị sử dụng kết nối Serial chung.' : 'Chưa có dữ liệu kết nối.'}</Typography>}</Stack></CardContent></Card></Stack></Grid>
    </Grid>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>Cấu hình kết nối được quản lý trong môi trường chạy IPCSIM. Quản lý danh mục tại Server.</Typography>
  </Box>
}
