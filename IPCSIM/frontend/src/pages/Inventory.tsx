import { t as uiText, errorText, useLanguage } from '../i18n';
import { useState, useEffect } from 'react'
import {
  Box,
  Card,
  CardContent,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Paper,
  Button,
  Stack,
  Grid,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  CircularProgress,
  Chip,
  Divider,
  Skeleton,
  InputAdornment
} from '@mui/material'
import { Search, MoreVert, Info, CheckCircle, Inventory2, WarningAmber, LocationOn, Add, Remove } from '@mui/icons-material'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useInventory, usePickMutation, usePutMutation } from '@hooks/useInventory'
import { IconButton, Menu, MenuItem } from '@mui/material'
import { cabinetAPI } from '@api/cabinet'
import { systemAPI } from '@api/system'

export const Inventory = () => {
  useLanguage();
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [selectedItem, setSelectedItem] = useState<any | null>(null)
  const [pickOpen, setPickOpen] = useState(false)
  const [putOpen, setPutOpen] = useState(false)
  const [qty, setQty] = useState<number>(0)
  const [menuAnchorEl, setMenuAnchorEl] = useState<null | HTMLElement>(null)
  const [menuItem, setMenuItem] = useState<any | null>(null)
  const menuOpen = Boolean(menuAnchorEl)
  
  // Rack operation popup state
  const [rackNotificationOpen, setRackNotificationOpen] = useState(false)
  const [rackOperationData, setRackOperationData] = useState<{
    rackId: number
    rackCode: string
    cabinetId: number
    operationType: 'pick' | 'put'
    isRackOpened: boolean
    startedAt: number
    sessionId: number
    isClosing: boolean
    isCloseComplete: boolean
  } | null>(null)
  const [completingOperation, setCompletingOperation] = useState(false)
  const [rackError, setRackError] = useState<any>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const queryClient = useQueryClient()
  const inventoryQuery: any = useInventory()
  const pickMutation = usePickMutation()
  const putMutation = usePutMutation()

  // Polling query for operation data to detect rack opening
  const operationQuery = useQuery({
    queryKey: ['operationData', 'polling', rackOperationData?.rackId, rackOperationData?.sessionId],
    queryFn: async () => {
      const resp = await systemAPI.getOperationData(20)
      return resp.data.data as any[]
    },
    enabled: !!(rackNotificationOpen && rackOperationData && !rackOperationData.isRackOpened),
    refetchInterval: 500,
    staleTime: 100
  })

  // Monitor rack operation completion for both opening and closing flows.
  useEffect(() => {
    if (!rackNotificationOpen || !rackOperationData) return

    if (!operationQuery.data) return

    const finalEntry = [...(operationQuery.data || [])]
      .filter((entry: any) => Number(entry.rack_id) === Number(rackOperationData.rackId))
      .filter((entry: any) => {
        if (!entry.created_at) return true
        const createdAt = new Date(entry.created_at).getTime()
        return Number.isNaN(createdAt) || createdAt >= rackOperationData.startedAt
      })
      .sort((a: any, b: any) => Number(b.id ?? 0) - Number(a.id ?? 0))[0]

    const isFinalOperationComplete = !!finalEntry && Number(finalEntry.is_endpoint ?? 0) === 1 && (
      Number(finalEntry.state ?? -1) === -1 ||
      Number(finalEntry.movement_speed ?? 0) === 0 ||
      Number(finalEntry.displacement ?? 0) === 0 ||
      Number(finalEntry.displacement ?? 0) >= 64
    )

    if (!isFinalOperationComplete) return

    if (rackOperationData.isClosing) {
      setRackOperationData(prev => prev ? { ...prev, isCloseComplete: true, isClosing: false } : null)
      return
    }

    if (!rackOperationData.isRackOpened) {
      setRackOperationData(prev => prev ? { ...prev, isRackOpened: true, isClosing: false } : null)
    }
  }, [operationQuery.data, rackNotificationOpen, rackOperationData])

  const getRackInfoFromItem = (item: any) => {
    if (!item.locations || item.locations.length === 0) return null
    const location = item.locations[0]
    return {
      rackId: location.rack_id,
      rackCode: location.rack_code,
      cabinetId: location.cabinet_id
    }
  }

  const checkRackBreakdown = async (rackId: number) => {
    try {
      const resp = await systemAPI.getBreakdownStatus(rackId)
      const data = resp.data
      const active = data?.active ?? false
      if (active) {
        const reasons = []
        if (data?.is_obstructed) reasons.push('Obstructed')
        if (data?.is_skewed) reasons.push('Skewed')
        if (data?.is_overload_motor) reasons.push('Overload')
        setRackError(`Rack ${rackId} has an active breakdown (${reasons.join(', ')}). Please clear the issue before continuing.`)
      }
      return active
    } catch (err) {
      console.error('Failed to fetch breakdown status', err)
      return false
    }
  }

  const isRackAlreadyOpen = async (rackId: number, cabinetId?: number) => {
    if (!cabinetId) return false

    try {
      const resp = await cabinetAPI.getRacks(cabinetId)
      const rack = resp.data?.find((item: any) => Number(item.id) === Number(rackId))
      const status = String(rack?.status ?? '').toLowerCase()
      return status.includes('open') || status.includes('opened')
    } catch (err) {
      console.error('Failed to read rack status', err)
      return false
    }
  }

  const startRackOperation = (
    rackInfo: { rackId: number; rackCode: string; cabinetId: number },
    operationType: 'pick' | 'put',
    isRackOpened = false
  ) => {
    const newSessionId = Date.now() + Math.random()
    setRackError(null)
    setCompletingOperation(false)
    queryClient.removeQueries({ queryKey: ['operationData'] })
    setRackOperationData({
      rackId: rackInfo.rackId,
      rackCode: rackInfo.rackCode,
      cabinetId: rackInfo.cabinetId,
      operationType,
      isRackOpened,
      startedAt: Date.now(),
      sessionId: newSessionId,
      isClosing: false,
      isCloseComplete: false
    })
    setRackNotificationOpen(true)
  }

  const handlePickConfirm = async () => {
    if (!selectedItemId || qty <= 0) return
    try {
      const rackInfo = getRackInfoFromItem(selectedItem)
      const rackAlreadyOpen = rackInfo ? await isRackAlreadyOpen(rackInfo.rackId, rackInfo.cabinetId) : false
      if (rackInfo && rackInfo.rackId && !rackAlreadyOpen) {
        startRackOperation(rackInfo, 'pick')
      }
      setPickOpen(false)
      setQty(0)
      await pickMutation.mutateAsync({ item_id: selectedItemId, quantity: qty })
      queryClient.invalidateQueries({ queryKey: ['inventory'] })

      if (rackInfo && rackInfo.rackId) {
        const hasBreakdown = await checkRackBreakdown(rackInfo.rackId)
        if (hasBreakdown) {
          setRackNotificationOpen(false)
          setRackOperationData(null)
          return
        }

        if (rackAlreadyOpen) {
          startRackOperation(rackInfo, 'pick', true)
          return
        }

        try {
          await cabinetAPI.openRack(rackInfo.rackId)
        } catch (err: any) {
          const message = err?.response?.data?.detail || 'Failed to open rack.'
          setRackError(err || message)
          console.error('Failed to open rack:', err)
        }
      }

    } catch (err) {
      console.error(err)
      setRackNotificationOpen(false)
      setRackOperationData(null)
    }
  }

  const handlePutConfirm = async () => {
    if (!selectedItemId || qty <= 0) return
    try {
      const rackInfo = getRackInfoFromItem(selectedItem)
      const rackAlreadyOpen = rackInfo ? await isRackAlreadyOpen(rackInfo.rackId, rackInfo.cabinetId) : false
      if (rackInfo && rackInfo.rackId && !rackAlreadyOpen) {
        startRackOperation(rackInfo, 'put')
      }
      setPutOpen(false)
      setQty(0)
      await putMutation.mutateAsync({ item_id: selectedItemId, quantity: qty })
      queryClient.invalidateQueries({ queryKey: ['inventory'] })

      if (rackInfo && rackInfo.rackId) {
        const hasBreakdown = await checkRackBreakdown(rackInfo.rackId)
        if (hasBreakdown) {
          setRackNotificationOpen(false)
          setRackOperationData(null)
          return
        }

        if (rackAlreadyOpen) {
          startRackOperation(rackInfo, 'put', true)
          return
        }

        try {
          await cabinetAPI.openRack(rackInfo.rackId)
        } catch (err: any) {
          const message = err?.response?.data?.detail || 'Failed to open rack.'
          setRackError(err || message)
          console.error('Failed to open rack:', err)
        }
      }

    } catch (err) {
      console.error(err)
      setRackNotificationOpen(false)
      setRackOperationData(null)
    }
  }

  const handleCompleteOperation = async () => {
    if (!rackOperationData) return

    setCompletingOperation(true)
    try {
      const hasBreakdown = await checkRackBreakdown(rackOperationData.rackId)
      if (hasBreakdown) {
        setCompletingOperation(false)
        return
      }

      const newSessionId = Date.now() + Math.random()
      queryClient.removeQueries({ queryKey: ['operationData'] })
      setRackOperationData(prev => prev ? {
        ...prev,
        startedAt: Date.now(),
        sessionId: newSessionId,
        isClosing: true,
        isCloseComplete: false,
        isRackOpened: false
      } : null)
      await cabinetAPI.closeRack(rackOperationData.rackId)
    } catch (err: any) {
      const message = err?.response?.data?.detail || 'Failed to close rack.'
      setRackError(err || message)
      console.error('Failed to close rack:', err)
      setCompletingOperation(false)
    }
  }

  const handleKeepRackOpen = () => {
    queryClient.removeQueries({ queryKey: ['operationData'] })
    setRackNotificationOpen(false)
    setRackOperationData(null)
    setCompletingOperation(false)
    setRackError(null)
  }

  const isAwaitingRackAction = !!rackOperationData && !rackOperationData.isRackOpened && !rackOperationData.isCloseComplete && !rackOperationData.isClosing
  const isClosingRack = !!rackOperationData && rackOperationData.isClosing && !rackOperationData.isCloseComplete
  const isCloseSuccess = !!rackOperationData && rackOperationData.isCloseComplete

  const inventoryItems: any[] = inventoryQuery?.data ?? []
  const filtered: any[] = debounced
    ? inventoryItems.filter((item) => {
        const searchLower = debounced.toLowerCase()
        return (
          item.item_code?.toLowerCase().includes(searchLower) ||
          item.item_name?.toLowerCase().includes(searchLower) ||
          item.locations?.some((loc: any) => loc.location_path?.toLowerCase().includes(searchLower))
        )
      })
    : inventoryItems

  const selectedItemId = selectedItem?.item_id ?? selectedItem?.id
  const hasValidQuantity = qty > 0
  const totalStock = inventoryItems.reduce((total, item) => total + Number(item.total_quantity ?? item.qty ?? 0), 0)
  const lowStockItems = inventoryItems.filter((item) => {
    const quantity = Number(item.total_quantity ?? item.qty ?? 0)
    const minimum = Number(item.min_qty ?? item.minimum_quantity ?? 0)
    return minimum > 0 && quantity < minimum
  }).length
  const locationCount = new Set(inventoryItems.flatMap((item) => (item.locations ?? []).map((location: any) => location.location_path || location.bin_code).filter(Boolean))).size

  return (
    <Box>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'center' }} spacing={1} sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold', letterSpacing: '-0.02em' }}> {uiText("Inventory Management")} </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}> {uiText("Search stock, inspect locations and start rack operations.")} </Typography>
        </Box>
        <Chip icon={<Inventory2 />} label={uiText("{0} item types", inventoryItems.length)} color="primary" variant="outlined" />
      </Stack>

      {rackError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {errorText(rackError)}
        </Alert>
      )}

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} sm={4}>
          <Card sx={{ borderTop: '3px solid', borderColor: 'primary.main' }}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Box>
                  <Typography variant="body2" color="text.secondary">{uiText("Total stock")}</Typography>
                  <Typography variant="h4" sx={{ fontWeight: 'bold', mt: 0.5 }}>{totalStock}</Typography>
                  <Typography variant="caption" color="text.secondary">{uiText("Units across inventory")}</Typography>
                </Box>
                <Inventory2 color="primary" sx={{ fontSize: 36 }} />
              </Stack>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card sx={{ borderTop: '3px solid', borderColor: lowStockItems ? 'warning.main' : 'success.main' }}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Box>
                  <Typography variant="body2" color="text.secondary">{uiText("Low stock")}</Typography>
                  <Typography variant="h4" sx={{ fontWeight: 'bold', mt: 0.5 }}>{lowStockItems}</Typography>
                  <Typography variant="caption" color="text.secondary">{uiText("Items below minimum")}</Typography>
                </Box>
                <WarningAmber color={lowStockItems ? 'warning' : 'success'} sx={{ fontSize: 36 }} />
              </Stack>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card sx={{ borderTop: '3px solid', borderColor: 'info.main' }}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Box>
                  <Typography variant="body2" color="text.secondary">{uiText("Storage locations")}</Typography>
                  <Typography variant="h4" sx={{ fontWeight: 'bold', mt: 0.5 }}>{locationCount}</Typography>
                  <Typography variant="caption" color="text.secondary">{uiText("Locations currently assigned")}</Typography>
                </Box>
                <LocationOn color="info" sx={{ fontSize: 36 }} />
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        {/* Search & List */}
        <Grid item xs={12} md={8}>
          <Card>
            <CardContent sx={{ p: { xs: 2, md: 2.5 } }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1.5} sx={{ mb: 2 }}>
                <Box>
                  <Typography variant="h6" sx={{ fontWeight: 'bold' }}>{uiText("Stock overview")}</Typography>
                  <Typography variant="body2" color="text.secondary">{uiText("Select an item to see its rack locations.")}</Typography>
                </Box>
                <Chip label={uiText("{0} results", filtered.length)} size="small" variant="outlined" />
              </Stack>
              <TextField
                fullWidth
                placeholder={uiText("Search code, item name or location...")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                InputProps={{ startAdornment: <InputAdornment position="start"><Search color="action" /></InputAdornment> }}
                sx={{ mb: 2 }}
              />
              <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 560 }}>
                <Table stickyHeader size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{uiText("Item Code")}</TableCell>
                      <TableCell>{uiText("Item Name")}</TableCell>
                      <TableCell align="right">{uiText("Quantity")}</TableCell>
                      <TableCell>{uiText("Unit")}</TableCell>
                      <TableCell>{uiText("Location")}</TableCell>
                      <TableCell align="center">{uiText("Action")}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {inventoryQuery.isLoading ? (
                      Array.from({ length: 5 }).map((_, index) => <TableRow key={index}><TableCell colSpan={6}><Skeleton /></TableCell></TableRow>)
                    ) : filtered.length === 0 ? (
                      <TableRow><TableCell colSpan={6} align="center"><Typography color="text.secondary" sx={{ py: 5 }}>{uiText("No inventory items match your search.")}</Typography></TableCell></TableRow>
                    ) : filtered.map((item: any) => {
                      const quantity = Number(item.total_quantity ?? item.qty ?? 0)
                      const minimum = Number(item.min_qty ?? item.minimum_quantity ?? 0)
                      const isLowStock = minimum > 0 && quantity < minimum
                      return (
                      <TableRow
                        key={item.item_id ?? item.id}
                        hover
                        onClick={() => setSelectedItem(item)}
                        sx={{ cursor: 'pointer' }}
                      >
                        <TableCell sx={{ fontWeight: 'bold', color: 'primary.main' }}>{(item.item_code ?? item.code)}</TableCell>
                        <TableCell>{(item.item_name ?? item.name)}</TableCell>
                        <TableCell align="right"><Chip label={quantity} size="small" color={isLowStock ? 'warning' : 'default'} /></TableCell>
                        <TableCell>{(item.unit ?? '--')}</TableCell>
                        <TableCell>
                          <Stack direction="row" alignItems="center" spacing={0.5}>
                            <LocationOn sx={{ fontSize: 16 }} color="action" />
                            <span>{(((item.locations && item.locations[0] && item.locations[0].location_path) || item.location) || '--')}</span>
                          </Stack>
                          {item.locations && item.locations.length > 1 && (
                            <Typography variant="caption" display="block" color="textSecondary">
                              +{item.locations.length - 1} {uiText("more")} </Typography>
                          )}
                        </TableCell>
                        <TableCell align="center">
                          <IconButton
                            size="small"
                            onClick={(event) => {
                              event.stopPropagation()
                              setMenuAnchorEl(event.currentTarget)
                              setMenuItem(item)
                            }}
                          >
                            <MoreVert />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
              <Menu
                anchorEl={menuAnchorEl}
                open={menuOpen}
                onClose={() => setMenuAnchorEl(null)}
              >
                <MenuItem
                  onClick={() => {
                    if (menuItem) setSelectedItem(menuItem)
                    setMenuAnchorEl(null)
                  }}
                > {uiText("View details")} </MenuItem>
                <MenuItem
                  onClick={() => {
                    if (menuItem) {
                      setSelectedItem(menuItem)
                      setPickOpen(true)
                    }
                    setMenuAnchorEl(null)
                  }}
                > {uiText("Pick")} </MenuItem>
                <MenuItem
                  onClick={() => {
                    if (menuItem) {
                      setSelectedItem(menuItem)
                      setPutOpen(true)
                    }
                    setMenuAnchorEl(null)
                  }}
                > {uiText("Put")} </MenuItem>
              </Menu>
            </CardContent>
          </Card>
        </Grid>

        {/* Detail Panel */}
        {selectedItem && (
          <Grid item xs={12} md={4}>
            <Card sx={{ height: '100%', borderTop: '4px solid', borderColor: 'primary.main' }}>
              <CardContent sx={{ p: { xs: 2, md: 2.5 } }}>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                  <Box>
                    <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                      {(selectedItem.item_name ?? selectedItem.name)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      {(selectedItem.item_code ?? selectedItem.code)}
                    </Typography>
                  </Box>
                  <Chip icon={<Info />} label="Selected" size="small" color="primary" variant="outlined" />
                </Stack>
                <Divider sx={{ my: 2 }} />
                <Stack spacing={2}>
                  <Box sx={{ p: 1.5, bgcolor: 'grey.50', borderRadius: 2 }}>
                    <Typography variant="caption" color="textSecondary"> {uiText("Item Code")} </Typography>
                    <Typography sx={{ fontWeight: 'bold' }}>{(selectedItem.item_code ?? selectedItem.code)}</Typography>
                  </Box>
                  <Box sx={{ p: 1.5, bgcolor: 'grey.50', borderRadius: 2 }}>
                    <Typography variant="caption" color="textSecondary"> {uiText("Current Stock")} </Typography>
                    <Stack direction="row" alignItems="baseline" spacing={1}>
                      <Typography variant="h5" sx={{ fontWeight: 'bold' }}>{(selectedItem.total_quantity ?? selectedItem.qty)}</Typography>
                      <Typography color="text.secondary">{selectedItem.unit}</Typography>
                    </Stack>
                  </Box>
                  <Box>
                    <Typography variant="subtitle2" sx={{ mb: 1 }}> {uiText("Storage locations")} </Typography>
                    {selectedItem.locations && selectedItem.locations.length > 0 ? (
                      <Stack spacing={1}>
                        {selectedItem.locations.map((loc: any) => (
                          <Stack key={loc.id} direction="row" justifyContent="space-between" alignItems="center" sx={{ p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1.5 }}>
                            <Stack direction="row" spacing={0.75} alignItems="center">
                              <LocationOn sx={{ fontSize: 17 }} color="action" />
                              <Typography variant="body2">{(loc.location_path || 'Unknown')}</Typography>
                            </Stack>
                            <Chip label={`${loc.quantity} ${(selectedItem.unit || '')}`} size="small" />
                          </Stack>
                        ))}
                      </Stack>
                    ) : (
                      <Typography variant="body2" color="text.secondary">{uiText("No storage location assigned.")}</Typography>
                    )}
                  </Box>
                  <Stack direction="row" spacing={1}>
                    <Button variant="contained" color="warning" startIcon={<Remove />} size="small" fullWidth onClick={() => setPickOpen(true)} sx={{ minHeight: 42 }}> {uiText("Pick")} </Button>
                    <Button variant="outlined" color="success" startIcon={<Add />} size="small" fullWidth onClick={() => setPutOpen(true)} sx={{ minHeight: 42 }}> {uiText("Put")} </Button>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* Pick Dialog */}
        <Dialog open={pickOpen} onClose={() => setPickOpen(false)}>
          <DialogTitle>{uiText("Pick Item")}</DialogTitle>
          <DialogContent>
            <Typography>{uiText("Item:")} {(selectedItem?.item_name ?? selectedItem?.name)}</Typography>
            <TextField label={uiText("Quantity")} type="number" value={qty} onChange={(e) => setQty(Number(e.target.value))} fullWidth sx={{ mt: 2 }} />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => {
              setPickOpen(false)
              setQty(0)
            }}>{uiText("Cancel")}</Button>
            <Button
              onClick={handlePickConfirm}
              variant="contained"
              color="success"
              disabled={!hasValidQuantity}
            > {uiText("Confirm Pick")} </Button>
          </DialogActions>
        </Dialog>

        {/* Put Dialog */}
        <Dialog open={putOpen} onClose={() => {
          setPutOpen(false)
          setQty(0)
        }}>
          <DialogTitle>{uiText("Put Item")}</DialogTitle>
          <DialogContent>
            <Typography>{uiText("Item:")} {(selectedItem?.item_name ?? selectedItem?.name)}</Typography>
            <TextField label={uiText("Quantity")} type="number" value={qty} onChange={(e) => setQty(Number(e.target.value))} fullWidth sx={{ mt: 2 }} />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => {
              setPutOpen(false)
              setQty(0)
            }}>{uiText("Cancel")}</Button>
            <Button
              onClick={handlePutConfirm}
              variant="contained"
              color="primary"
              disabled={!hasValidQuantity}
            > {uiText("Confirm Put")} </Button>
          </DialogActions>
        </Dialog>

        {/* Rack Notification Dialog */}
        <Dialog open={rackNotificationOpen} onClose={() => {}} maxWidth="sm" fullWidth>
          <DialogTitle sx={{ fontWeight: 'bold', pb: 1 }}>
            {rackOperationData?.operationType === 'pick' ? uiText('Pick Item') : uiText('Put Item')}
          </DialogTitle>

          <DialogContent sx={{ pt: 2 }}>
            {isCloseSuccess ? (
              <Box sx={{ textAlign: 'center', py: 3 }}>
                <CheckCircle sx={{ fontSize: 80, color: 'green', mb: 2 }} />
                <Typography variant="h5" sx={{ fontWeight: 'bold', mb: 1 }}> {uiText("Rack Closed Successfully!")} </Typography>
                <Typography variant="body2" color="textSecondary"> {uiText("Simulation completion confirmed. The rack is fully closed.")} </Typography>
              </Box>
            ) : isClosingRack ? (
              <Stack spacing={3}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 2 }}>
                  <CircularProgress size={40} sx={{ mr: 2 }} />
                  <Stack spacing={0.5}>
                    <Typography variant="body2" sx={{ fontWeight: 'bold' }}> {uiText("Waiting for rack to close...")} </Typography>
                    <Typography variant="caption" color="textSecondary"> {uiText("Please wait while the rack is closing.")} </Typography>
                  </Stack>
                </Box>

                <Card variant="outlined">
                  <CardContent>
                    <Typography variant="subtitle2" color="textSecondary" sx={{ mb: 1 }}>
                      Rack
                    </Typography>
                    <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                      {rackOperationData?.rackCode}
                    </Typography>
                  </CardContent>
                </Card>
              </Stack>
            ) : !rackOperationData?.isRackOpened ? (
              <Stack spacing={3}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 2 }}>
                  <CircularProgress size={40} sx={{ mr: 2 }} />
                  <Stack spacing={0.5}>
                    <Typography variant="body2" sx={{ fontWeight: 'bold' }}> {uiText("Waiting for rack to open...")} </Typography>
                    <Typography variant="caption" color="textSecondary"> {uiText("Please wait while the rack is opening.")} </Typography>
                  </Stack>
                </Box>

                <Card variant="outlined">
                  <CardContent>
                    <Typography variant="subtitle2" color="textSecondary" sx={{ mb: 1 }}>
                      Rack
                    </Typography>
                    <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                      {rackOperationData?.rackCode}
                    </Typography>
                  </CardContent>
                </Card>

                <Alert severity="info" sx={{ fontSize: '0.85rem' }}> {uiText("Please wait until the rack is fully open.")} </Alert>
              </Stack>
            ) : (
              <Box sx={{ textAlign: 'center', py: 3 }}>
                <CheckCircle sx={{ fontSize: 80, color: 'green', mb: 2 }} />
                <Typography variant="h5" sx={{ fontWeight: 'bold', mb: 1 }}> {uiText("Rack Opened Successfully!")} </Typography>
                <Typography variant="body2" color="textSecondary"> {uiText("The rack is open. Please choose whether to close it or keep it open.")} </Typography>
              </Box>
            )}
          </DialogContent>

          <DialogActions sx={{ pt: 0, pb: 2, px: 3 }}>
            {isCloseSuccess ? (
              <Button
                onClick={() => {
                  setRackNotificationOpen(false)
                  setRackOperationData(null)
                  setCompletingOperation(false)
                  setRackError(null)
                }}
                variant="contained"
                color="success"
                fullWidth
              > {uiText("Done")} </Button>
            ) : rackOperationData?.isRackOpened ? (
              <Stack direction="row" spacing={1.5} sx={{ width: '100%' }}>
                <Button
                  onClick={handleCompleteOperation}
                  variant="contained"
                  color="success"
                  disabled={completingOperation}
                  fullWidth
                >
                  {completingOperation ? uiText('Closing Rack...') : uiText('Close Rack')}
                </Button>
                <Button
                  onClick={handleKeepRackOpen}
                  variant="outlined"
                  color="inherit"
                  fullWidth
                > {uiText("Keep Rack Open")} </Button>
              </Stack>
            ) : isAwaitingRackAction || isClosingRack ? (
              <Button disabled fullWidth>
                {isClosingRack ? uiText('Waiting for rack to close...') : uiText('Waiting for rack to open...')}
              </Button>
            ) : (
              <Button disabled fullWidth> {uiText("Waiting for rack to open...")} </Button>
            )}
          </DialogActions>
        </Dialog>
      </Grid>
    </Box>
  )
}
