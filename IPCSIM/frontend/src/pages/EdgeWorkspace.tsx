import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Alert, Box, Button, Card, CardContent, Chip, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import api from '@api/client'

function Rows({ rows }: { rows: any[] }) {
  const columns = Array.from(new Set(rows.flatMap(row => Object.keys(row))))
  return <Box sx={{ overflowX: 'auto' }}><Table size="small"><TableHead><TableRow>{columns.map(key => <TableCell key={key}>{key}</TableCell>)}</TableRow></TableHead><TableBody>{rows.map((row, i) => <TableRow key={row.id || i}>{columns.map(key => <TableCell key={key}>{typeof row[key] === 'object' ? JSON.stringify(row[key]) : String(row[key] ?? '—')}</TableCell>)}</TableRow>)}</TableBody></Table>{!rows.length && <Typography sx={{ p: 2 }}>Chưa có dữ liệu. Không tự tạo tồn kho hoặc trạng thái thiết bị.</Typography>}</Box>
}

export const EdgeWorkspace = () => {
  const [params] = useSearchParams()
  const [login, setLogin] = useState({ username: '', password: '' })
  const [session, setSession] = useState('')
  const [permissions, setPermissions] = useState<string[]>([])
  const [cabinet, setCabinet] = useState(params.get('cabinet') || ''), [rack, setRack] = useState(params.get('rack') || '')
  const [item, setItem] = useState(''), [bin, setBin] = useState('')
  const [quantity, setQuantity] = useState(1), [note, setNote] = useState('')
  const [operation, setOperation] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const headers = { 'X-Operator-Session': session }
  const snapshot = useQuery({ queryKey: ['edge-workspace'], queryFn: async () => (await api.get('/device/snapshot')).data, refetchInterval: 2000 })
  const operations = useQuery({ queryKey: ['edge-operations', session], enabled: !!session,
    queryFn: async () => (await api.get('/operator/operations', { headers })).data, refetchInterval: 3000, retry: false })
  const state = snapshot.data || {}, health = state.health || {}, records: any[] = state.records || []
  const ofKind = (kind: string) => records.filter(r => r.kind === kind).map(r => r.data)
  const cabinets = ofKind('cabinet'), allRacks = ofKind('rack'), items = ofKind('item')
  const racks = allRacks.filter(r => !cabinet || r.cabinet_id === Number(cabinet))
  const shelves = ofKind('shelf').filter(s => s.rack_id === Number(rack))
  const bins = ofKind('bin').filter(b => shelves.some(s => s.id === b.shelf_id))
  const groupReady = !Object.keys(health.serial_groups || {}).length || health.serial_routes?.[rack] === true
  const ready = health.server_synced && health.serial_connected && groupReady && health.device_type === 'IPCSIM' && !snapshot.isError
  const canOperate = permissions.includes('inventory.add_operation')
  const canConfirm = permissions.includes('inventory.change_operation')
  const pending = (operations.data || []).filter((op: any) => !['confirmed', 'failed', 'cancelled'].includes(op.state))
  async function act(work: () => Promise<any>) {
    setBusy(true); setError(''); setNotice('')
    try { await work(); await snapshot.refetch(); if (session) await operations.refetch() }
    catch (e: any) { setError(e.response?.data?.detail || e.message) }
    finally { setBusy(false) }
  }
  async function send(kind: string) {
    const requestKey = Array.from(crypto.getRandomValues(new Uint8Array(24)), n => n.toString(16).padStart(2, '0')).join('')
    const body: any = { rack_id: Number(rack), kind, request_key: requestKey }
    if (['PUT', 'PICK', 'ADJUST'].includes(kind)) Object.assign(body, { item_id: Number(item), bin_id: Number(bin), quantity })
    const response = await api.post('/operator/operations', body, { headers })
    setNotice(`Lệnh ${response.data.id}: ${response.data.state}. Chưa xác nhận tồn kho.`)
  }
  return <Stack spacing={2}>
    <Typography variant="h4">{health.device_id || 'Edge'} · Vận hành cục bộ</Typography>
    <Stack direction="row" spacing={1} flexWrap="wrap">
      <Chip label={`Server: ${health.server_online ? 'online' : 'offline'}`} color={health.server_online ? 'success' : 'default'} />
      <Chip label={`Serial: ${health.serial_connected ? 'connected' : 'disconnected'}`} />
      <Chip label={`Revision ${health.revision ?? '—'} · ${health.server_synced ? 'đã đồng bộ' : 'chờ đồng bộ'}`} />
      <Chip label={`${cabinets.length} tủ/nhóm · ${allRacks.length} rack · Outbox ${state.outbox_count ?? '—'}`} />
    </Stack>
    {health.device_type === 'IPC' && <Alert severity="warning">Hardware chưa phát triển. Các tủ/ô chứa chưa đặc tả được đánh dấu chờ cấu hình; không có phản hồi thành công giả.</Alert>}
    {!ready && <Alert severity="info">Đọc dữ liệu cache được giữ tại thiết bị. Điều khiển và thay đổi tồn kho yêu cầu Server online, revision đồng bộ và Serial sẵn sàng.</Alert>}
    {snapshot.isError && <Alert severity="error">Không đọc được API local; dữ liệu hiển thị là lần nhận gần nhất.</Alert>}
    {operations.isError && <Alert severity="warning">Không lấy được lịch sử Server. Kiểm tra kết nối/phiên đăng nhập trước khi gửi lại lệnh.</Alert>}
    {error && <Alert severity="error">{error}</Alert>}{notice && <Alert severity="success">{notice}</Alert>}
    <Card><CardContent><Typography variant="h6">Tài khoản vận hành Server</Typography>
      {!session ? <Stack component="form" direction={{ xs: 'column', md: 'row' }} spacing={2} onSubmit={event => {
        event.preventDefault(); void act(async () => {
          const response = await api.post('/operator/login', login)
          setSession(response.data.session); setPermissions(response.data.permissions || []); setLogin({ ...login, password: '' })
        })
      }}><TextField label="Tên đăng nhập" value={login.username} onChange={e => setLogin({ ...login, username: e.target.value })} required />
        <TextField label="Mật khẩu" type="password" value={login.password} onChange={e => setLogin({ ...login, password: e.target.value })} required />
        <Button type="submit" disabled={busy}>Đăng nhập</Button></Stack> : <Button onClick={() => void act(async () => { await api.post('/operator/logout', {}, { headers }); setSession(''); setPermissions([]) })}>Đăng xuất {login.username}</Button>}
    </CardContent></Card>
    <Card><CardContent><Typography variant="h6">Chọn vị trí và thao tác</Typography><Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ my: 2 }}>
      <TextField select label="Tủ/nhóm" value={cabinet} onChange={e => { setCabinet(e.target.value); setRack(''); setBin('') }} sx={{ minWidth: 190 }}><MenuItem value="">Tất cả</MenuItem>{cabinets.map(c => <MenuItem key={c.id} value={c.id}>{c.cabinet_code} · {c.cabinet_name}</MenuItem>)}</TextField>
      <TextField select label="Rack / địa chỉ Serial" value={rack} onChange={e => { setRack(e.target.value); setBin('') }} sx={{ minWidth: 200 }}><MenuItem value="">Chọn rack</MenuItem>{racks.map(r => <MenuItem key={r.id} value={r.id}>{r.rack_name} · address {r.rack_code}</MenuItem>)}</TextField>
    </Stack><Stack direction="row" spacing={1}>{['OPEN', 'CLOSE', 'VENTILATE', 'LIGHT'].map(kind => <Button key={kind} disabled={!ready || !canOperate || !rack || busy} onClick={() => void act(() => send(kind))}>{kind}</Button>)}</Stack>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ my: 2 }}>
        <TextField select label="Hàng hóa" value={item} onChange={e => setItem(e.target.value)} sx={{ minWidth: 190 }}><MenuItem value="">Chọn hàng</MenuItem>{items.filter(i => i.is_active).map(i => <MenuItem key={i.id} value={i.id}>{i.item_code} · {i.item_name}</MenuItem>)}</TextField>
        <TextField select label="Ô chứa" value={bin} onChange={e => setBin(e.target.value)} sx={{ minWidth: 190 }}><MenuItem value="">Chọn ô</MenuItem>{bins.map(b => <MenuItem key={b.id} value={b.id}>{b.bin_code}</MenuItem>)}</TextField>
        <TextField label="Số lượng" type="number" inputProps={{ min: 0, step: 1 }} value={quantity} onChange={e => setQuantity(Number(e.target.value))} />
      </Stack><Stack direction="row" spacing={1}>{['PUT', 'PICK', 'ADJUST'].map(kind => <Button key={kind} disabled={!ready || !canOperate || !rack || !item || !bin || busy || !Number.isInteger(quantity) || quantity < (kind === 'ADJUST' ? 0 : 1)} onClick={() => void act(() => send(kind))}>{kind}</Button>)}</Stack>
      {!bins.length && <Typography sx={{ mt: 1 }}>Chưa cấu hình ô chứa cho rack này. Quản trị tại Server; không tự giả định cấu trúc.</Typography>}
    </CardContent></Card>
    <Card><CardContent><Typography variant="h6">Kết quả và xác nhận</Typography><Rows rows={operations.data || state.pending || []} />
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mt: 2 }}><TextField select label="Lệnh" value={operation} onChange={e => setOperation(e.target.value)} sx={{ minWidth: 230 }}><MenuItem value="">Chọn lệnh</MenuItem>{pending.map((op: any) => <MenuItem key={op.id} value={op.id}>{op.kind} · {op.state} · {op.id}</MenuItem>)}</TextField>
        <TextField label="Bằng chứng / lý do thực tế" value={note} onChange={e => setNote(e.target.value)} fullWidth />
        {[true, false].map(success => <Button key={String(success)} disabled={!canConfirm || !operation || !note.trim() || busy} onClick={() => void act(async () => {
          await api.post(`/operator/operations/${operation}/confirm`, { success, note }, { headers }); setOperation(''); setNote('')
        })}>{success ? 'Xác nhận' : 'Thất bại'}</Button>)}</Stack>
    </CardContent></Card>
    <Card><CardContent><Typography variant="h6">Danh mục hàng hóa (mẫu được đánh dấu is_demo)</Typography><Rows rows={items} /></CardContent></Card>
    <Card><CardContent><Typography variant="h6">Tồn kho đã xác nhận · cache</Typography><Rows rows={ofKind('stock')} /></CardContent></Card>
    <Card><CardContent><Typography variant="h6">Topology từ Server</Typography><Rows rows={cabinets} /></CardContent></Card>
    <Card><CardContent><Typography variant="h6">Ô chứa thuộc rack đã chọn</Typography><Rows rows={bins} /></CardContent></Card>
    <Card><CardContent><Typography variant="h6">Lịch sử thao tác local</Typography><Rows rows={state.operation_history || []} /></CardContent></Card>
    <Card><CardContent><Typography variant="h6">Telemetry / cảnh báo local gần nhất</Typography><Rows rows={state.events || []} /></CardContent></Card>
  </Stack>
}
