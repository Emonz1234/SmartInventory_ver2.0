import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, Box, Button, Card, CardContent, Chip, CircularProgress, MenuItem, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography, Grid } from '@mui/material'
import { Refresh, LockOpenOutlined, LockOutlined, Air } from '@mui/icons-material'
import api from '@api/client'
import { formatDateTime } from '@utils/date'
import { PageHeader, EmptyState } from '@components/PageHeader'

const actionNames: Record<string, string> = { OPEN: 'Mở rack', CLOSE: 'Đóng / về HOME', VENTILATE: 'Thông gió' }
const stateNames: Record<string, string> = { local_sent: 'Đã gửi lệnh', local_uncertain: 'Chưa xác định', uncertain: 'Chưa xác định', rejected: 'Đã từ chối', confirmed: 'Đã xác nhận', failed: 'Thất bại', pending: 'Đang chờ' }
function parseBody(value: unknown): Record<string, any> {
  if (value && typeof value === 'object') return value as Record<string, any>
  try { return JSON.parse(String(value || '{}')) || {} } catch { return {} }
}
export const Operation = () => {
  const [rackFilter, setRackFilter] = useState('')
  const [kindFilter, setKindFilter] = useState('ALL')
  const commands = useQuery({ queryKey: ['operation-command-history'], queryFn: async () => (await api.get('/device/snapshot')).data.operation_history || [], refetchInterval: 3000 })
  const rows = (commands.data || []).map((row: any) => {
    const body = parseBody(row.body)
    const action = String(body.kind || body.action || '').toUpperCase()
    return { id: row.id, kind: action === 'HOME' ? 'CLOSE' : action, action, rack: body.rack_id, state: row.state, time: row.created_at || body.created_at }
  }).filter((row: any) => ['OPEN', 'CLOSE', 'VENTILATE'].includes(row.kind))
  const filtered = rows.filter((row: any) => (!rackFilter || String(row.rack) === rackFilter) && (kindFilter === 'ALL' || row.kind === kindFilter))
  return <Box>
    <PageHeader title="Hoạt động thiết bị" description="Lịch sử đóng, mở rack và thông gió. Theo dõi giao dịch PICK / PUT tại trang Giao dịch hàng hóa." action={<Button variant="outlined" startIcon={<Refresh />} disabled={commands.isFetching} onClick={() => void commands.refetch()}>Làm mới</Button>} />
    <Grid container spacing={1.5} sx={{ mb: 2 }}>{[
      { kind: 'OPEN', icon: LockOpenOutlined, color: '#087c78' }, { kind: 'CLOSE', icon: LockOutlined, color: '#3274ad' }, { kind: 'VENTILATE', icon: Air, color: '#9172bf' }
    ].map(metric => <Grid item xs={12} sm={4} key={metric.kind}><Card><CardContent><Stack direction="row" justifyContent="space-between" alignItems="center"><Box sx={{ display: { sm: 'flex' }, alignItems: 'center', gap: 2 }}><Typography color="text.secondary" variant="body2">{actionNames[metric.kind]}</Typography><Typography variant="h4" fontWeight={750} sx={{ mt: 1 }}>{commands.isLoading || commands.isError ? '—' : rows.filter((row: any) => row.kind === metric.kind).length}</Typography></Box><Box sx={{ p: 1.5, borderRadius: 3, bgcolor: metric.color + '12', color: metric.color, display: 'flex' }}><metric.icon /></Box></Stack></CardContent></Card></Grid>)}</Grid>
    <Card sx={{ mb: 2 }}><CardContent><Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
      <TextField label="Rack ID" type="number" size="small" value={rackFilter} onChange={event => setRackFilter(event.target.value)} />
      <TextField select label="Hoạt động" size="small" value={kindFilter} onChange={event => setKindFilter(event.target.value)} sx={{ minWidth: 180 }}><MenuItem value="ALL">Tất cả</MenuItem>{Object.entries(actionNames).map(([key, name]) => <MenuItem key={key} value={key}>{name}</MenuItem>)}</TextField>
      <Button onClick={() => { setRackFilter(''); setKindFilter('ALL') }}>Xóa bộ lọc</Button>
    </Stack></CardContent></Card>
    {commands.isError && <Alert severity="error" sx={{ mb: 1.5 }}>Không tải được lịch sử hoạt động. Vui lòng thử làm mới.</Alert>}
    <Card><Stack direction="row" justifyContent="space-between" sx={{ p: 2 }}><Typography variant="h6" fontWeight={700}>Lịch sử hoạt động</Typography><Chip size="small" label={`${filtered.length} bản ghi`} variant="outlined" /></Stack>
      {commands.isLoading ? <Box sx={{ textAlign: 'center', py: 5 }}><CircularProgress /></Box> : <TableContainer sx={{ maxHeight: 620 }}><Table stickyHeader size="small"><TableHead><TableRow>{['Hoạt động', 'Rack', 'Thời gian', 'Trạng thái', 'Mã bản ghi'].map(label => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead><TableBody>
        {filtered.length === 0 ? <TableRow><TableCell colSpan={5}><EmptyState text="Chưa có hoạt động phù hợp" /></TableCell></TableRow> : filtered.map((row: any) => <TableRow key={row.id} hover>
          <TableCell><Chip size="small" label={row.action === 'HOME' ? 'Đóng tủ · về HOME' : row.action === 'CLOSE' ? 'Đóng rack' : actionNames[row.kind]} color={row.kind === 'VENTILATE' ? 'info' : 'primary'} variant="outlined" /></TableCell><TableCell>{row.rack == null ? '—' : `Rack ${row.rack}`}</TableCell><TableCell sx={{ whiteSpace: 'nowrap' }}>{row.time ? formatDateTime(row.time) : '—'}</TableCell><TableCell><Chip size="small" label={stateNames[row.state] || row.state} color={['failed', 'rejected'].includes(row.state) ? 'error' : row.state.includes('uncertain') ? 'warning' : 'default'} /></TableCell><TableCell sx={{ maxWidth: 240, overflowWrap: 'anywhere', fontFamily: 'monospace', fontSize: 12 }}>{row.id}</TableCell>
        </TableRow>)}
      </TableBody></Table></TableContainer>}
    </Card>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>Hiển thị trong 200 lệnh thiết bị gần nhất. “Đã gửi lệnh” không đồng nghĩa chuyển động đã hoàn tất. Bản ghi cũ chưa có thời gian được hiển thị “—”.</Typography>
  </Box>
}
