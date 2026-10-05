import { t as uiText, statusText, useLanguage } from '../i18n';
import { useEffect, useState } from 'react'
import { Alert, Box, Button, Card, CardContent, Chip, Grid, InputAdornment, MenuItem, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TablePagination, TextField, Typography, Skeleton } from '@mui/material'
import { Search, Refresh, ArrowDownward, ArrowUpward, ReceiptLongOutlined } from '@mui/icons-material'
import { useQuery } from '@tanstack/react-query'
import api from '@api/client'
import { transactionsAPI } from '@api/transactions'
import { formatDateTime, parseVietnamDate } from '@utils/date'
import { PageHeader, EmptyState } from '@components/PageHeader'
const states: Record<string, string> = { COMPLETED: 'Hoàn tất', FAILED: 'Thất bại', CANCELLED: 'Đã hủy', UNCERTAIN: 'Cần kiểm tra', PREPARED: 'Đã chuẩn bị', EXECUTING: 'Đang thực hiện', AWAITING_CONFIRMATION: 'Chờ xác nhận' }
export const Transactions = ({ session, onSessionExpired }: { session: string; onSessionExpired: () => void }) => {
  useLanguage();
  const [search, setSearch] = useState(''), [type, setType] = useState('ALL'), [page, setPage] = useState(0)
  const history = useQuery({ queryKey: ['transactions'], queryFn: async () => (await transactionsAPI.list()).data, refetchInterval: 5000 })
  const local = useQuery({ queryKey: ['local-transactions', session], enabled: !!session, queryFn: async () => (await api.get('/operator/operations', { headers: { 'X-Operator-Session': session } })).data, refetchInterval: 3000, retry: false })
  const items = useQuery({ queryKey: ['transaction-items'], queryFn: async () => (await api.get('/items')).data })
  useEffect(() => { if ((local.error as any)?.response?.status === 403) onSessionExpired() }, [local.error, onSessionExpired])
  const localRows = (local.data || []).filter((row: any) => ['PICK', 'PUT', 'ADJUST'].includes(row.operation_type || row.kind)).map((row: any) => {
    const item = (items.data || []).find((item: any) => item.id === row.product_id)
    return { id: row.transaction_id || row.id, item_id: row.product_id, item_code: item?.item_code, item_name: item?.item_name, kind: row.operation_type || row.kind, quantity: row.quantity, rack: row.rack_id, location: row.cabinet_index && row.rack_index ? `${row.device_code || row.ipc_id} / Cabinet ${String(row.cabinet_index).padStart(2, '0')} / Rack ${String(row.rack_index).padStart(2, '0')}` : null, user: row.user_id, time: row.created_at, state: row.operation_status, sync: row.sync_status, reference: row.transaction_id || row.id }
  })
  const localIds = new Set(localRows.map((row: any) => String(row.id)))
  const rows = [...localRows, ...(history.data || []).filter((row: any) => !localIds.has(String(row.reference_no))).map((row: any) => ({ id: `history-${row.id}`, item_id: row.item_id, item_code: row.item_code, item_name: row.item_name, kind: row.transaction_type, quantity: row.quantity, rack: null, location: null, user: row.user_id, time: row.created_at, state: 'COMPLETED', sync: null, reference: row.reference_no || String(row.id) }))]
    .sort((a, b) => (parseVietnamDate(b.time)?.getTime() || 0) - (parseVietnamDate(a.time)?.getTime() || 0))
  const filtered = rows.filter(row => (type === 'ALL' || row.kind === type) && [row.item_id, row.item_code, row.item_name, row.reference].some(value => String(value || '').toLowerCase().includes(search.trim().toLowerCase())))
  const loading = history.isLoading || local.isLoading
  return <Box>
    <PageHeader title={uiText("Giao dịch hàng hóa")} description={uiText("Theo dõi nhập, xuất sản phẩm cùng trạng thái xử lý và đồng bộ. Thực hiện PICK / PUT tại trang Kho hàng.")} action={<Button startIcon={<Refresh />} variant="outlined" disabled={history.isFetching || local.isFetching} onClick={() => { void history.refetch(); void local.refetch() }}>{uiText("Làm mới")}</Button>} />
    <Grid container spacing={1.5} sx={{ mb: 2 }}>{[
      { label: 'Tổng giao dịch', value: rows.length, icon: ReceiptLongOutlined, color: '#087c78' },
      { label: 'Nhập hàng · PUT', value: rows.filter(row => row.kind === 'PUT').length, icon: ArrowDownward, color: '#3274ad' },
      { label: 'Xuất hàng · PICK', value: rows.filter(row => row.kind === 'PICK').length, icon: ArrowUpward, color: '#bb7837' }
    ].map(stat => <Grid item xs={12} sm={4} key={stat.label}><Card><CardContent><Stack direction="row" justifyContent="space-between" alignItems="center"><Box><Typography variant="body2" color="text.secondary">{uiText(stat.label)}</Typography><Typography variant="h4" fontWeight={750} sx={{ mt: 1 }}>{loading ? '—' : stat.value}</Typography></Box><Box sx={{ display: 'flex', p: 1.5, borderRadius: 3, color: stat.color, bgcolor: stat.color + '12' }}><stat.icon /></Box></Stack></CardContent></Card></Grid>)}</Grid>
    <Card sx={{ mb: 2 }}><CardContent><Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
      <TextField size="small" label={uiText("Tìm sản phẩm hoặc mã giao dịch")} value={search} onChange={event => { setSearch(event.target.value); setPage(0) }} sx={{ flex: 1 }} InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }} />
      <TextField select size="small" label={uiText("Loại giao dịch")} value={type} onChange={event => { setType(event.target.value); setPage(0) }} sx={{ minWidth: 190 }}>{[['ALL', 'Tất cả'], ['PUT', 'Nhập hàng · PUT'], ['PICK', 'Xuất hàng · PICK'], ['ADJUST', 'Điều chỉnh'], ['INITIAL', 'Tồn kho ban đầu']].map(([key, label]) => <MenuItem key={key} value={key}>{uiText(label)}</MenuItem>)}</TextField>
      <Button onClick={() => { setSearch(''); setType('ALL'); setPage(0) }}>{uiText("Xóa bộ lọc")}</Button>
    </Stack></CardContent></Card>
    {history.isError && <Alert severity="error" sx={{ mb: 1.5 }}>{uiText("Không tải được lịch sử giao dịch. Vui lòng làm mới.")}</Alert>}
    {local.isError && <Alert severity="error" sx={{ mb: 1.5 }}>{uiText("Không tải được giao dịch local. Vui lòng kiểm tra kết nối và phiên đăng nhập.")}</Alert>}
    <Card><Stack direction="row" justifyContent="space-between" sx={{ p: 2 }}><Typography variant="h6" fontWeight={700}>{uiText("Lịch sử giao dịch")}</Typography><Chip size="small" variant="outlined" label={uiText("{0} bản ghi", filtered.length)} /></Stack>
      <TableContainer><Table size="small"><TableHead><TableRow>{['Sản phẩm', 'Loại', 'Số lượng', 'Vị trí', 'Trạng thái', 'Thời gian', 'Mã giao dịch'].map(label => <TableCell key={label}>{uiText(label)}</TableCell>)}</TableRow></TableHead><TableBody>
        {loading ? Array.from({ length: 5 }, (_, index) => <TableRow key={index}><TableCell colSpan={7}><Skeleton height={40} /></TableCell></TableRow>) : filtered.length === 0 ? <TableRow><TableCell colSpan={7}><EmptyState text={uiText("Chưa có giao dịch phù hợp")} /></TableCell></TableRow> : filtered.slice(Math.min(page, Math.max(0, Math.ceil(filtered.length / 15) - 1)) * 15, (Math.min(page, Math.max(0, Math.ceil(filtered.length / 15) - 1)) + 1) * 15).map(row => <TableRow hover key={row.id}>
          <TableCell><Typography variant="body2" fontWeight={650}>{(row.item_name || uiText("Sản phẩm #{0}", row.item_id))}</Typography><Typography variant="caption" color="text.secondary">{(row.item_code || `ID ${row.item_id}`)}</Typography></TableCell>
          <TableCell><Chip size="small" label={statusText(row.kind)} color={row.kind === 'PUT' ? 'success' : row.kind === 'PICK' ? 'warning' : 'default'} variant="outlined" /></TableCell>
          <TableCell align="right" sx={{ fontWeight: 700 }}>{row.quantity}</TableCell><TableCell>{(row.location || (row.rack ? `Rack ID ${row.rack}` : '—'))}</TableCell>
          <TableCell><Chip size="small" label={statusText(states[row.state] || row.state)} color={row.state === 'COMPLETED' ? 'success' : row.state === 'FAILED' ? 'error' : 'default'} variant="outlined" />{row.sync && <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>{statusText(row.sync)}</Typography>}</TableCell>
          <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(row.time)}</TableCell><TableCell sx={{ maxWidth: 210, overflowWrap: 'anywhere', fontSize: 12 }}>{row.reference}</TableCell>
        </TableRow>)}
      </TableBody></Table></TableContainer>
      <TablePagination component="div" count={filtered.length} rowsPerPage={15} rowsPerPageOptions={[15]} page={Math.min(page, Math.max(0, Math.ceil(filtered.length / 15) - 1))} onPageChange={(_, value) => setPage(value)} labelDisplayedRows={({ from, to, count }) => `${from}–${to} / ${count}`} />
    </Card>
  </Box>
}
