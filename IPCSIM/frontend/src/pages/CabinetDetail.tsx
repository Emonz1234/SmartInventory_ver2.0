import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { cabinetAPI } from '@api/cabinet'
import { Alert, Avatar, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Grid, LinearProgress, Stack, Typography } from '@mui/material'
import { Air, ArrowBack, CheckCircle, ErrorOutline, Lightbulb, Lock, LockOpen, Storage } from '@mui/icons-material'
import api from '@api/client'
import { systemAPI } from '@api/system'

type CabinetOperation = {
  kind: 'OPEN' | 'CLOSE' | 'VENTILATE' | 'LIGHT'
  racks: any[]
  requestKey: string
}

interface CabinetDetailProps {
  session: string
  permissions: string[]
  onSessionExpired: () => void
}

export const CabinetDetail = ({ session, permissions, onSessionExpired }: CabinetDetailProps) => {
  const { id } = useParams(), navigate = useNavigate()
  const queryClient = useQueryClient()
  const [operation, setOperation] = useState<CabinetOperation | null>(null)
  const [operationBusy, setOperationBusy] = useState(false)
  const [operationPhase, setOperationPhase] = useState<'confirm' | 'sending' | 'waiting' | 'success' | 'sent' | 'uncertain'>('confirm')
  const [baselineOperationId, setBaselineOperationId] = useState(0)
  const [operationError, setOperationError] = useState('')
  const [sentRackIds, setSentRackIds] = useState<number[]>([])
  const [completedRackIds, setCompletedRackIds] = useState<number[]>([])
  const [failedRacks, setFailedRacks] = useState<Array<{ rack: any; message: string }>>([])
  const canOperate = permissions.includes('inventory.add_operation')
  const query = useQuery({ queryKey: ['cabinet', id, 'racks'], queryFn: async () => (await cabinetAPI.getRacks(Number(id))).data, refetchInterval: 2000 })
  const racks: any[] = query.data || []
  const operationTelemetry = useQuery({
    queryKey: ['cabinet-operation-telemetry', operation?.requestKey],
    queryFn: async () => (await systemAPI.getOperationData(100)).data.data,
    enabled: !!operation && operationPhase === 'waiting',
    refetchInterval: 500,
    staleTime: 0
  })

  useEffect(() => {
    if (!operation || operationPhase !== 'waiting' || !operationTelemetry.data) return
    const trackedRacks = operation.racks.filter((rack) => sentRackIds.includes(Number(rack.id)))
    if (!trackedRacks.length) return

    const completed = trackedRacks.filter((rack) => {
      const rackId = Number(rack.id)
      const rackEntries = operationTelemetry.data
        .filter((entry: any) => Number(entry.rack_id) === rackId && Number(entry.id) > baselineOperationId)
        .sort((a: any, b: any) => Number(a.id ?? 0) - Number(b.id ?? 0))
      const movingState = operation.kind === 'OPEN' ? 1 : operation.kind === 'CLOSE' ? 2 : 3
      const movementEntry = rackEntries.find((entry: any) => Number(entry.state) === movingState && Number(entry.is_endpoint) !== 1)
      if (!movementEntry) return false
      const finalEntry = rackEntries
        .filter((entry: any) => Number(entry.id) > Number(movementEntry.id) && Number(entry.is_endpoint) === 1 && Number(entry.state) === -1)
        .at(-1)
      if (!finalEntry) return false

      const displacement = Number(finalEntry.displacement)
      return operation.kind === 'OPEN' ? displacement >= 64 : displacement <= 0
    })
    const completedIds = completed.map((rack) => Number(rack.id))
    setCompletedRackIds(completedIds)
    if (completedIds.length !== trackedRacks.length) return

    setOperationPhase(failedRacks.length ? 'uncertain' : 'success')
    void queryClient.invalidateQueries({ queryKey: ['cabinet', id, 'racks'] })
  }, [baselineOperationId, failedRacks.length, id, operation, operationPhase, operationTelemetry.data, queryClient, sentRackIds])

  useEffect(() => {
    if (operationPhase !== 'waiting') return
    const timeout = window.setTimeout(() => setOperationPhase('uncertain'), 60000)
    return () => window.clearTimeout(timeout)
  }, [operationPhase])

  const closeOperationDialog = () => {
    if (operationBusy || operationPhase === 'sending' || operationPhase === 'waiting') return
    setOperation(null)
    setOperationPhase('confirm')
    setBaselineOperationId(0)
    setOperationError('')
    setSentRackIds([])
    setCompletedRackIds([])
    setFailedRacks([])
  }

  const confirmOperation = async () => {
    if (!operation || !id) return
    setOperationBusy(true)
    setOperationPhase('sending')
    setOperationError('')
    setSentRackIds([])
    setCompletedRackIds([])
    setFailedRacks([])
    try {
      const telemetry = await systemAPI.getOperationData(100)
      setBaselineOperationId(Math.max(0, ...(telemetry.data.data || []).map((entry: any) => Number(entry.id) || 0)))

      const sentIds: number[] = []
      const failures: Array<{ rack: any; message: string }> = []
      for (const rack of operation.racks) {
        try {
          const response = await api.post('/operator/device-commands', {
            rack_id: Number(rack.id),
            kind: operation.kind,
            request_key: `${operation.requestKey}-${rack.id}`
          }, { headers: { 'X-Operator-Session': session } })
          if (response.data.state === 'local_sent') sentIds.push(Number(rack.id))
          else failures.push({ rack, message: 'Command delivery is uncertain.' })
        } catch (error: any) {
          if (error?.response?.status === 403) onSessionExpired()
          failures.push({ rack, message: error?.response?.data?.detail || error?.message || 'Command failed.' })
        }
        setSentRackIds([...sentIds])
        setFailedRacks([...failures])
      }

      if (!sentIds.length) {
        setOperationPhase('uncertain')
      } else if (operation.kind === 'OPEN' || operation.kind === 'CLOSE' || operation.kind === 'VENTILATE') {
        setOperationPhase('waiting')
      } else {
        setOperationPhase(failures.length ? 'uncertain' : 'sent')
      }
    } catch (error: any) {
      if (error?.response?.status === 403) onSessionExpired()
      setOperationError(error?.response?.data?.detail || error?.message || 'The operation could not be completed.')
      setOperationPhase('confirm')
    } finally {
      setOperationBusy(false)
    }
  }

  const operationLabel = operation?.kind === 'VENTILATE'
    ? `ventilate all ${operation.racks.length} racks in this cabinet`
    : `${operation?.kind} ${operation?.racks[0]?.rack_name || operation?.racks[0]?.rack_code || 'this rack'}`
  const requestOperation = (kind: CabinetOperation['kind'], targetRacks: any[]) => {
    const requestKey = Array.from(crypto.getRandomValues(new Uint8Array(24)), value => value.toString(16).padStart(2, '0')).join('')
    setOperation({ kind, racks: targetRacks, requestKey })
    setOperationPhase('confirm')
    setBaselineOperationId(0)
    setOperationError('')
    setSentRackIds([])
    setCompletedRackIds([])
    setFailedRacks([])
  }

  const dialogTitle = operationPhase === 'success'
    ? operation?.kind === 'VENTILATE'
      ? 'Cabinet ventilation complete'
      : `${operation?.kind === 'OPEN' ? 'Rack opened' : 'Rack closed'} successfully`
    : operationPhase === 'waiting'
      ? operation?.kind === 'VENTILATE'
        ? 'Ventilating cabinet'
        : `${operation?.kind === 'OPEN' ? 'Opening' : 'Closing'} rack`
      : operationPhase === 'sending'
        ? 'Sending command'
        : operationPhase === 'uncertain'
          ? 'Operation not confirmed'
          : operationPhase === 'sent'
            ? 'Operation sent'
            : 'Confirm operation'

  return <Stack spacing={2}>
    <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'center' }} spacing={2} sx={{ p: { xs: 2, md: 2.5 }, borderRadius: 2, background: 'linear-gradient(115deg, rgba(0,119,163,0.10), rgba(0,119,163,0.02) 58%, #fff 100%)', border: '1px solid', borderColor: 'divider' }}>
      <Box>
        <Button size="small" startIcon={<ArrowBack />} onClick={() => navigate('/cabinets')} sx={{ mb: 1, minHeight: 32, px: 1 }}>Cabinets</Button>
        <Typography variant="h4" sx={{ fontWeight: 800, lineHeight: 1.15 }}>Cabinet {id}</Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>Rack status and local controls</Typography>
      </Box>
      <Button
        variant="contained"
        color="info"
        startIcon={<Air />}
        disabled={!canOperate || operationBusy || !!operation || !racks.length}
        onClick={() => requestOperation('VENTILATE', racks)}
        sx={{ minHeight: 44, px: 2.25, alignSelf: { xs: 'stretch', md: 'center' } }}
      >
        Ventilate cabinet
      </Button>
    </Stack>
    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
      <Chip icon={<Storage />} label={`${racks.length} racks`} variant="outlined" />
      <Chip label="Local Serial control" color="success" variant="outlined" />
      {!canOperate && <Chip label="Operator access required" color="warning" variant="outlined" />}
    </Stack>
    {query.isError && <Alert severity="error">Could not load cabinet racks. Check the local IPC connection and retry.</Alert>}
    {!query.isLoading && !query.data?.length && <Alert severity="warning">No racks are configured for this cabinet.</Alert>}
    <Grid container spacing={1.5}>{racks.map((rack: any, index: number) => {
      const rackState = String(rack.status || '').trim().toLowerCase()
      const isOpen = rackState === 'open' || rackState === 'opened'
      const isClosed = rackState === 'closed'
      const isMoving = ['opening', 'closing', 'moving'].includes(rackState)
      return <Grid item xs={12} sm={6} lg={4} key={rack.id}>
        <Card variant="outlined" sx={{ height: '100%', borderRadius: 1.5, borderColor: isOpen ? 'success.light' : 'divider', transition: 'border-color 160ms ease, box-shadow 160ms ease', '&:hover': { boxShadow: 2 } }}>
          <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
            <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1.5}>
              <Stack direction="row" spacing={1.25} alignItems="center" minWidth={0}>
                <Avatar variant="rounded" sx={{ width: 38, height: 38, bgcolor: isOpen ? 'success.50' : 'primary.50', color: isOpen ? 'success.dark' : 'primary.main' }}>
                  {isOpen ? <LockOpen fontSize="small" /> : <Lock fontSize="small" />}
                </Avatar>
                <Box minWidth={0}>
                  <Typography variant="subtitle1" fontWeight={750} noWrap>{rack.rack_name || `Rack ${index + 1}`}</Typography>
                  <Typography variant="caption" color="text.secondary">Address {rack.rack_code}</Typography>
                </Box>
              </Stack>
              <Chip size="small" label={rack.status || 'Unknown'} color={isOpen ? 'success' : 'default'} sx={{ maxWidth: 110 }} />
            </Stack>
            <Divider sx={{ my: 1.5 }} />
            <Stack direction="row" justifyContent="space-between" spacing={1}>
              <Box><Typography variant="caption" color="text.secondary">Position</Typography><Typography variant="body2" fontWeight={600}>{rack.position ?? '--'}</Typography></Box>
              <Box sx={{ textAlign: 'right' }}><Typography variant="caption" color="text.secondary">Updated</Typography><Typography variant="body2" fontWeight={600}>{rack.last_updated || '--'}</Typography></Box>
            </Stack>
            <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
              {isClosed && <Button size="small" variant="contained" startIcon={<LockOpen />} disabled={!canOperate || operationBusy || !!operation} onClick={() => requestOperation('OPEN', [rack])} sx={{ flex: 1, minHeight: 38, px: 1 }}>
                Open
              </Button>}
              {isOpen && <Button size="small" variant="outlined" startIcon={<Lock />} disabled={!canOperate || operationBusy || !!operation} onClick={() => requestOperation('CLOSE', [rack])} sx={{ flex: 1, minHeight: 38, px: 1 }}>
                Close
              </Button>}
              {isMoving && <Chip label="Moving" color="info" variant="outlined" sx={{ flex: 1 }} />}
              {!isOpen && !isClosed && !isMoving && <Chip label="Awaiting status" variant="outlined" sx={{ flex: 1 }} />}
              <Button size="small" variant="outlined" aria-label={`Toggle light for ${rack.rack_name || `rack ${index + 1}`}`} disabled={!canOperate || operationBusy || !!operation} onClick={() => requestOperation('LIGHT', [rack])} sx={{ minWidth: 40, minHeight: 38, px: 1 }}>
                <Lightbulb fontSize="small" />
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </Grid>
    })}</Grid>
    <Dialog open={!!operation} onClose={closeOperationDialog} maxWidth="sm" fullWidth disableEscapeKeyDown={operationPhase === 'sending' || operationPhase === 'waiting'} PaperProps={{ sx: { borderRadius: 2, overflow: 'hidden' } }}>
      <Box sx={{ height: 5, bgcolor: operationPhase === 'success' ? 'success.main' : operationPhase === 'uncertain' ? 'warning.main' : 'info.main' }} />
      <DialogTitle sx={{ pb: 1, fontWeight: 750 }}>{dialogTitle}</DialogTitle>
      <DialogContent sx={{ pt: 1.5 }}>
        {operationPhase === 'success' ? (
          <Stack alignItems="center" spacing={1.5} sx={{ py: 3, textAlign: 'center' }}>
            <Avatar sx={{ width: 64, height: 64, bgcolor: 'success.50', color: 'success.main' }}><CheckCircle sx={{ fontSize: 42 }} /></Avatar>
            <Typography variant="h6" fontWeight={750}>{operation?.kind === 'VENTILATE' ? 'Cabinet ventilation complete' : `${operation?.kind === 'OPEN' ? 'Rack opened' : 'Rack closed'} successfully`}</Typography>
            <Typography color="text.secondary">
              {operation?.kind === 'VENTILATE'
                ? `All ${sentRackIds.length} racks returned to the ventilation endpoint.`
                : 'Simulation telemetry confirmed the rack reached its target endpoint.'}
            </Typography>
          </Stack>
        ) : operationPhase === 'waiting' || operationPhase === 'sending' ? (
          <Stack spacing={2} sx={{ py: 1 }}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <CircularProgress size={26} />
              <Box>
                <Typography fontWeight={700}>{operationPhase === 'sending' ? 'Sending local commands' : 'Waiting for simulation'}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {operationPhase === 'sending' ? 'Contacting each rack through the local Serial link.' : 'Completion is confirmed by fresh endpoint telemetry.'}
                </Typography>
              </Box>
            </Stack>
            {operationPhase === 'waiting' && <LinearProgress variant="determinate" value={sentRackIds.length ? completedRackIds.length / sentRackIds.length * 100 : 0} sx={{ height: 7, borderRadius: 4 }} />}
            <Stack spacing={0.75}>
              {operation?.racks.map((rack: any) => {
                const rackId = Number(rack.id)
                const complete = completedRackIds.includes(rackId)
                const failed = failedRacks.some(item => Number(item.rack.id) === rackId)
                const sent = sentRackIds.includes(rackId)
                return <Stack key={rackId} direction="row" alignItems="center" spacing={1} sx={{ py: 0.75, px: 1, borderRadius: 1, bgcolor: 'background.default' }}>
                  {complete ? <CheckCircle color="success" fontSize="small" /> : failed ? <ErrorOutline color="error" fontSize="small" /> : <CircularProgress size={16} />}
                  <Typography variant="body2" sx={{ flex: 1 }}>{rack.rack_name || `Rack ${rack.rack_code}`}</Typography>
                  <Chip size="small" label={complete ? 'Complete' : failed ? 'Not confirmed' : sent ? 'Running' : 'Queued'} color={complete ? 'success' : failed ? 'error' : 'default'} variant={complete || failed ? 'filled' : 'outlined'} />
                </Stack>
              })}
            </Stack>
            {operationTelemetry.isError && <Alert severity="warning">Local telemetry is temporarily unavailable; the popup will keep waiting.</Alert>}
          </Stack>
        ) : operationPhase === 'uncertain' ? (
          <Stack spacing={1.5}>
            <Alert severity="warning" icon={<ErrorOutline />}>Some commands could not be confirmed, or a rack did not reach its endpoint within 60 seconds. Check the cabinet before retrying.</Alert>
            {failedRacks.map(({ rack, message }) => <Typography key={rack.id} variant="body2" color="error">{rack.rack_name || `Rack ${rack.rack_code}`}: {message}</Typography>)}
          </Stack>
        ) : operationPhase === 'sent' ? (
          <Alert severity="info">The {operation?.kind} command was sent through the local Serial link.</Alert>
        ) : (
          <Stack spacing={2}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Avatar variant="rounded" sx={{ bgcolor: operation?.kind === 'VENTILATE' ? 'info.50' : 'primary.50', color: operation?.kind === 'VENTILATE' ? 'info.main' : 'primary.main' }}>
                {operation?.kind === 'VENTILATE' ? <Air /> : operation?.kind === 'OPEN' ? <LockOpen /> : operation?.kind === 'CLOSE' ? <Lock /> : <Lightbulb />}
              </Avatar>
              <Box>
                <Typography fontWeight={700}>{operationLabel}</Typography>
                <Typography variant="body2" color="text.secondary">Commands run locally; no Server confirmation is required.</Typography>
              </Box>
            </Stack>
            <Divider />
            {operation?.kind === 'VENTILATE' && <Typography variant="body2" color="text.secondary">The command will be sent to every rack in this cabinet ({operation.racks.length}).</Typography>}
            {operationError && <Alert severity="error">{operationError}</Alert>}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {operationPhase === 'success' || operationPhase === 'sent' || operationPhase === 'uncertain' ? (
          <Button onClick={closeOperationDialog} variant="contained" sx={{ minHeight: 40, px: 2 }}>Done</Button>
        ) : (
          <>
            {operationPhase === 'confirm' && <Button onClick={closeOperationDialog} disabled={operationBusy} sx={{ minHeight: 40 }}>Cancel</Button>}
            <Button onClick={() => void confirmOperation()} variant="contained" disabled={operationBusy || operationPhase !== 'confirm'} sx={{ minHeight: 40, px: 2 }}>
              {operationBusy ? <CircularProgress size={20} color="inherit" /> : operation?.kind === 'VENTILATE' ? 'Ventilate cabinet' : 'Confirm command'}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  </Stack>
}
