import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, Drawer, FormControl, IconButton,
  InputAdornment, InputLabel, MenuItem, Paper, Select, Skeleton, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField,
  ToggleButton, ToggleButtonGroup, Tooltip, Typography, LinearProgress
} from '@mui/material'
import { Add, Close, InfoOutlined, Inventory2, LocationOn, Remove, Search, Tune, Refresh, WarningAmberOutlined, ScaleOutlined } from '@mui/icons-material'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import api from '@api/client'
import { cabinetAPI } from '@api/cabinet'
import { PageHeader } from '@components/PageHeader'

interface InventoryWorkspaceProps {
  session: string
  permissions: string[]
  onSessionExpired: () => void
}

type OperationKind = 'PICK' | 'PUT'
type ViewMode = 'product' | 'location'

const unavailableStatuses = ['BUSY', 'MOVING', 'OFFLINE', 'FAULT', 'ERROR', 'BREAKDOWN']
const inventoryFont = '"Segoe UI", Arial, sans-serif'

function makeKey() {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), value => value.toString(16).padStart(2, '0')).join('')
}

function statusLabel(status: string) {
  return ({ READY: 'Sẵn sàng', AVAILABLE: 'Sẵn sàng', FULL: 'Đầy', EMPTY: 'Trống', ACTIVE: 'Hoạt động', CLOSED: 'Đã đóng', OPEN: 'Đã mở', BUSY: 'Đang bận', MOVING: 'Đang di chuyển', OFFLINE: 'Mất kết nối', FAULT: 'Có lỗi', ERROR: 'Có lỗi', BREAKDOWN: 'Có lỗi', SYNCED: 'Đã đồng bộ', PENDING: 'Đang chờ', 'LOW STOCK': 'Sắp hết hàng', 'OUT OF STOCK': 'Hết hàng' } as Record<string, string>)[status] || status || 'Chưa xác định'
}

function statusColor(status: string): 'success' | 'warning' | 'error' | 'default' {
  const normalized = status.toUpperCase()
  if (['READY', 'AVAILABLE', 'ACTIVE', 'CLOSED', 'OPEN', 'SYNCED'].includes(normalized)) return 'success'
  if (['FULL', 'BUSY', 'MOVING', 'PENDING', 'LOW STOCK'].includes(normalized)) return 'warning'
  if (['OFFLINE', 'FAULT', 'ERROR', 'BREAKDOWN', 'OUT OF STOCK'].includes(normalized)) return 'error'
  return 'default'
}

function LocationStatus({ status }: { status: string }) {
  const label = ({ READY: 'Sẵn sàng', AVAILABLE: 'Sẵn sàng', FULL: 'Đầy', EMPTY: 'Trống', BUSY: 'Đang bận', MOVING: 'Đang di chuyển', OFFLINE: 'Mất kết nối', FAULT: 'Có lỗi', ERROR: 'Có lỗi', BREAKDOWN: 'Có lỗi' } as Record<string, string>)[status] || statusLabel(status)
  return <Chip className="inventory-status-chip" size="small" label={label} color={statusColor(status)} variant="outlined" />
}

function stockStatus(quantity: number, minimum: number) {
  if (quantity <= 0) return { label: 'Out of stock', color: 'error' as const }
  if (minimum > 0 && quantity < minimum) return { label: 'Low stock', color: 'warning' as const }
  return { label: 'Available', color: 'success' as const }
}

function isCabinetActive(cabinet: any) {
  return String(cabinet?.status || '').toUpperCase() === 'ACTIVE'
}

function availableQuantity(item: any, cabinetById?: Map<number, any>) {
  return (item.locations || [])
    .filter((location: any) => {
      const cabinet = cabinetById?.get(Number(location.cabinet.id)) || location.cabinet
      return isCabinetActive(cabinet) && !unavailableStatuses.includes(location.status)
    })
    .reduce((total: number, location: any) => total + location.quantity, 0)
}

function cabinetLabel(cabinet: any) {
  const name = String(cabinet.cabinet_name || '').trim()
  if (name && !/^cabinet$/i.test(name)) return name
  const code = String(cabinet.cabinet_code || '')
  const number = code.match(/(?:SIM[-_ ]?)?C(\d+)$/i)?.[1]
  return number ? `Cabinet ${number}` : `Cabinet ${code || cabinet.id}`
}

function rackLabel(rack: any) {
  return rack.rack_name || `Rack ${rack.rack_code}`
}

function cabinetRackLabel(location: any) {
  return `${cabinetLabel(location.cabinet)} · ${rackLabel(location.rack)}`
}

