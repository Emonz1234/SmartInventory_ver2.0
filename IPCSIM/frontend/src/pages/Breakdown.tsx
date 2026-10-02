import { useState } from 'react'
import { Alert, Box, Button, Card, CardContent, Chip, Grid, MenuItem, Skeleton, Stack, Tab, Tabs, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { Refresh, ReportProblemOutlined, CheckCircleOutline, StorageOutlined } from '@mui/icons-material'
import { useQuery } from '@tanstack/react-query'
import { systemAPI } from '@api/system'
import { formatDateTime, parseVietnamDate } from '@utils/date'
import { PageHeader, EmptyState } from '@components/PageHeader'
const errorsOf = (row: any): string[] => [row.is_obstructed && 'Vật cản', row.is_skewed && 'Lệch rack', row.is_overload_motor && 'Quá tải động cơ'].filter(Boolean) as string[]
export const Breakdown = () => {
  const [rack, setRack] = useState(''), [status, setStatus] = useState('ALL'), [tab, setTab] = useState(0)
  const query = useQuery({ queryKey: ['breakdownData'], queryFn: async () => (await systemAPI.getBreakdownData(200)).data.data, refetchInterval: 5000 })
  const history: any[] = [...(query.data || [])].sort((a, b) => (parseVietnamDate(b.created_at)?.getTime() || 0) - (parseVietnamDate(a.created_at)?.getTime() || 0) || b.id - a.id)
  const latest = new Map<number, any>()
  history.forEach(row => { if (!latest.has(Number(row.rack_id))) latest.set(Number(row.rack_id), row) })
  const current = Array.from(latest.values())
  const active = current.filter(row => errorsOf(row).length > 0).length
  const rows = (tab === 0 ? current : history).filter(row => (!rack || String(row.rack_id) === rack) && (status === 'ALL' || (errorsOf(row).length > 0 ? 'ERROR' : 'CLEAR') === status))
  return <Box>
    <PageHeader title="Sự cố & phục hồi" description="Nhận biết rack cần kiểm tra và xem lại các lần báo lỗi, hết lỗi từ thiết bị." action={<Button variant="outlined" startIcon={<Refresh />} disabled={query.isFetching} onClick={() => void query.refetch()}>Làm mới</Button>} />
    <Grid container spacing={1.5} sx={{ mb: 2 }}>{[
      { label: 'Rack cần kiểm tra', value: active, icon: ReportProblemOutlined, color: '#c35454' },
      { label: 'Rack không báo lỗi', value: current.length - active, icon: CheckCircleOutline, color: '#087c78' },
      { label: 'Rack có dữ liệu', value: current.length, icon: StorageOutlined, color: '#3274ad' }
    ].map(stat => <Grid item xs={12} sm={4} key={stat.label}><Card><CardContent><Stack direction="row" justifyContent="space-between" alignItems="center"><Box><Typography variant="body2" color="text.secondary">{stat.label}</Typography><Typography variant="h4" fontWeight={750} sx={{ mt: 1 }}>{query.isLoading || query.isError ? '—' : stat.value}</Typography></Box><Box sx={{ display: 'flex', p: 1.5, borderRadius: 3, bgcolor: stat.color + '12', color: stat.color }}><stat.icon /></Box></Stack></CardContent></Card></Grid>)}</Grid>
    {query.isError && <Alert severity="error" sx={{ mb: 2 }}>Không tải được dữ liệu sự cố. Vui lòng làm mới.</Alert>}
    {!query.isLoading && !query.isError && active > 0 && <Alert severity="warning" sx={{ mb: 2 }}>Có {active} rack báo lỗi trong dữ liệu gần nhất. Kiểm tra vật cản, độ lệch và tải động cơ trước khi tiếp tục thao tác.</Alert>}
    <Card sx={{ mb: 2 }}><CardContent><Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
      <TextField size="small" type="number" label="Rack ID" value={rack} onChange={event => setRack(event.target.value)} />
      <TextField select size="small" label="Trạng thái" value={status} onChange={event => setStatus(event.target.value)} sx={{ minWidth: 200 }}><MenuItem value="ALL">Tất cả trạng thái</MenuItem><MenuItem value="ERROR">Có lỗi</MenuItem><MenuItem value="CLEAR">Không báo lỗi</MenuItem></TextField>
      <Button onClick={() => { setRack(''); setStatus('ALL') }}>Xóa bộ lọc</Button>
    </Stack></CardContent></Card>
    <Card><Box sx={{ px: 2, pt: 1 }}><Tabs value={tab} onChange={(_, value) => setTab(value)} aria-label="Chế độ xem sự cố"><Tab label="Trạng thái gần nhất" /><Tab label="Lịch sử báo cáo" /></Tabs></Box>
      <Stack direction="row" justifyContent="space-between" spacing={1.5} sx={{ p: 2 }}><Typography variant="body2" color="text.secondary">{tab === 0 ? 'Báo cáo mới nhất của từng rack trong dữ liệu đã tải.' : 'Các báo cáo sự cố và hết lỗi, mới nhất trước.'}</Typography><Chip size="small" label={`${rows.length} bản ghi`} variant="outlined" /></Stack>
      <TableContainer sx={{ maxHeight: 620 }}><Table stickyHeader size="small"><TableHead><TableRow>{['Rack', 'Trạng thái', 'Chi tiết lỗi', 'Thời gian báo cáo'].map(label => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead><TableBody>
        {query.isLoading ? Array.from({ length: 5 }, (_, index) => <TableRow key={index}><TableCell colSpan={4}><Skeleton height={40} /></TableCell></TableRow>) : rows.length === 0 ? <TableRow><TableCell colSpan={4}><EmptyState text="Chưa có báo cáo phù hợp" /></TableCell></TableRow> : rows.map(row => {
          const errors = errorsOf(row)
          return <TableRow hover key={row.id}><TableCell sx={{ fontWeight: 650 }}>Rack {row.rack_id}</TableCell><TableCell><Chip size="small" label={errors.length ? 'Cần kiểm tra' : 'Không báo lỗi'} color={errors.length ? 'error' : 'success'} variant="outlined" /></TableCell><TableCell>{errors.length ? <Stack direction="row" flexWrap="wrap" gap={0.75}>{errors.map(error => <Chip key={error} label={error} size="small" color="error" />)}</Stack> : <Typography variant="body2" color="text.secondary">Không phát hiện lỗi trong báo cáo</Typography>}</TableCell><TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(row.created_at)}</TableCell></TableRow>
        })}
      </TableBody></Table></TableContainer>
    </Card>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>Dữ liệu cập nhật mỗi 5 giây · tối đa 200 báo cáo gần nhất. Rack chưa có báo cáo chưa được đánh giá trạng thái.</Typography>
  </Box>
}
