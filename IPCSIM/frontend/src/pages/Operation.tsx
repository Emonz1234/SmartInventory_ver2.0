import { t as uiText, useLanguage } from '../i18n';
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, Box, Button, Card, CardContent, Chip, CircularProgress, MenuItem, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography, Grid } from '@mui/material'
import { Refresh, LockOpenOutlined, LockOutlined, Air, CheckCircleOutline, PlayCircleOutline, WarningAmberOutlined, PauseCircleOutline, WifiOffOutlined, HelpOutline, BlockOutlined, ErrorOutline } from '@mui/icons-material'
import api from '@api/client'
import { MaintenanceNotice } from '@components/MaintenanceNotice'
import { formatDateTime } from '@utils/date'
import { PageHeader, EmptyState } from '@components/PageHeader'

const actionNames: Record<string, string> = { OPEN: 'Mở rack', CLOSE: 'Đóng / về HOME', VENTILATE: 'Thông gió' }
const stateNames: Record<string, string> = { moving:'Đang thực hiện', completed:'Đã hoàn thành', fault:'Gặp sự cố', paused:'Đã xử lý lỗi · chờ xác nhận tiếp tục', communication_lost:'Mất kết nối · chưa xác nhận hoàn thành', unconfirmed:'Chưa xác nhận hoàn thành', rejected:'Đã từ chối', failed:'Thất bại' }
const statusAppearance = {
  completed: { icon: CheckCircleOutline, color: '#166534', background: '#ecfdf3', border: '#bbf7d0' },
  moving: { icon: PlayCircleOutline, color: '#1d4ed8', background: '#eff6ff', border: '#bfdbfe' },
  fault: { icon: WarningAmberOutlined, color: '#b91c1c', background: '#fef2f2', border: '#fecaca' },
  paused: { icon: PauseCircleOutline, color: '#92400e', background: '#fffbeb', border: '#fde68a' },
  communication_lost: { icon: WifiOffOutlined, color: '#c2410c', background: '#fff7ed', border: '#fed7aa' },
  unconfirmed: { icon: HelpOutline, color: '#475569', background: '#f8fafc', border: '#e2e8f0' },
  rejected: { icon: BlockOutlined, color: '#b91c1c', background: '#fef2f2', border: '#fecaca' },
  failed: { icon: ErrorOutline, color: '#b91c1c', background: '#fef2f2', border: '#fecaca' },
}
function OperationStatus({ state }: { state: string }) {
  const appearance = statusAppearance[state as keyof typeof statusAppearance] || statusAppearance.unconfirmed
  const Icon = appearance.icon
  return <Chip size="small" icon={<Icon />} label={uiText(stateNames[state] || stateNames.unconfirmed)} sx={{
    width: 'fit-content', maxWidth: 280, height: 'auto', minHeight: 30, borderRadius: '12px',
    color: appearance.color, bgcolor: appearance.background, border: `1px solid ${appearance.border}`,
    fontWeight: 650, fontSize: 12,
    '& .MuiChip-icon': { color: 'inherit', fontSize: 17, ml: '8px', mr: 0 },
    '& .MuiChip-label': { whiteSpace: 'normal', lineHeight: 1.5, px: 1, py: '4px' },
  }} />
}
function parseBody(value: unknown): Record<string, any> {
  if (value && typeof value === 'object') return value as Record<string, any>
  try { return JSON.parse(String(value || '{}')) || {} } catch { return {} }
}
export const Operation = () => {
  useLanguage();
  const [rackFilter, setRackFilter] = useState('')
  const [kindFilter, setKindFilter] = useState('ALL')
  const commands = useQuery({ queryKey: ['operation-command-history'], queryFn: async () => (await api.get('/device/snapshot')).data.operation_history || [], refetchInterval: 3000 })
  const rows = (commands.data || []).map((row: any) => {
    const body = parseBody(row.body)
    const action = String(body.kind || body.action || '').toUpperCase()
    const result = parseBody(row.result)
    const address = Number(body.address)
    const cabinetIndex = body.cabinet_index || (address > 0 ? Math.floor((address-1)/6)+1 : null)
    const rackIndex = body.rack_index || (address > 0 ? (address-1)%6+1 : null)
    return { id: row.id, kind: action === 'HOME' ? 'CLOSE' : action, action, rack: body.rack_id, location: cabinetIndex && rackIndex ? `Cabinet ${String(cabinetIndex).padStart(2, '0')} / Rack ${String(rackIndex).padStart(2, '0')}` : null, state: row.execution_state || result.execution_state || 'unconfirmed', error: row.execution_error || result.error, time: row.created_at || body.created_at, completedAt: row.completed_at, updatedAt: row.updated_at }
  }).filter((row: any) => ['OPEN', 'CLOSE', 'VENTILATE'].includes(row.kind))
  const filtered = rows.filter((row: any) => (!rackFilter || String(row.rack) === rackFilter) && (kindFilter === 'ALL' || row.kind === kindFilter))
  return <Box>
    <MaintenanceNotice />
    <PageHeader title={uiText("Hoạt động thiết bị")} description={uiText("Lịch sử đóng, mở rack và thông gió. Theo dõi giao dịch PICK / PUT tại trang Giao dịch hàng hóa.")} action={<Button variant="outlined" startIcon={<Refresh />} disabled={commands.isFetching} onClick={() => void commands.refetch()}>{uiText("Làm mới")}</Button>} />
    <Grid container spacing={1.5} sx={{ mb: 2 }}>{[
      { kind: 'OPEN', icon: LockOpenOutlined, color: '#087c78' }, { kind: 'CLOSE', icon: LockOutlined, color: '#3274ad' }, { kind: 'VENTILATE', icon: Air, color: '#9172bf' }
    ].map(metric => <Grid item xs={12} sm={4} key={metric.kind}><Card><CardContent><Stack direction="row" justifyContent="space-between" alignItems="center"><Box sx={{ display: { sm: 'flex' }, alignItems: 'center', gap: 2 }}><Typography color="text.secondary" variant="body2">{uiText(actionNames[metric.kind])}</Typography><Typography variant="h4" fontWeight={750} sx={{ mt: 1 }}>{commands.isLoading || commands.isError ? '—' : rows.filter((row: any) => row.kind === metric.kind).length}</Typography></Box><Box sx={{ p: 1.5, borderRadius: 3, bgcolor: metric.color + '12', color: metric.color, display: 'flex' }}><metric.icon /></Box></Stack></CardContent></Card></Grid>)}</Grid>
    <Card sx={{ mb: 2 }}><CardContent><Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
      <TextField label={uiText("Rack ID kỹ thuật")} type="number" size="small" value={rackFilter} onChange={event => setRackFilter(event.target.value)} />
      <TextField select label={uiText("Hoạt động")} size="small" value={kindFilter} onChange={event => setKindFilter(event.target.value)} sx={{ minWidth: 180 }}><MenuItem value="ALL">{uiText("Tất cả")}</MenuItem>{Object.entries(actionNames).map(([key, name]) => <MenuItem key={key} value={key}>{uiText(name)}</MenuItem>)}</TextField>
      <Button onClick={() => { setRackFilter(''); setKindFilter('ALL') }}>{uiText("Xóa bộ lọc")}</Button>
    </Stack></CardContent></Card>
    {commands.isError && <Alert severity="error" sx={{ mb: 1.5 }}>{uiText("Không tải được lịch sử hoạt động. Vui lòng thử làm mới.")}</Alert>}
    <Card><Stack direction="row" justifyContent="space-between" sx={{ p: 2 }}><Typography variant="h6" fontWeight={700}>{uiText("Lịch sử hoạt động")}</Typography><Chip size="small" label={uiText("{0} bản ghi", filtered.length)} variant="outlined" /></Stack>
      {commands.isLoading ? <Box sx={{ textAlign: 'center', py: 5 }}><CircularProgress /></Box> : <TableContainer sx={{ maxHeight: 620 }}><Table stickyHeader size="small" aria-label={uiText('Lịch sử hoạt động')}><TableHead><TableRow>{['Hoạt động', 'Rack', 'Bắt đầu / ghi nhận', 'Hoàn thành', 'Trạng thái', 'Mã bản ghi'].map(label => <TableCell key={label}>{uiText(label)}</TableCell>)}</TableRow></TableHead><TableBody>
        {filtered.length === 0 ? <TableRow><TableCell colSpan={6}><EmptyState text={uiText("Chưa có hoạt động phù hợp")} /></TableCell></TableRow> : filtered.map((row: any) => <TableRow key={row.id} hover>
          <TableCell><Chip size="small" label={row.action === 'HOME' ? uiText('Đóng tủ · về HOME') : row.action === 'CLOSE' ? uiText('Đóng rack') : uiText(actionNames[row.kind])} color={row.kind === 'VENTILATE' ? 'info' : 'primary'} variant="outlined" /></TableCell><TableCell>{(row.location || (row.rack == null ? '—' : `Rack ID ${row.rack}`))}</TableCell><TableCell sx={{ whiteSpace: 'nowrap' }}>{row.time ? formatDateTime(row.time) : '—'}</TableCell><TableCell sx={{ whiteSpace:'nowrap' }}>{row.completedAt ? formatDateTime(row.completedAt) : '—'}</TableCell><TableCell><Stack spacing={0.75} alignItems="flex-start"><OperationStatus state={row.state} />{row.error && <Typography variant="caption" color="error">{uiText(row.error)} ({row.error})</Typography>}{row.updatedAt && <Typography variant="caption" color="text.secondary">{uiText('Cập nhật')}: {formatDateTime(row.updatedAt)}</Typography>}</Stack></TableCell><TableCell sx={{ maxWidth: 240, overflowWrap: 'anywhere', fontFamily: 'monospace', fontSize: 12 }}>{row.id}</TableCell>
        </TableRow>)}
      </TableBody></Table></TableContainer>}
    </Card>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>{uiText('Chỉ hiển thị hoàn thành khi thiết bị xác nhận đúng điểm kết thúc. Bản ghi cũ thiếu bằng chứng hoặc thời gian được giữ ở trạng thái chưa xác nhận / —.')}</Typography>
  </Box>
}