export const InventoryWorkspace = ({ session, permissions, onSessionExpired }: InventoryWorkspaceProps) => {
  const queryClient = useQueryClient()
  const canOperate = permissions.includes('inventory.move')
  const headers = { 'X-Operator-Session': session }
  const requestKeys = useRef(new Map<string, string>())
  const [view, setView] = useState<ViewMode>('product')
  const [search, setSearch] = useState('')
  const [cabinetFilter, setCabinetFilter] = useState('all')
  const [rackFilter, setRackFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [stockFilter, setStockFilter] = useState('all')
  const [filtersOpen, setFiltersOpen] = useState(true)
  const [selectedItem, setSelectedItem] = useState<any | null>(null)
  const [operationItem, setOperationItem] = useState<any | null>(null)
  const [operationKind, setOperationKind] = useState<OperationKind>('PICK')
  const [operationQuantity, setOperationQuantity] = useState(1)
  const [operationLocation, setOperationLocation] = useState('auto')
  const [operationPlan, setOperationPlan] = useState<any[]>([])
  const [planIndex, setPlanIndex] = useState(0)
  const [activeOperationId, setActiveOperationId] = useState('')
  const [operationPhase, setOperationPhase] = useState<'preview' | 'sending' | 'awaiting' | 'closing' | 'done' | 'failed'>('preview')
  const [operationNote, setOperationNote] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const inventoryQuery = useQuery({
    queryKey: ['inventory-workspace'],
    queryFn: async () => {
      const [snapshotResponse, cabinetResponse] = await Promise.all([api.get('/device/snapshot'), cabinetAPI.list()])
      const cabinets = cabinetResponse.data || []
      const racksByCabinet = await Promise.all(cabinets.map(async (cabinet: any) => {
        const response = await cabinetAPI.getRacks(Number(cabinet.id))
        return (response.data || []).map((rack: any) => ({ ...rack, cabinet_id: Number(cabinet.id) }))
      }))
      return { snapshot: snapshotResponse.data, cabinets, racks: racksByCabinet.flat() }
    },
    refetchInterval: 3000,
    retry: false
  })
  const state = inventoryQuery.data?.snapshot || {}
  const health = state.health || {}
  const records: any[] = state.records || []
  const ofKind = (kind: string) => records.filter(record => record.kind === kind).map(record => record.data)
  const items = ofKind('item').filter(item => item.is_active !== false)
  const cabinets: any[] = inventoryQuery.data?.cabinets?.length ? inventoryQuery.data.cabinets : ofKind('cabinet')
  const racks: any[] = inventoryQuery.data?.racks?.length ? inventoryQuery.data.racks : ofKind('rack')
  const shelves = ofKind('shelf')
  const bins = ofKind('bin')
  const stocks = ofKind('stock')
  const stockByItemBin = useMemo(() => new Map(stocks.map(stock => [`${stock.item_id}:${stock.bin_id}`, Number(stock.quantity || 0)])), [stocks])
  const rackById = useMemo(() => new Map(racks.map(rack => [Number(rack.id), rack])), [racks])
  const cabinetById = useMemo(() => new Map(cabinets.map((cabinet: any) => [Number(cabinet.id), cabinet])), [cabinets])
  const locations = useMemo(() => bins.flatMap(bin => {
    const shelf = shelves.find(row => Number(row.id) === Number(bin.shelf_id))
    const rack = shelf && (rackById.get(Number(shelf.rack_id)) || racks.find(row => Number(row.id) === Number(shelf.rack_id)))
    const cabinet = rack && (cabinetById.get(Number(rack.cabinet_id)) || cabinets.find((row: any) => Number(row.id) === Number(rack.cabinet_id)))
    if (!shelf || !rack || !cabinet) return []
    const status = String(rack.status || rack.state || 'READY').toUpperCase()
    return [{ bin, shelf, rack, cabinet, status, quantityFor: (itemId: number) => stockByItemBin.get(`${itemId}:${bin.id}`) || 0 }]
  }), [bins, shelves, racks, cabinets, rackById, cabinetById])
  const itemRows = useMemo(() => items.map(item => {
    const itemLocations = locations.map(location => ({ ...location, quantity: stockByItemBin.get(`${item.id}:${location.bin.id}`) || 0 })).filter(location => location.quantity > 0)
    const total = itemLocations.reduce((sum, location) => sum + location.quantity, 0)
    const row = { ...item, locations: itemLocations, total, stock: stockStatus(total, Number(item.min_qty || 0)) }
    return { ...row, available: availableQuantity(row, cabinetById) }
  }), [items, locations, stockByItemBin, cabinetById])
  const categories = Array.from(new Set(items.map(item => item.category).filter(Boolean)))
  const visibleItems = itemRows.filter(item => {
    const text = `${item.item_name} ${item.item_code} ${item.barcode || item.item_barcode || ''}`.toLowerCase()
    return (!search || text.includes(search.trim().toLowerCase()))
      && (categoryFilter === 'all' || item.category === categoryFilter)
      && (stockFilter === 'all' || item.stock.label === stockFilter)
      && (cabinetFilter === 'all' || item.locations.some((location: any) => String(location.cabinet.id) === cabinetFilter))
      && (rackFilter === 'all' || item.locations.some((location: any) => String(location.rack.id) === rackFilter))
  })
  const visibleLocations = locations.filter(location => {
    const text = `${cabinetLabel(location.cabinet)} ${rackLabel(location.rack)} ${location.bin.bin_code}`.toLowerCase()
    return (!search || text.includes(search.trim().toLowerCase()))
      && (cabinetFilter === 'all' || String(location.cabinet.id) === cabinetFilter)
      && (rackFilter === 'all' || String(location.rack.id) === rackFilter)
  })
  const hasActivePutLocation = locations.some(location => {
    const cabinet = cabinetById.get(Number(location.cabinet.id)) || location.cabinet
    return isCabinetActive(cabinet) && !unavailableStatuses.includes(location.status) && location.status !== 'FULL'
  })
  const activeOperation = useQuery({
    queryKey: ['inventory-operation', session, activeOperationId],
    enabled: !!activeOperationId,
    queryFn: async () => (await api.get('/operator/operations', { headers })).data.find((operation: any) => String(operation.id) === String(activeOperationId)),
    refetchInterval: 1000,
    retry: false
  })

  const locationName = (location: any) => `${cabinetRackLabel(location)} / ${location.bin.bin_code}`
  const openItem = (item: any) => { setSelectedItem(item); setError('') }
  const openOperation = (item: any, kind: OperationKind) => {
    setOperationItem(item); setOperationKind(kind); setOperationQuantity(1); setOperationLocation('auto'); setOperationPlan([]); setPlanIndex(0); setActiveOperationId(''); setOperationPhase('preview'); setOperationNote(''); setError('')
  }
  const buildPlan = () => {
    if (!operationItem || !Number.isInteger(operationQuantity) || operationQuantity < 1) return
    const candidates = locations.filter(location => {
      const cabinet = cabinetById.get(Number(location.cabinet.id)) || location.cabinet
      return isCabinetActive(cabinet) && !unavailableStatuses.includes(location.status) && !(operationKind === 'PUT' && location.status === 'FULL')
    })
      .filter(location => operationKind === 'PICK' ? (stockByItemBin.get(`${operationItem.id}:${location.bin.id}`) || 0) > 0 : true)
      .filter(location => operationLocation === 'auto' || String(location.bin.id) === operationLocation)
      .sort((a, b) => operationKind === 'PICK' ? (stockByItemBin.get(`${operationItem.id}:${b.bin.id}`) || 0) - (stockByItemBin.get(`${operationItem.id}:${a.bin.id}`) || 0) : 0)
    let remaining = operationQuantity
    const plan: any[] = []
    for (const location of candidates) {
      const current = stockByItemBin.get(`${operationItem.id}:${location.bin.id}`) || 0
      const available = operationKind === 'PICK' ? current : Math.max(Number(location.bin.capacity || operationQuantity) - current, 0)
      const amount = Math.min(remaining, available)
      if (amount <= 0) continue
      plan.push({ location, quantity: amount, current, after: operationKind === 'PICK' ? current - amount : current + amount })
      remaining -= amount
      if (!remaining) break
    }
    setOperationPlan(plan)
    setError(remaining ? `Không đủ vị trí khả dụng cho ${remaining} đơn vị.` : '')
  }
  const submitPlanStep = async (index: number, plan = operationPlan) => {
    const step = plan[index]
    if (!step || !operationItem) return
    const currentCabinet = cabinetById.get(Number(step.location.cabinet.id)) || step.location.cabinet
    if (!isCabinetActive(currentCabinet)) {
      setError('Tủ không còn active. Hãy chọn vị trí thuộc một tủ đang active.')
      setOperationPhase('preview')
      setOperationPlan([])
      return
    }
    setOperationPhase('sending'); setError('')
    try {
      const actionKey = `${operationKind}:${operationItem.id}:${step.location.bin.id}:${step.quantity}`
      const requestKey = requestKeys.current.get(actionKey) || makeKey()
      requestKeys.current.set(actionKey, requestKey)
      const response = await api.post('/operator/operations', { rack_id: Number(step.location.rack.id), bin_id: Number(step.location.bin.id), item_id: Number(operationItem.id), kind: operationKind, quantity: step.quantity, request_key: requestKey }, { headers })
      setActiveOperationId(String(response.data.id))
    } catch (failure: any) {
      if (failure.response?.status === 403) onSessionExpired()
      setError(failure.response?.data?.detail || failure.message || 'Không tạo được operation.')
      setOperationPhase('failed')
    }
  }
  useEffect(() => {
    if (activeOperation.isError && (activeOperation.error as any)?.response?.status === 403) onSessionExpired()
    if (!activeOperation.data || String(activeOperation.data.id) !== String(activeOperationId)) return
    const state = activeOperation.data.state
    if (state === 'awaiting_confirmation' && operationPhase === 'sending') setOperationPhase('awaiting')
    if (['failed', 'cancelled', 'uncertain'].includes(state) && ['sending', 'closing'].includes(operationPhase)) setOperationPhase('failed')
    if (['confirmed', 'completed'].includes(state) && operationPhase === 'closing') {
      const nextIndex = planIndex + 1
      if (nextIndex < operationPlan.length) {
        setPlanIndex(nextIndex)
        setOperationNote('')
        void submitPlanStep(nextIndex)
      } else {
        setOperationPhase('done')
        setNotice(`${operationKind} hoàn tất. Rack đã đóng và tồn kho cục bộ đã được cập nhật.`)
        queryClient.invalidateQueries({ queryKey: ['inventory-workspace'] })
      }
    }
  }, [activeOperation.data, activeOperation.error, activeOperation.isError, activeOperationId, onSessionExpired, operationPhase, operationPlan, planIndex, operationKind, queryClient])
  const confirmOperation = async (success: boolean, keepOpen = false) => {
    if (!activeOperationId || !operationNote.trim()) return
    try {
      await api.post(`/operator/operations/${activeOperationId}/confirm`, { success, note: operationNote, keep_open: keepOpen }, { headers })
      if (!success) { setOperationPhase('failed'); return }
      const nextIndex = planIndex + 1
      if (keepOpen && nextIndex < operationPlan.length) { setPlanIndex(nextIndex); setOperationNote(''); await submitPlanStep(nextIndex); return }
      if (keepOpen) {
        setOperationPhase('done')
        setNotice(`${operationKind} hoàn tất. Rack vẫn đang mở và tồn kho cục bộ đã được cập nhật.`)
        queryClient.invalidateQueries({ queryKey: ['inventory-workspace'] })
        return
      }
      setOperationPhase('closing')
    } catch (failure: any) {
      if (failure.response?.status === 403) onSessionExpired()
      setError(failure.response?.data?.detail || failure.message || 'Không xác nhận được operation.')
    }
  }
  const closeOperation = () => { if (!['sending', 'awaiting', 'closing'].includes(operationPhase)) { setOperationItem(null); setOperationPlan([]); setActiveOperationId('') } }
  const pendingTransactions = Number(health.pending_transactions || 0)
  const totalQuantity = itemRows.reduce((sum, item) => sum + item.total, 0)
  const lowStockCount = itemRows.filter(item => item.stock.label === 'Low stock').length
  const currentPlanStep = operationPlan[planIndex]
  const nextPlanStep = operationPlan[planIndex + 1]
  const canKeepOpen = !nextPlanStep || Number(currentPlanStep?.location.rack.id) === Number(nextPlanStep.location.rack.id)

  return <Stack className="inventory-workspace" spacing={2}>
    <PageHeader title="Kho hàng" description="Tìm sản phẩm, kiểm tra tồn kho và vị trí lưu trữ. Mở chi tiết sản phẩm để nhập hoặc xuất hàng." action={<Button variant="outlined" startIcon={<Refresh />} disabled={inventoryQuery.isFetching} onClick={() => void inventoryQuery.refetch()}>Làm mới</Button>} />
    <Box className="inventory-summary" aria-label="Tổng quan kho hàng">
      <SummaryMetric label="Loại sản phẩm" value={inventoryQuery.isLoading || inventoryQuery.isError ? '—' : itemRows.length} icon={<Inventory2 />} />
      <SummaryMetric label="Tổng số lượng" value={inventoryQuery.isLoading || inventoryQuery.isError ? '—' : totalQuantity} icon={<ScaleOutlined />} />
      <SummaryMetric label="Sản phẩm sắp hết" value={inventoryQuery.isLoading || inventoryQuery.isError ? '—' : lowStockCount} icon={<WarningAmberOutlined />} />
      <SummaryMetric label="Vị trí lưu trữ" value={inventoryQuery.isLoading || inventoryQuery.isError ? '—' : locations.length} icon={<LocationOn />} />
    </Box>
    <Paper className="inventory-toolbar" variant="outlined">
      <Box className="inventory-toolbar-heading">
        <TextField
          className="inventory-search"
          size="small"
          label={view === 'product' ? 'Tìm sản phẩm / SKU / mã vạch' : 'Tìm tủ / rack / ô chứa'}
          value={search}
          onChange={event => setSearch(event.target.value)}
          InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }}
        />
        <ToggleButtonGroup className="inventory-view-toggle" exclusive value={view} onChange={(_, value: ViewMode | null) => { if (value && value !== view) { setView(value); setSearch('') } }} size="small" aria-label="Chế độ xem kho">
          <ToggleButton value="product">Sản phẩm</ToggleButton>
          <ToggleButton value="location">Vị trí</ToggleButton>
        </ToggleButtonGroup>
        <Button className="inventory-filter-toggle" size="small" variant="outlined" startIcon={<Tune />} aria-expanded={filtersOpen} onClick={() => setFiltersOpen(value => !value)}>Bộ lọc</Button>
      </Box>
      {filtersOpen && <Box className="inventory-filters">
        <FormControl size="small"><InputLabel>Nhóm tủ</InputLabel><Select value={cabinetFilter} label="Nhóm tủ" onChange={event => { setCabinetFilter(event.target.value); setRackFilter('all') }}><MenuItem value="all">Tất cả tủ</MenuItem>{cabinets.map((cabinet: any) => <MenuItem key={cabinet.id} value={String(cabinet.id)}>{cabinetLabel(cabinet)}</MenuItem>)}</Select></FormControl>
        <FormControl size="small"><InputLabel>Rack</InputLabel><Select value={rackFilter} label="Rack" onChange={event => setRackFilter(event.target.value)}><MenuItem value="all">Tất cả rack</MenuItem>{racks.filter((rack: any) => cabinetFilter === 'all' || String(rack.cabinet_id) === cabinetFilter).map((rack: any) => <MenuItem key={rack.id} value={String(rack.id)}>{rackLabel(rack)}</MenuItem>)}</Select></FormControl>
        <FormControl size="small" disabled={view === 'location'}><InputLabel>Danh mục</InputLabel><Select value={categoryFilter} label="Danh mục" onChange={event => setCategoryFilter(event.target.value)}><MenuItem value="all">Tất cả danh mục</MenuItem>{categories.map(category => <MenuItem key={category} value={category}>{category}</MenuItem>)}</Select></FormControl>
        <FormControl size="small" disabled={view === 'location'}><InputLabel>Tồn kho</InputLabel><Select value={stockFilter} label="Tồn kho" onChange={event => setStockFilter(event.target.value)}><MenuItem value="all">Tất cả trạng thái</MenuItem><MenuItem value="Available">Còn hàng</MenuItem><MenuItem value="Low stock">Sắp hết hàng</MenuItem><MenuItem value="Out of stock">Hết hàng</MenuItem></Select></FormControl>
      </Box>}
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1} sx={{ mt: 1.5 }}>
        <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap"><Chip size="small" label={inventoryQuery.isLoading || inventoryQuery.isError ? 'Kết nối: chưa xác định' : health.server_online ? 'Server online' : 'Server offline'} color={health.server_online ? 'success' : 'default'} variant="outlined" /><Chip size="small" label={pendingTransactions ? `${pendingTransactions} giao dịch chờ` : 'Không có giao dịch chờ'} color={pendingTransactions ? 'warning' : 'default'} variant="outlined" /></Stack>
        <Button size="small" onClick={() => { setSearch(''); setCabinetFilter('all'); setRackFilter('all'); setCategoryFilter('all'); setStockFilter('all') }}>Xóa bộ lọc</Button>
      </Stack>
    </Paper>

    {!health.server_online && <Alert className="inventory-alert" severity="info">Server offline · Vận hành local {health.local_operation_available ? 'available' : 'unavailable'} · {pendingTransactions} giao dịch chờ đồng bộ</Alert>}
    {error && <Alert className="inventory-alert" severity="error" onClose={() => setError('')}>{error}</Alert>}
    {notice && <Alert className="inventory-alert" severity="success" onClose={() => setNotice('')}>{notice}</Alert>}
    {inventoryQuery.isError && <Alert className="inventory-alert" severity="error" action={<Button color="inherit" size="small" onClick={() => void inventoryQuery.refetch()}>Thử lại</Button>}>Không tải được dữ liệu kho hàng hoặc cấu trúc tủ. Vui lòng thử lại.</Alert>}

    <Stack direction="row" justifyContent="space-between" alignItems="center"><Typography variant="h6" fontWeight={700}>{view === 'product' ? 'Danh sách sản phẩm' : 'Vị trí trong kho'}</Typography><Chip size="small" variant="outlined" label={view === 'product' ? `${visibleItems.length} sản phẩm` : `${visibleLocations.length} vị trí`} /></Stack>
    {inventoryQuery.isLoading
      ? <Skeleton className="inventory-loading" variant="rounded" height={280} />
      : view === 'product'
        ? <ProductView items={visibleItems} onSelect={openItem} />
        : <LocationView locations={visibleLocations} stockByItemBin={stockByItemBin} items={items} locationName={locationName} onSelect={location => {
          const item = itemRows.find(row => row.locations.some((candidate: any) => candidate.bin.id === location.bin.id))
          if (item) openItem(item)
        }} />}

    <Drawer anchor="right" sx={{ zIndex: theme => theme.zIndex.drawer + 2 }} open={!!selectedItem} onClose={() => setSelectedItem(null)} PaperProps={{ className: 'inventory-detail-drawer' }}>
      {selectedItem && <Box className="inventory-detail-shell">
        <Box className="inventory-detail-heading">
          <Box className="inventory-detail-title">
            <Typography variant="overline">Chi tiết sản phẩm</Typography>
            <Typography component="h2" className="inventory-detail-name">{selectedItem.item_name}</Typography>
            <Typography className="inventory-detail-sku">SKU {selectedItem.item_code}</Typography>
          </Box>
          <IconButton aria-label="Đóng chi tiết sản phẩm" onClick={() => setSelectedItem(null)}><Close /></IconButton>
        </Box>
        <Box className="inventory-detail-scroll">
          <Box className="inventory-detail-identifiers">
            <Box><Typography variant="caption">Mã vạch</Typography><Typography>{selectedItem.barcode || selectedItem.item_barcode || '—'}</Typography></Box>
            <Box><Typography variant="caption">Danh mục</Typography><Typography>{selectedItem.category || 'Chưa phân loại'}</Typography></Box>
          </Box>
          <Box className="inventory-detail-quantities">
            <Box><Typography variant="caption">Tổng số lượng</Typography><Typography className="inventory-detail-value">{selectedItem.total} <small>{selectedItem.unit || ''}</small></Typography></Box>
            <Box><Typography variant="caption">Có thể xuất</Typography><Typography className="inventory-detail-value">{availableQuantity(selectedItem, cabinetById)} <small>{selectedItem.unit || ''}</small></Typography></Box>
            <LocationStatus status={selectedItem.stock.label.toUpperCase()} />
          </Box>
          <Divider />
          <Box className="inventory-detail-locations-heading">
            <Box><Typography component="h3">Vị trí lưu trữ</Typography><Typography variant="caption">{selectedItem.locations.length} vị trí lưu trữ</Typography></Box>
            <LocationOn fontSize="small" />
          </Box>
          {selectedItem.locations.length
            ? <Stack className="inventory-detail-locations" spacing={1}>
              {selectedItem.locations.map((location: any) => <Paper className="inventory-location-card" variant="outlined" key={location.bin.id}>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                  <Box className="inventory-location-card-title">
                    <Typography className="inventory-location-path">{cabinetRackLabel(location)}</Typography>
                    <Typography variant="caption">{location.bin.bin_code}</Typography>
                  </Box>
                  <Stack spacing={0.5} alignItems="flex-end"><LocationStatus status={location.status} /><LocationStatus status={isCabinetActive(cabinetById.get(Number(location.cabinet.id)) || location.cabinet) ? 'ACTIVE' : 'OFFLINE'} /></Stack>
                </Stack>
                <Box className="inventory-location-facts">
                  <Box><Typography variant="caption">Số lượng</Typography><Typography>{location.quantity} {selectedItem.unit || ''}</Typography></Box>
                  <Box><Typography variant="caption">Sức chứa ô</Typography><Typography>{Number(location.bin.capacity || 0) || 'Chưa cấu hình'}</Typography></Box>
                </Box>
              </Paper>)}
            </Stack>
            : <Alert severity="info">Sản phẩm chưa có tồn kho tại vị trí nào.</Alert>}
        </Box>
        <Box className="inventory-detail-actions">
          {!canOperate && <Typography variant="caption" color="text.secondary">Tài khoản không có quyền inventory.move.</Typography>}
          <Button variant="contained" startIcon={<Remove />} disabled={!canOperate || !availableQuantity(selectedItem, cabinetById)} onClick={() => openOperation(selectedItem, 'PICK')}>Xuất hàng · PICK</Button>
          <Button variant="outlined" startIcon={<Add />} disabled={!canOperate || !hasActivePutLocation} onClick={() => openOperation(selectedItem, 'PUT')}>Nhập hàng · PUT</Button>
        </Box>
      </Box>}
    </Drawer>

    <OperationDialog
      canOperate={canOperate}
      open={!!operationItem}
      item={operationItem}
      available={operationItem ? availableQuantity(operationItem, cabinetById) : 0}
      rackAlreadyOpen={activeOperation.data?.phase === 'OPEN_REUSED'}
      canKeepOpen={canKeepOpen}
      kind={operationKind}
      quantity={operationQuantity}
      setQuantity={(value: number) => { setOperationQuantity(value); setOperationPlan([]) }}
      locations={locations.filter(location => {
        const cabinet = cabinetById.get(Number(location.cabinet.id)) || location.cabinet
        return isCabinetActive(cabinet) && !unavailableStatuses.includes(location.status) && !(operationKind === 'PUT' && location.status === 'FULL') && (operationKind === 'PUT' || (stockByItemBin.get(`${operationItem?.id}:${location.bin.id}`) || 0) > 0)
      })}
      location={operationLocation}
      setLocation={(value: string) => { setOperationLocation(value); setOperationPlan([]) }}
      plan={operationPlan}
      planIndex={planIndex}
      phase={operationPhase}
      note={operationNote}
      setNote={setOperationNote}
      error={error}
      onClose={closeOperation}
      onPrepare={buildPlan}
      onStart={() => void submitPlanStep(0)}
      onConfirm={() => void confirmOperation(true)}
      onKeepOpen={() => void confirmOperation(true, true)}
      onFail={() => void confirmOperation(false)}
      locationName={locationName}
      cabinetRackLabel={cabinetRackLabel}
    />
  </Stack>
}

