import { t as sharedText, getLanguage, errorText, useLanguage } from '../i18n';
import { useState } from 'react'
import { Alert, Box, Button, Card, CardContent, Chip, Grid, MenuItem, Skeleton, Stack, Tab, Tabs, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { Refresh, ReportProblemOutlined, CheckCircleOutline, StorageOutlined } from '@mui/icons-material'
import { useQuery } from '@tanstack/react-query'
import { systemAPI } from '@api/system'
import api from '@api/client'
import { formatDateTime, parseVietnamDate } from '@utils/date'
import { PageHeader, EmptyState } from '@components/PageHeader'

// Additional UI copy for mechanical state, recovery and rack locations.
const mergedCopy: Record<string, [string, string]> = {
  "Vị trí rack": ["Vị trí rack", "Rack location"],
  "Chưa tải được vị trí rack. Các bản ghi đang hiển thị ID kỹ thuật; vui lòng làm mới.": ["Chưa tải được vị trí rack. Các bản ghi đang hiển thị ID kỹ thuật; vui lòng làm mới.", "Could not load rack locations. Records show technical IDs; please refresh."],
  "Cần kiểm tra": ["Cần kiểm tra", "Needs inspection"]
}
const uiText = (value: string, ...args: any[]) => {
  const pair = mergedCopy[value]
  return pair ? pair[getLanguage() === 'en' ? 1 : 0].replace(/\{(\d+)\}/g, (_, index) => String(args[index] ?? '')) : sharedText(value, ...args)
}

const errorsOf = (row: any): string[] => [row.is_obstructed && 'Vật cản', row.is_skewed && 'Lệch rack', row.is_overload_motor && 'Quá tải động cơ'].filter(Boolean) as string[]
export const Breakdown = () => {
  useLanguage();
  const [rack, setRack] = useState(''), [status, setStatus] = useState('ALL'), [tab, setTab] = useState(0)
  const query = useQuery({ queryKey: ['breakdownData'], queryFn: async () => (await systemAPI.getBreakdownData(200)).data.data, refetchInterval: 5000 })
  const topology = useQuery({ queryKey: ['breakdown-topology'], queryFn: async () => (await api.get('/device/snapshot')).data.records || [], refetchInterval: 30000 })
  const records: any[] = topology.data || []
  const cabinets = new Map(records.filter(row => row.kind === 'cabinet').map(row => [Number(row.data.id), row.data]))
  const racks = new Map(records.filter(row => row.kind === 'rack').map(row => [Number(row.data.id), row.data]))
  const locationLabel = (id: number) => {
    const r = racks.get(Number(id)), c = r && cabinets.get(Number(r.cabinet_id))
    if (c?.cabinet_index && r?.rack_index) return `${uiText('Cabinet')} ${String(c.cabinet_index).padStart(2, '0')} / Rack ${String(r.rack_index).padStart(2, '0')}`
    return `Rack ID ${id}`
  }
  const history: any[] = [...(query.data || [])].sort((a, b) => (parseVietnamDate(b.created_at)?.getTime() || 0) - (parseVietnamDate(a.created_at)?.getTime() || 0) || b.id - a.id)
  const latest = new Map<number, any>()
  history.forEach(row => { if (!latest.has(Number(row.rack_id))) latest.set(Number(row.rack_id), row) })
  const current = Array.from(latest.values())
  const active = current.filter(row => errorsOf(row).length > 0).length
  const rows = (tab === 0 ? current : history).filter(row => (!rack || String(row.rack_id) === rack) && (status === 'ALL' || (errorsOf(row).length > 0 ? 'ERROR' : 'CLEAR') === status))
  return <Box>
    <PageHeader title={uiText("Sự cố & phục hồi")} description={uiText("Nhận biết rack cần kiểm tra và xem lại các lần báo lỗi, hết lỗi từ thiết bị.")} action={<Button variant="outlined" startIcon={<Refresh />} disabled={query.isFetching || topology.isFetching} onClick={() => { void query.refetch(); void topology.refetch() }}>{uiText("Làm mới")}</Button>} />
    <Grid container spacing={1.5} sx={{ mb: 2 }}>{[
      { label: 'Rack cần kiểm tra', value: active, icon: ReportProblemOutlined, color: '#c35454' },
      { label: 'Rack không báo lỗi', value: current.length - active, icon: CheckCircleOutline, color: '#087c78' },
      { label: 'Rack có dữ liệu', value: current.length, icon: StorageOutlined, color: '#3274ad' }
    ].map(stat => <Grid item xs={12} sm={4} key={stat.label}><Card><CardContent><Stack direction="row" justifyContent="space-between" alignItems="center"><Box><Typography variant="body2" color="text.secondary">{uiText(stat.label)}</Typography><Typography variant="h4" fontWeight={750} sx={{ mt: 1 }}>{query.isLoading || query.isError ? '—' : stat.value}</Typography></Box><Box sx={{ display: 'flex', p: 1.5, borderRadius: 3, bgcolor: stat.color + '12', color: stat.color }}><stat.icon /></Box></Stack></CardContent></Card></Grid>)}</Grid>
    {query.isError && <Alert severity="error" sx={{ mb: 2 }}>{uiText("Không tải được dữ liệu sự cố. Vui lòng làm mới.")}</Alert>}
    {!query.isLoading && !query.isError && active > 0 && <Alert severity="warning" sx={{ mb: 2 }}>{uiText("Có")} {active} {uiText("rack báo lỗi trong dữ liệu gần nhất. Kiểm tra vật cản, độ lệch và tải động cơ trước khi tiếp tục thao tác.")}</Alert>}
    {topology.isError && <Alert severity="warning" sx={{ mb: 2 }}>{uiText("Chưa tải được vị trí rack. Các bản ghi đang hiển thị ID kỹ thuật; vui lòng làm mới.")}</Alert>}
    <Card sx={{ mb: 2 }}><CardContent><Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
      <TextField select size="small" label={uiText("Vị trí rack")} value={rack} onChange={event => setRack(event.target.value)} sx={{ minWidth: { sm: 270 } }}><MenuItem value="">{uiText("Tất cả rack")}</MenuItem>{Array.from(latest.keys()).sort((a, b) => { const ra = racks.get(a), rb = racks.get(b); return (cabinets.get(Number(ra?.cabinet_id))?.cabinet_index || 0) - (cabinets.get(Number(rb?.cabinet_id))?.cabinet_index || 0) || (ra?.rack_index || a) - (rb?.rack_index || b) }).map(id => <MenuItem key={id} value={String(id)}>{locationLabel(id)}</MenuItem>)}</TextField>
      <TextField select size="small" label={uiText("Trạng thái")} value={status} onChange={event => setStatus(event.target.value)} sx={{ minWidth: 200 }}><MenuItem value="ALL">{uiText("Tất cả trạng thái")}</MenuItem><MenuItem value="ERROR">{uiText("Có lỗi")}</MenuItem><MenuItem value="CLEAR">{uiText("Không báo lỗi")}</MenuItem></TextField>
      <Button onClick={() => { setRack(''); setStatus('ALL') }}>{uiText("Xóa bộ lọc")}</Button>
    </Stack></CardContent></Card>
    <Card><Box sx={{ px: 2, pt: 1 }}><Tabs value={tab} onChange={(_, value) => setTab(value)} aria-label={uiText("Chế độ xem sự cố")}><Tab label={uiText("Trạng thái gần nhất")} /><Tab label={uiText("Lịch sử báo cáo")} /></Tabs></Box>
      <Stack direction="row" justifyContent="space-between" spacing={1.5} sx={{ p: 2 }}><Typography variant="body2" color="text.secondary">{tab === 0 ? uiText('Báo cáo mới nhất của từng rack trong dữ liệu đã tải.') : uiText('Các báo cáo sự cố và hết lỗi, mới nhất trước.')}</Typography><Chip size="small" label={uiText("{0} bản ghi", rows.length)} variant="outlined" /></Stack>
      <TableContainer sx={{ maxHeight: 620 }}><Table stickyHeader size="small"><TableHead><TableRow>{['Rack', 'Trạng thái', 'Chi tiết lỗi', 'Thời gian báo cáo'].map(label => <TableCell key={label}>{uiText(label)}</TableCell>)}</TableRow></TableHead><TableBody>
        {query.isLoading ? Array.from({ length: 5 }, (_, index) => <TableRow key={index}><TableCell colSpan={4}><Skeleton height={40} /></TableCell></TableRow>) : rows.length === 0 ? <TableRow><TableCell colSpan={4}><EmptyState text={uiText("Chưa có báo cáo phù hợp")} /></TableCell></TableRow> : rows.map(row => {
          const errors = errorsOf(row)
          return <TableRow hover key={row.id}><TableCell sx={{ fontWeight: 650 }}>{locationLabel(row.rack_id)}</TableCell><TableCell><Chip size="small" label={errors.length ? uiText('Cần kiểm tra') : uiText('Không báo lỗi')} color={errors.length ? 'error' : 'success'} variant="outlined" /></TableCell><TableCell>{errors.length ? <Stack direction="row" flexWrap="wrap" gap={0.75}>{errors.map(error => <Chip key={error} label={errorText(error)} size="small" color="error" />)}</Stack> : <Typography variant="body2" color="text.secondary">{uiText("Không phát hiện lỗi trong báo cáo")}</Typography>}</TableCell><TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(row.created_at)}</TableCell></TableRow>
        })}
      </TableBody></Table></TableContainer>
    </Card>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>{uiText("Dữ liệu cập nhật mỗi 5 giây · tối đa 200 báo cáo gần nhất. Rack chưa có báo cáo chưa được đánh giá trạng thái.")}</Typography>
  </Box>
}
