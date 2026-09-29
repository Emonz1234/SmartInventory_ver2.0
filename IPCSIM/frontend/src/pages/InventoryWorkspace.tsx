import { useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  InputAdornment,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography
} from '@mui/material'
import { Add, Inventory2, Remove, Search } from '@mui/icons-material'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import api from '@api/client'

interface InventoryWorkspaceProps {
  session: string
  permissions: string[]
  onSessionExpired: () => void
}

interface RecordRow {
  key: string
  kind: string
  data: Record<string, any>
}

export const InventoryWorkspace = ({ session, permissions, onSessionExpired }: InventoryWorkspaceProps) => {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [selectedItem, setSelectedItem] = useState<Record<string, any> | null>(null)
  const [kind, setKind] = useState<'PICK' | 'PUT'>('PICK')
  const [binId, setBinId] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const headers = { 'X-Operator-Session': session }

  const snapshot = useQuery({
    queryKey: ['inventory-workspace'],
    queryFn: async () => (await api.get('/device/snapshot')).data,
    refetchInterval: 3000
  })
  const state = snapshot.data || {}
  const health = state.health || {}
  const records: RecordRow[] = state.records || []
  const ofKind = (recordKind: string) => records.filter(record => record.kind === recordKind).map(record => record.data)
  const items = ofKind('item').filter(item => item.is_active)
  const bins = ofKind('bin')
  const shelves = ofKind('shelf')
  const racks = ofKind('rack')
  const cabinets = ofKind('cabinet')
  const stocks = ofKind('stock')
  const stockByItemBin = new Map(stocks.map(stock => [`${stock.item_id}:${stock.bin_id}`, Number(stock.quantity || 0)]))
  const locations = bins.flatMap(bin => {
    const shelf = shelves.find(row => row.id === bin.shelf_id)
    const rack = racks.find(row => row.id === shelf?.rack_id)
    const cabinet = cabinets.find(row => row.id === rack?.cabinet_id)
    if (!shelf || !rack || !cabinet) return []
    return [{
      bin,
      rack,
      locationId: Number(rack.id),
      label: `${cabinet.cabinet_code} · Rack ${rack.rack_code} · ${shelf.shelf_code} · ${bin.bin_code}`
    }]
  })
  const filteredItems = items.filter(item => {
    const query = search.trim().toLowerCase()
    return !query || `${item.item_code} ${item.item_name} ${item.category}`.toLowerCase().includes(query)
  })
  const selectedLocations = selectedItem
    ? locations.filter(location => kind === 'PUT' || (stockByItemBin.get(`${selectedItem.id}:${location.bin.id}`) || 0) > 0)
    : []
  const selectedLocation = selectedLocations.find(location => String(location.bin.id) === binId)
  const serialReady = selectedLocation && (
    !Object.keys(health.serial_groups || {}).length || health.serial_routes?.[selectedLocation.locationId] === true
  )
  const ready = health.device_type === 'IPCSIM' && health.server_online && health.server_synced && health.serial_connected && serialReady
  const canOperate = permissions.includes('inventory.add_operation')

  function openItem(item: Record<string, any>) {
    setSelectedItem(item)
    setKind('PICK')
    setBinId('')
    setQuantity(1)
    setError('')
  }

  async function submitOperation() {
    if (!selectedItem || !selectedLocation || !Number.isInteger(quantity) || quantity < 1) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const requestKey = Array.from(crypto.getRandomValues(new Uint8Array(24)), value => value.toString(16).padStart(2, '0')).join('')
      const response = await api.post('/operator/operations', {
        rack_id: selectedLocation.locationId,
        bin_id: selectedLocation.bin.id,
        item_id: selectedItem.id,
        kind,
        quantity,
        request_key: requestKey
      }, { headers })
      setNotice(`${kind} đã tạo · ${selectedItem.item_code} · lệnh ${response.data.id}`)
      setSelectedItem(null)
    } catch (failure: any) {
      if (failure.response?.status === 403) onSessionExpired()
      setError(failure.response?.data?.detail || failure.message || 'Không tạo được thao tác.')
    } finally {
      setBusy(false)
    }
  }

  return <Stack spacing={2}>
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1}>
      <Box>
        <Typography variant="h4">Hàng hóa</Typography>
        <Typography color="text.secondary">{items.length} loại hàng hóa trong catalog</Typography>
      </Box>
      <TextField
        size="small"
        label="Tìm hàng hóa"
        value={search}
        onChange={event => setSearch(event.target.value)}
        sx={{ width: { xs: '100%', sm: 300 } }}
        InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }}
      />
    </Stack>

    {snapshot.isLoading && <Box sx={{ display: 'grid', placeItems: 'center', minHeight: 160 }}><CircularProgress /></Box>}
    {snapshot.isError && <Alert severity="error">Không đọc được catalog từ IPCSIM.</Alert>}
    {notice && <Alert severity="success" action={<Button color="inherit" size="small" onClick={() => navigate('/operation')}>Xem lệnh</Button>}>{notice}</Alert>}
    {!health.server_synced && <Alert severity="info">Catalog đang chờ đồng bộ từ Server; thao tác hàng hóa hiện chưa khả dụng.</Alert>}

    {!snapshot.isLoading && !snapshot.isError && <TableContainer sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
      <Table size="small">
        <TableHead><TableRow>
          <TableCell>Hàng hóa</TableCell>
          <TableCell>Category</TableCell>
          <TableCell align="right">Tồn hiện tại</TableCell>
          <TableCell align="right">Thao tác</TableCell>
        </TableRow></TableHead>
        <TableBody>
          {filteredItems.map(item => {
            const total = stocks.filter(stock => stock.item_id === item.id).reduce((sum, stock) => sum + Number(stock.quantity || 0), 0)
            return <TableRow key={item.id} hover>
              <TableCell>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Inventory2 fontSize="small" color="action" />
                  <Box><Typography variant="body2" fontWeight={700}>{item.item_name}</Typography><Typography variant="caption" color="text.secondary">{item.item_code} · {item.unit}</Typography></Box>
                </Stack>
              </TableCell>
              <TableCell>{item.category || '—'}</TableCell>
              <TableCell align="right">{total}</TableCell>
              <TableCell align="right"><Button size="small" onClick={() => openItem(item)}>PICK / PUT</Button></TableCell>
            </TableRow>
          })}
          {!filteredItems.length && <TableRow><TableCell colSpan={4} align="center" sx={{ py: 5 }}>
            <Typography color="text.secondary">{items.length ? 'Không tìm thấy hàng hóa.' : 'Chưa có hàng hóa trong catalog.'}</Typography>
          </TableCell></TableRow>}
        </TableBody>
      </Table>
    </TableContainer>}

    <Dialog open={!!selectedItem} onClose={() => !busy && setSelectedItem(null)} fullWidth maxWidth="sm">
      <DialogTitle>{selectedItem?.item_name}<Typography variant="body2" color="text.secondary">{selectedItem?.item_code} · {selectedItem?.unit}</Typography></DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Stack spacing={2} sx={{ pt: 1 }}>
          <ToggleButtonGroup
            exclusive
            fullWidth
            value={kind}
            onChange={(_, value: 'PICK' | 'PUT' | null) => { if (value) { setKind(value); setBinId('') } }}
            aria-label="Loại thao tác hàng hóa"
          >
            <ToggleButton value="PICK" aria-label="PICK"><Remove sx={{ mr: 1 }} />PICK</ToggleButton>
            <ToggleButton value="PUT" aria-label="PUT"><Add sx={{ mr: 1 }} />PUT</ToggleButton>
          </ToggleButtonGroup>
          <TextField select label="Vị trí" value={binId} onChange={event => setBinId(event.target.value)} required>
            {selectedLocations.map(location => {
              const available = stockByItemBin.get(`${selectedItem?.id}:${location.bin.id}`) || 0
              return <MenuItem key={location.bin.id} value={location.bin.id}>
                {location.label}{kind === 'PICK' ? ` · tồn ${available}` : ` · hiện có ${available}`}
              </MenuItem>
            })}
          </TextField>
          {!selectedLocations.length && <Alert severity="info">{kind === 'PICK' ? 'Hàng hóa chưa có tồn ở vị trí nào.' : 'Server chưa khai báo ô chứa cho rack.'}</Alert>}
          <TextField label="Số lượng" type="number" inputProps={{ min: 1, step: 1 }} value={quantity} onChange={event => setQuantity(Number(event.target.value))} />
          {!canOperate && <Alert severity="warning">Tài khoản hiện tại không có quyền tạo thao tác tồn kho.</Alert>}
          {selectedLocation && !ready && <Alert severity="warning">Yêu cầu Server online, đồng bộ dữ liệu và Serial sẵn sàng cho vị trí đã chọn.</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setSelectedItem(null)} disabled={busy}>Hủy</Button>
        <Button variant="contained" onClick={() => void submitOperation()} disabled={
          busy || !canOperate || !ready || !selectedLocation || !Number.isInteger(quantity) || quantity < 1
        }>{busy ? 'Đang gửi…' : `Tạo ${kind}`}</Button>
      </DialogActions>
    </Dialog>
  </Stack>
}