function SummaryMetric({ label, value, icon }: { label: string; value: number | string; icon: React.ReactNode }) {
  return <Paper variant="outlined" className="inventory-summary-item"><Box><Typography variant="caption">{label}</Typography><Typography className="inventory-summary-value">{value}</Typography></Box><Box className="inventory-summary-icon">{icon}</Box></Paper>
}

function ProductView({ items, onSelect }: { items: any[]; onSelect: (item: any) => void }) {
  return <TableContainer component={Paper} variant="outlined" className="inventory-table-wrap">
    <Table size="small" stickyHeader aria-label="Inventory products">
      <TableHead><TableRow>
        <TableCell>Sản phẩm</TableCell><TableCell align="right">Tổng số lượng</TableCell><TableCell align="right">Có thể xuất</TableCell>
        <TableCell>Tủ / rack</TableCell><TableCell>Trạng thái</TableCell><TableCell align="right">Chi tiết</TableCell>
      </TableRow></TableHead>
      <TableBody>
        {items.map(item => {
          const firstLocation = item.locations[0]
          return <TableRow hover key={item.id}>
            <TableCell data-label="Sản phẩm" className="inventory-product-cell">
              <Typography className="inventory-product-name">{item.item_name}</Typography>
              <Typography variant="caption">SKU {item.item_code}{item.barcode || item.item_barcode ? ` · Mã vạch ${item.barcode || item.item_barcode}` : ''}</Typography>
            </TableCell>
            <TableCell data-label="Tổng số lượng" align="right"><Typography className="inventory-quantity-value">{item.total} <small>{item.unit || ''}</small></Typography></TableCell>
            <TableCell data-label="Có thể xuất" align="right"><Typography className="inventory-quantity-value">{item.available} <small>{item.unit || ''}</small></Typography></TableCell>
            <TableCell data-label="Tủ / rack" className="inventory-product-location">
              {firstLocation
                ? <><Typography className="inventory-location-path">{cabinetRackLabel(firstLocation)}</Typography><Typography variant="caption">{item.locations.length} vị trí</Typography></>
                : <Typography variant="body2">Chưa có vị trí</Typography>}
            </TableCell>
            <TableCell data-label="Trạng thái"><LocationStatus status={item.stock.label.toUpperCase()} /></TableCell>
            <TableCell data-label="Chi tiết" align="right"><Button size="small" aria-label={`Xem ${item.item_name}`} onClick={() => onSelect(item)} startIcon={<InfoOutlined fontSize="small" />}>Chi tiết</Button></TableCell>
          </TableRow>
        })}
        {!items.length && <TableRow><TableCell colSpan={6}>
          <Box className="inventory-empty"><Inventory2 color="disabled" /><Typography fontWeight={600}>Không có sản phẩm phù hợp</Typography><Typography variant="body2">Thử tìm kiếm khác hoặc xóa bộ lọc.</Typography></Box>
        </TableCell></TableRow>}
      </TableBody>
    </Table>
  </TableContainer>
}

