import { useState } from 'react'
import { Box, Card, CardContent, Grid, Typography, Button, Stack, Chip, Divider, FormControl, InputLabel, Select, MenuItem, Skeleton, Alert } from '@mui/material'
import { ArrowForward, StorageOutlined, Tune, CheckCircleOutline, ViewModuleOutlined, Refresh } from '@mui/icons-material'
import { alpha } from '@mui/material/styles'
import { Link as RouterLink } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { cabinetAPI } from '@api/cabinet'
import { PageHeader, EmptyState } from '@components/PageHeader'

export const Cabinets = () => {
  const [selectedCabinetId, setSelectedCabinetId] = useState('all')
  const q = useQuery({
    queryKey: ['cabinets', 'list'],
    queryFn: async () => (await cabinetAPI.list()).data,
    refetchInterval: 2000
  })
  const cabinets: any[] = q.data ?? []
  const visibleCabinets = cabinets.filter(cabinet => selectedCabinetId === 'all' || String(cabinet.id) === selectedCabinetId)
  const totalRacks = cabinets.reduce((total, cabinet) => total + (cabinet.rack_count || 0), 0)
  const onlineCabinets = cabinets.filter(cabinet => String(cabinet.status || '').toLowerCase() === 'active').length
  return <Box>
    <PageHeader title="Tủ & rack" description="Theo dõi các nhóm tủ và mở chi tiết để thao tác rack, điều khiển đèn hoặc thông gió." action={<Button variant="outlined" startIcon={<Refresh />} disabled={q.isFetching} onClick={() => void q.refetch()}>Làm mới</Button>} />
    <Grid container spacing={1.5} sx={{ mb: 2 }}>{[
      { label: 'Nhóm tủ', value: cabinets.length, icon: StorageOutlined, color: '#087c78' },
      { label: 'Tổng số rack', value: totalRacks, icon: ViewModuleOutlined, color: '#3274ad' },
      { label: 'Nhóm tủ hoạt động', value: onlineCabinets, icon: CheckCircleOutline, color: '#16846b' }
    ].map(metric => <Grid item xs={12} sm={4} key={metric.label}><Card><CardContent sx={{ p: 2 }}><Stack direction="row" justifyContent="space-between" alignItems="center"><Box><Typography variant="body2" color="text.secondary">{metric.label}</Typography><Typography variant="h4" fontWeight={750} sx={{ mt: 1 }}>{q.isLoading || q.isError ? '—' : metric.value}</Typography></Box><Box sx={{ display: 'flex', p: 1.5, borderRadius: 3, color: metric.color, bgcolor: metric.color + '12' }}><metric.icon /></Box></Stack></CardContent></Card></Grid>)}</Grid>
    <Card sx={{ mb: 2 }}><CardContent sx={{ p: 2 }}><Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} justifyContent="space-between">
      <Stack direction="row" spacing={1.25} alignItems="center"><Tune color="action" /><Box><Typography fontWeight={650}>Chọn nhóm tủ</Typography><Typography variant="body2" color="text.secondary">Xem tất cả hoặc tập trung vào một nhóm.</Typography></Box></Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <FormControl size="small" sx={{ minWidth: { sm: 260 } }}><InputLabel id="cabinet-group-filter-label">Nhóm tủ</InputLabel><Select labelId="cabinet-group-filter-label" value={selectedCabinetId} label="Nhóm tủ" onChange={event => setSelectedCabinetId(event.target.value)}><MenuItem value="all">Tất cả nhóm tủ</MenuItem>{cabinets.map(cabinet => <MenuItem key={cabinet.id} value={String(cabinet.id)}>{cabinet.cabinet_name || cabinet.cabinet_code || `Tủ ${cabinet.id}`}</MenuItem>)}</Select></FormControl>
        <Button onClick={() => setSelectedCabinetId('all')} disabled={selectedCabinetId === 'all'} sx={{ minHeight: 36 }}>Xóa bộ lọc</Button>
      </Stack>
    </Stack></CardContent></Card>
    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}><Typography variant="h6" fontWeight={700}>Danh sách nhóm tủ</Typography>{!q.isLoading && !q.isError && <Chip size="small" label={`${visibleCabinets.length} / ${cabinets.length} nhóm tủ`} variant="outlined" />}</Stack>
    {q.isLoading ? <Grid container spacing={1.5}>{Array.from({ length: 6 }, (_, index) => <Grid item xs={12} sm={6} lg={4} key={index}><Skeleton variant="rounded" height={290} /></Grid>)}</Grid> : q.isError ? <Alert severity="error">Không tải được danh sách tủ. Vui lòng thử làm mới.</Alert> : visibleCabinets.length === 0 ? <Card><EmptyState text="Chưa có nhóm tủ phù hợp" /></Card> : <Grid container spacing={1.75}>{visibleCabinets.map(cabinet => {
      const name = cabinet.cabinet_name || cabinet.cabinet_code || `Tủ ${cabinet.id}`
      const code = cabinet.cabinet_code || cabinet.code || `CB-${cabinet.id}`
      const status = String(cabinet.status || '').toLowerCase()
      const isActive = status === 'active'
      const statusLabel = isActive ? 'Hoạt động' : ['inactive', 'offline'].includes(status) ? 'Chưa hoạt động' : cabinet.status || 'Chưa xác định'
      return <Grid item xs={12} sm={6} lg={4} key={cabinet.id}><Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', transition: 'border-color 180ms ease, box-shadow 180ms ease', '&:hover': { borderColor: 'primary.main', boxShadow: '0 8px 24px rgba(8,124,120,0.08)' } }}>
        <CardContent sx={{ p: 2, flex: 1 }}><Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center" sx={{ mb: 1.75 }}><Box sx={{ display: 'flex', p: 1.5, borderRadius: 3, bgcolor: theme => alpha(theme.palette.primary.main, 0.08), color: 'primary.main' }}><StorageOutlined /></Box><Chip size="small" variant="outlined" color={isActive ? 'success' : 'default'} label={statusLabel} /></Stack>
          <Typography variant="h6" fontWeight={750} sx={{ overflowWrap: 'anywhere' }}>{name}</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{code}</Typography><Divider sx={{ my: 1.75 }} />
          <Stack direction="row" justifyContent="space-between" alignItems="center"><Box><Typography variant="h5" fontWeight={750}>{cabinet.rack_count || 0} <Box component="span" sx={{ fontSize: 13, color: 'text.secondary', fontWeight: 400 }}>rack</Box></Typography><Typography variant="caption" color="text.secondary">Trong nhóm tủ</Typography></Box><Box aria-hidden="true" sx={{ display: 'flex', gap: 0.5 }}>{Array.from({ length: Math.min(6, Math.max(0, Number(cabinet.rack_count) || 0)) }, (_, index) => <Box key={index} sx={{ width: 12, height: 34, borderRadius: 0.75, bgcolor: theme => alpha(theme.palette.primary.main, 0.12), border: '1px solid', borderColor: theme => alpha(theme.palette.primary.main, 0.2) }} />)}</Box></Stack>
        </CardContent><Box sx={{ px: 2, pb: 2 }}><Button component={RouterLink} to={`/cabinets/${cabinet.id}`} fullWidth variant="outlined" endIcon={<ArrowForward />} sx={{ minHeight: 36 }}>Mở chi tiết tủ</Button></Box>
      </Card></Grid>
    })}</Grid>}
    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>Trạng thái cập nhật mỗi 2 giây. Các thao tác thiết bị thực hiện trong chi tiết tủ.</Typography>
  </Box>
}