function LocationView({ locations, stockByItemBin, items, locationName, onSelect }: { locations: any[]; stockByItemBin: Map<string, number>; items: any[]; locationName: (location: any) => string; onSelect: (location: any) => void }) {
  const grouped = locations.reduce((result: Record<string, any[]>, location) => {
    const key = location.cabinet.id
    ;(result[key] ||= []).push(location)
    return result
  }, {})

  return <Stack className="inventory-location-list" spacing={1}>
    {Object.entries(grouped).map(([cabinetId, cabinetLocations]) => {
      const cabinet = cabinetLocations[0].cabinet
      const groupedRacks = cabinetLocations.reduce((result: Record<string, any[]>, location) => {
        const key = location.rack.id
        ;(result[key] ||= []).push(location)
        return result
      }, {})
      const cabinetQuantity = cabinetLocations.reduce((sum, location) => sum + items.reduce((rackSum, item) => rackSum + (stockByItemBin.get(`${item.id}:${location.bin.id}`) || 0), 0), 0)

      return <Paper variant="outlined" className="inventory-cabinet" key={cabinetId}>
        <Box className="inventory-cabinet-heading">
          <Box><Typography className="inventory-location-path">{cabinetLabel(cabinet)}</Typography><Typography variant="caption">{cabinetLocations.length} ô chứa</Typography></Box>
          <Stack direction="row" spacing={0.75} alignItems="center"><LocationStatus status={isCabinetActive(cabinet) ? 'ACTIVE' : 'OFFLINE'} /><Chip size="small" label={`${cabinetQuantity} units`} variant="outlined" /></Stack>
        </Box>
        <TableContainer>
          <Table size="small" aria-label={`${cabinetLabel(cabinet)} locations`}>
            <TableHead><TableRow><TableCell>Tủ / rack</TableCell><TableCell>Trạng thái</TableCell><TableCell>Hàng lưu trữ</TableCell><TableCell align="right">Sức chứa</TableCell><TableCell align="right">Chi tiết</TableCell></TableRow></TableHead>
            <TableBody>
              {Object.entries(groupedRacks).map(([rackId, rackLocations]) => rackLocations.map(location => {
                const stockedItems = items.map(item => ({ item, quantity: stockByItemBin.get(`${item.id}:${location.bin.id}`) || 0 })).filter(row => row.quantity > 0)
                const quantity = stockedItems.reduce((sum, row) => sum + row.quantity, 0)
                const capacity = Number(location.bin.capacity || 0)
                const usage = capacity ? Math.min(100, quantity / capacity * 100) : 0
                return <TableRow hover key={`${rackId}-${location.bin.id}`}>
                  <TableCell data-label="Tủ / rack" className="inventory-location-table-cell"><Typography className="inventory-location-path">{cabinetRackLabel(location)}</Typography><Typography variant="caption">{location.bin.bin_code}</Typography></TableCell>
                  <TableCell data-label="Trạng thái"><LocationStatus status={location.status} /></TableCell>
                  <TableCell data-label="Hàng lưu trữ" className="inventory-location-contents">
                    {stockedItems.length ? <Stack spacing={0.25}>{stockedItems.slice(0, 2).map(({ item, quantity: itemQuantity }) => <Typography variant="body2" key={item.id}>{item.item_name} <b>× {itemQuantity}</b></Typography>)}{stockedItems.length > 2 && <Typography variant="caption">+{stockedItems.length - 2} more</Typography>}</Stack> : <Typography variant="body2">Trống</Typography>}
                  </TableCell>
                  <TableCell data-label="Sức chứa" align="right"><Typography variant="body2" fontWeight={600}>{quantity} / {capacity || '—'}</Typography><LinearProgress variant="determinate" value={usage} color={usage >= 100 ? 'warning' : 'primary'} sx={{ mt: 0.5, height: 4, borderRadius: 2 }} /></TableCell>
                  <TableCell data-label="Chi tiết" align="right"><Tooltip title={stockedItems.length ? 'Xem sản phẩm tại vị trí' : 'Vị trí chưa có hàng'}><span><IconButton size="small" aria-label={`View ${locationName(location)}`} disabled={!stockedItems.length} onClick={() => onSelect(location)}><InfoOutlined fontSize="small" /></IconButton></span></Tooltip></TableCell>
                </TableRow>
              }))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    })}
    {!locations.length && <Box className="inventory-empty"><Inventory2 color="disabled" /><Typography fontWeight={600}>Không có vị trí phù hợp</Typography><Typography variant="body2">Thử đổi tủ, rack hoặc từ khóa.</Typography></Box>}
  </Stack>
}

function OperationDialog({ canOperate, open, item, available, kind, quantity, setQuantity, locations, location, setLocation, plan, planIndex, phase, note, setNote, error, onClose, onPrepare, onStart, onConfirm, onFail, locationName, cabinetRackLabel }: any) {
  const step = plan[planIndex]
  const selectedLocation = locations.find((candidate: any) => location !== 'auto' && String(candidate.bin.id) === String(location))
  const selectedCurrent = selectedLocation?.quantityFor ? selectedLocation.quantityFor(item?.id) : 0
  const selectedCapacity = Number(selectedLocation?.bin?.capacity || 0)
  const target = step?.location || selectedLocation

  return <Dialog className="inventory-operation-dialog" open={open} onClose={onClose} fullWidth maxWidth="sm">
    <DialogTitle className="inventory-dialog-title">
      <Box><Typography variant="overline">{kind === 'PICK' ? 'Xuất hàng · PICK' : 'Nhập hàng · PUT'}</Typography><Typography component="h2">{item?.item_name}</Typography></Box>
      <IconButton aria-label="Đóng thao tác" onClick={onClose} disabled={['sending', 'awaiting'].includes(phase)}><Close /></IconButton>
    </DialogTitle>
    <DialogContent dividers>
      {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}
      {phase === 'preview' && <Stack className="inventory-operation-form" spacing={1.25}>
        <Box className="inventory-operation-product"><Typography variant="caption">Sản phẩm / SKU</Typography><Typography fontWeight={600}>{item?.item_name} · {item?.item_code}</Typography></Box>
        <Box className="inventory-operation-available"><Typography variant="caption">Có thể xuất</Typography><Typography className="inventory-operation-available-value">{available} <small>{item?.unit || ''}</small></Typography></Box>
        <Box>
          <Typography className="inventory-field-label">Số lượng</Typography>
          <Box className="inventory-quantity-stepper">
            <IconButton aria-label="Giảm số lượng" onClick={() => setQuantity(Math.max(1, quantity - 1))} disabled={quantity <= 1}><Remove /></IconButton>
            <TextField size="small" type="number" value={quantity} onChange={event => setQuantity(Number(event.target.value))} inputProps={{ min: 1, step: 1, 'aria-label': 'Số lượng thao tác' }} />
            <IconButton aria-label="Tổng số lượng" onClick={() => setQuantity(quantity + 1)}><Add /></IconButton>
          </Box>
        </Box>
        <FormControl size="small" fullWidth>
          <InputLabel>Vị trí thao tác</InputLabel>
          <Select value={location} label="Vị trí thao tác" disabled={!canOperate} onChange={event => setLocation(event.target.value)}>
            <MenuItem value="auto">Tự động đề xuất</MenuItem>
            {locations.map((candidate: any) => <MenuItem key={candidate.bin.id} value={String(candidate.bin.id)}>{locationName(candidate)} · {statusLabel(candidate.status)}</MenuItem>)}
          </Select>
        </FormControl>
        {selectedLocation && <Typography className="inventory-selected-capacity">Hiện có {selectedCurrent} · Sức chứa ô {selectedCapacity || 'Chưa cấu hình'} · Sau {kind}: {selectedCurrent + (kind === 'PUT' ? quantity : -quantity)}</Typography>}
        {target && <Box className="inventory-operation-target"><Typography variant="caption">{plan.length ? 'Vị trí đề xuất' : 'Vị trí đã chọn'}</Typography><Typography className="inventory-location-path">{cabinetRackLabel(target)}</Typography></Box>}
        {plan.length > 0 && <Box className="inventory-operation-plan">
          <Typography className="inventory-field-label">Kế hoạch thao tác</Typography>
          {plan.map((entry: any, index: number) => <Box className="inventory-operation-plan-row" key={entry.location.bin.id}>
            <Box><Typography className="inventory-location-path">{cabinetRackLabel(entry.location)}</Typography><Typography variant="caption">{entry.location.bin.bin_code}</Typography></Box>
            <Typography fontWeight={700}>{entry.quantity} · còn lại {entry.after}</Typography>
          </Box>)}
        </Box>}
        {!plan.length && <Button variant="outlined" onClick={onPrepare} disabled={quantity < 1}>Xem vị trí đề xuất</Button>}
      </Stack>}
      {phase === 'sending' && <Stack spacing={1.25} alignItems="center" sx={{ py: 2 }}><CircularProgress size={28} /><Typography>Đang gửi tới cabinet workflow…</Typography>{step && <Typography color="text.secondary">{locationName(step.location)} · {step.quantity}</Typography>}</Stack>}
      {phase === 'awaiting' && <Stack spacing={1.25}>
        <Alert severity="info">Cabinet đã mở. Hoàn tất thao tác thực tế rồi xác nhận để workflow đóng rack và cập nhật tồn kho cục bộ.</Alert>
        <Box className="inventory-operation-target inventory-operation-confirm-target"><Typography variant="caption">Confirm target</Typography><Typography className="inventory-location-path">{step && cabinetRackLabel(step.location)}</Typography><Typography>Quantity: <b>{step?.quantity}</b></Typography></Box>
        <TextField label="Ghi chú xác nhận" value={note} onChange={event => setNote(event.target.value)} required multiline minRows={2} />
      </Stack>}
      {phase === 'done' && <Alert severity="success">Operation completed. Inventory đã cập nhật sau khi cabinet đóng thành công.</Alert>}
      {phase === 'failed' && <Alert severity="warning">Operation failed/cancelled. Inventory không thay đổi.</Alert>}
    </DialogContent>
    <DialogActions>
      {phase === 'preview' && <><Button onClick={onClose}>Hủy</Button><Button onClick={onPrepare} disabled={quantity < 1}>Xem kế hoạch</Button><Button variant="contained" onClick={onStart} disabled={!plan.length}>Bắt đầu {kind}</Button></>}
      {phase === 'awaiting' && <><Button color="error" onClick={onFail} disabled={!note.trim()}>Thất bại / Hủy</Button><Button variant="contained" onClick={onConfirm} disabled={!note.trim()}>Xác nhận · đóng rack</Button></>}
      {['done', 'failed'].includes(phase) && <Button onClick={onClose}>Đóng</Button>}
    </DialogActions>
  </Dialog>
}
