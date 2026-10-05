import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, LinearProgress, Paper, Stack, Typography } from '@mui/material'
import { Air, CheckCircle, Home, Lightbulb } from '@mui/icons-material'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import api from '@api/client'
import { systemAPI } from '@api/system'

type Rack = { rack_index?: number; id: number; rack_code: string; rack_name?: string; cabinet_index?: number }
type Step = { rack: Rack; direction: 'LEFT' | 'RIGHT'; fromGap: number; toGap: number }
type CommandRequest = { kind: Command['kind']; rack: Rack; targetGap: number; sourceGap: number | null; steps: Step[] }
type VentilationView = { phase: string; baselineId: number; sentRackIds: number[]; completedRackIds: number[] }
type Command = {
  id: string
  kind: 'OPEN' | 'HOME'
  rack: Rack
  targetGap: number
  sourceGap: number | null
  steps: Step[]
  phase: 'QUEUED' | 'SENDING' | 'WAITING' | 'ERROR'
  baselineId?: number
  startedAt?: number
  error?: string
}
type LogEntry = { id: string; time: string; message: string; tone?: 'error' | 'success' }

const STEP_ESTIMATE_MS = 4500
const TELEMETRY_TIMEOUT_MS = 90000

function rackOrder(rack: Rack) {
  const address = Number(rack.rack_index ?? rack.rack_code)
  return Number.isFinite(address) ? address : Number(rack.id)
}

function gapForRack(order: number) {
  return order <= 2 ? 1 : order - 1
}

function rackPositionUnits(index: number, gap: number) {
  return index * 2 + (index >= gap ? 1 : 0)
}

function makeSteps(racks: Rack[], fromGap: number | null, toGap: number): Step[] {
  if (fromGap === null || fromGap === toGap) return []
  if (toGap > fromGap) {
    return Array.from({ length: toGap - fromGap }, (_, index) => {
      const order = fromGap + index + 1
      return { rack: racks[order - 1], direction: 'LEFT' as const, fromGap: order - 1, toGap: order }
    }).filter(step => !!step.rack)
  }
  return Array.from({ length: fromGap - toGap }, (_, index) => {
    const order = fromGap - index
    return { rack: racks[order - 1], direction: 'RIGHT' as const, fromGap: order, toGap: order - 1 }
  }).filter(step => !!step.rack)
}

function formatGap(gap: number | null) {
  if (!gap) return 'Chưa xác định'
  return gap === 6 ? 'HOME · bên phải R6' : `R${gap} ↔ R${gap + 1}`
}

interface RackOperationPanelProps {
  cabinetId: string | undefined
  racks: Rack[]
  session: string
  permissions: string[]
  onSessionExpired: () => void
  onLightRequest: (rack: Rack, action: 'LIGHT' | 'LIGHT_OFF') => void
  lightBusy?: boolean
  ventilation?: VentilationView | null
  externalVentilated?: boolean
  onBusyChange?: (busy: boolean) => void
  onSimulationRestart?: () => void
  onVentilatedChange?: (ventilated: boolean) => void
  externalGapInvalidation?: string
  blocked?: boolean
}

export const RackOperationPanel = ({ cabinetId, racks: sourceRacks, session, permissions, onSessionExpired, onLightRequest, lightBusy = false, ventilation = null, externalVentilated = false, onBusyChange, onSimulationRestart, onVentilatedChange, externalGapInvalidation = '', blocked = false }: RackOperationPanelProps) => {
  const queryClient = useQueryClient()
  const racks = useMemo(() => [...sourceRacks].sort((a, b) => rackOrder(a) - rackOrder(b)), [sourceRacks])
  const [currentGap, setCurrentGap] = useState<number | null>(null)
  const [activeRackId, setActiveRackId] = useState<number | null>(null)
  const [groupVentilated, setGroupVentilated] = useState(false)
  const [queue, setQueue] = useState<Command[]>([])
  const [current, setCurrent] = useState<Command | null>(null)
  const [confirmation, setConfirmation] = useState<CommandRequest | null>(null)
  const [executionDialogOpen, setExecutionDialogOpen] = useState(false)
  const [lastCompleted, setLastCompleted] = useState<Command | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const logEnd = useRef<HTMLDivElement | null>(null)
  const dispatched = useRef(new Set<string>())
  const initialStateResolved = useRef(currentGap !== null)
  const invalidatedOperation = useRef('')
  const gapRef = useRef<number | null>(currentGap)
  const activeRackRef = useRef<number | null>(null)

  const health = useQuery({ queryKey: ['cabinet-operation-health'], queryFn: async () => (await systemAPI.getSystemHealth()).data, refetchInterval: 2000 })
  const telemetry = useQuery({
    queryKey: ['cabinet-operation-live-telemetry', cabinetId],
    queryFn: async () => (await systemAPI.getOperationData(100)).data.data,
    refetchInterval: (current && ['SENDING', 'WAITING'].includes(current.phase)) || (ventilation && ['sending', 'waiting'].includes(ventilation.phase)) ? 500 : 1500,
    staleTime: 0
  })
  const device = health.data as any
  const isSimulation = device?.device_type === 'IPCSIM' || device?.simulation_online === true
  const connected = !!device?.serial_connected
  const canOperate = permissions.includes('inventory.add_operation')
  const simulationAvailable = !isSimulation || device?.simulation_online === true
  const mechanical = (device?.simulation_states || []).find((entry: any) => entry.cabinet_index === (racks[0]?.cabinet_index ?? Math.floor((Number(racks[0]?.rack_code) - 1) / 6) + 1))
  const fault = mechanical?.fault_context
  const recoveryHistory = useQuery({
    queryKey: ['simulation-recovery-history', cabinetId, session],
    enabled: isSimulation && !!session,
    queryFn: async () => (await api.get('/operator/simulation-state', { headers: { 'X-Operator-Session': session } })).data.history || [],
    refetchInterval: 5000
  })
  const mechanicalLocked = isSimulation && (!mechanical?.online || ['ERROR', 'RECOVERING', 'STOPPED', 'COMMUNICATION_LOST'].includes(mechanical?.system_state))
  const [recoveryAction, setRecoveryAction] = useState<string | null>(null)
  const [recoveryBusy, setRecoveryBusy] = useState(false)
  const [recoveryError, setRecoveryError] = useState('')
  const bootSeen = useRef<string | null>(null)
  const [checkBusy, setCheckBusy] = useState(false)
  const checkFaults = async () => {
    setCheckBusy(true)
    setRecoveryError('')
    try {
      const group = mechanical?.cabinet_index ?? racks[0]?.cabinet_index ?? Math.floor((Number(racks[0]?.rack_code) - 1) / 6) + 1
      await api.post('/operator/simulation-check', { cabinet_index: group }, { headers: { 'X-Operator-Session': session } })
      await health.refetch()
    } catch (error: any) {
      if (error?.response?.status === 403) onSessionExpired()
      setRecoveryError(error?.response?.data?.detail || 'Không lấy được trạng thái Simulation.')
    } finally { setCheckBusy(false) }
  }
  const performRecovery = async () => {
    if (!mechanical || !recoveryAction) return
    setRecoveryBusy(true)
    setRecoveryError('')
    try {
      await api.post('/operator/simulation-recovery', { cabinet_index: mechanical.cabinet_index, action: recoveryAction, fault_id: fault?.fault_id, confirmed: true }, { headers: { 'X-Operator-Session': session } })
      setQueue([])
      if (recoveryAction === 'RESUME') setCurrent(previous => previous ? { ...previous, phase: 'WAITING', error: undefined, startedAt: Date.now() } : null)
      else setCurrent(null)
      setRecoveryAction(null)
      await health.refetch()
    } catch (error: any) {
      if (error?.response?.status === 403) onSessionExpired()
      setRecoveryError(error?.response?.data?.detail || 'Không gửi được yêu cầu phục hồi.')
    } finally { setRecoveryBusy(false) }
  }
  const ready = !!cabinetId && racks.length === 6 && connected && simulationAvailable && canOperate && !blocked && !health.isError && !telemetry.isError && !current?.error && !mechanicalLocked

  const addLog = (message: string, tone?: LogEntry['tone']) => {
    const now = new Date()
    setLogs(previous => [...previous, { id: `${now.getTime()}-${Math.random()}`, time: now.toLocaleTimeString(), message, tone }].slice(-50))
  }

  useEffect(() => {
    gapRef.current = currentGap
  }, [currentGap])
  useEffect(() => {
    activeRackRef.current = activeRackId
  }, [activeRackId])
  useEffect(() => {
    logEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [logs])
  useEffect(() => {
    if (current || !queue.length || mechanicalLocked) return
    setCurrent(queue[0])
    setQueue(previous => previous.slice(1))
  }, [current, queue, mechanicalLocked])
  useEffect(() => {
    onBusyChange?.(!!current || queue.length > 0 || !!confirmation || !!mechanicalLocked || !!mechanical?.active_command_id)
  }, [confirmation, current, onBusyChange, queue.length, mechanicalLocked, mechanical?.active_command_id])
  useEffect(() => {
    onVentilatedChange?.(groupVentilated)
  }, [groupVentilated, onVentilatedChange])

  useEffect(() => {
    if (mechanicalLocked && fault) {
      setQueue(previous => previous.length ? [] : previous)
      setCurrent(previous => previous && previous.phase !== 'ERROR' ? { ...previous, phase: 'ERROR', error: fault.error_code } : previous)
    } else if (fault?.resumed) {
      setCurrent(previous => previous?.phase === 'ERROR' && previous.id === mechanical?.active_command_id ? { ...previous, phase: 'WAITING', error: undefined, startedAt: Date.now() } : previous)
    } else if (mechanical?.online && !mechanicalLocked && !fault && !mechanical.active_command_id && ['IDLE', 'OPEN', 'VENTILATED'].includes(mechanical.system_state)) {
      setCurrent(previous => previous?.phase === 'ERROR' ? null : previous)
    }
  }, [mechanicalLocked, fault?.fault_id, fault?.resumed, mechanical?.active_command_id, mechanical?.online, mechanical?.system_state])

  useEffect(() => {
    if (mechanical) {
      if (mechanical.online && mechanical.boot_id) {
        if (bootSeen.current && bootSeen.current !== mechanical.boot_id) {
          setQueue([])
          setCurrent(null)
          setConfirmation(null)
          setExecutionDialogOpen(false)
          setLastCompleted(null)
          setRecoveryAction(null)
          setRecoveryError('')
          onSimulationRestart?.()
        }
        bootSeen.current = mechanical.boot_id
      }
      setGroupVentilated(mechanical.system_state === 'VENTILATED')
      setCurrentGap(mechanical.current_gap)
      gapRef.current = mechanical.current_gap
      const active = racks.find(rack => Number(rack.rack_code) === mechanical.active_rack)
      setActiveRackId(active?.id ?? null)
      activeRackRef.current = active?.id ?? null
      initialStateResolved.current = true
      return
    }
    if (!device || !telemetry.data || !racks.length) return
    const latest = new Map<number, any>()
    for (const entry of telemetry.data) {
      if (!racks.some(rack => Number(rack.id) === Number(entry.rack_id))) continue
      const previous = latest.get(Number(entry.rack_id))
      if (!previous || Number(entry.id) > Number(previous.id)) latest.set(Number(entry.rack_id), entry)
    }
    const openEntry = [...latest.values()]
      .filter(entry => Number(entry.is_endpoint) === 1 && Number(entry.state) === -1 && Number(entry.displacement) > 0)
      .sort((a, b) => Number(b.id) - Number(a.id))[0]
    if (openEntry) {
      const openRack = racks.find(rack => Number(rack.id) === Number(openEntry.rack_id))
      if (openRack) {
        const order = racks.findIndex(rack => rack.id === openRack.id) + 1
        const inferredGap = gapForRack(order)
        if (gapRef.current !== inferredGap) {
          gapRef.current = inferredGap
          setCurrentGap(inferredGap)
        }
        if (activeRackRef.current !== openRack.id) {
          activeRackRef.current = openRack.id
          setActiveRackId(openRack.id)
        }
      }
    } else if (!initialStateResolved.current) {
      initialStateResolved.current = true
      const moving = [...latest.values()].some((entry: any) => Number(entry.movement_speed) > 0 && Number(entry.is_endpoint) !== 1)
      if (!moving && gapRef.current === null && isSimulation) {
        gapRef.current = 6
        setCurrentGap(6)
      }
    }
  }, [device, isSimulation, racks, telemetry.data, mechanical])

  useEffect(() => {
    if (mechanical || !externalGapInvalidation || invalidatedOperation.current === externalGapInvalidation) return
    invalidatedOperation.current = externalGapInvalidation
    initialStateResolved.current = true
    gapRef.current = null
    activeRackRef.current = null
    setCurrentGap(null)
    setActiveRackId(null)
    addLog('GAP state unavailable after ventilation · Return Home to re-establish', 'error')
  }, [externalGapInvalidation])

  useEffect(() => {
    if (!mechanical && externalVentilated) setGroupVentilated(true)
  }, [externalVentilated])

  useEffect(() => {
    if (!current || current.phase !== 'QUEUED' || dispatched.current.has(current.id)) return
    dispatched.current.add(current.id)
    const send = async () => {
      try {
        const before = await systemAPI.getOperationData(100)
        const baselineId = Math.max(0, ...(before.data.data || []).map((entry: any) => Number(entry.id) || 0))
        setCurrent(previous => previous?.id === current.id ? { ...previous, phase: 'SENDING', baselineId, startedAt: Date.now() } : previous)
        addLog(current.kind === 'HOME' ? 'RETURN_HOME requested' : `OPEN_RACK ${racks.findIndex(rack => rack.id === current.rack.id) + 1} requested`)
        const requestKey = current.id
        const response = await api.post('/operator/device-commands', {
          rack_id: Number(current.rack.id), kind: current.kind, request_key: requestKey
        }, { headers: { 'X-Operator-Session': session } })
        if (response.data.state !== 'local_sent') throw new Error('Serial delivery is uncertain; inspect the cabinet before retrying.')
        setCurrent(previous => previous?.id === current.id ? { ...previous, phase: 'WAITING' } : previous)
        addLog(`${current.kind === 'HOME' ? 'HOME' : `Rack ${racks.findIndex(rack => rack.id === current.rack.id) + 1}`} command sent · waiting for endpoint`)
      } catch (error: any) {
        if (error?.response?.status === 403) onSessionExpired()
        const message = error?.response?.data?.detail || error?.message || 'Command could not be confirmed.'
        setCurrent(previous => previous?.id === current.id ? { ...previous, phase: 'ERROR', error: message } : previous)
        addLog(`ERROR · ${message}`, 'error')
      }
    }
    void send()
  }, [current?.id, current?.phase, onSessionExpired, racks, session])

  useEffect(() => {
    if (mechanicalLocked || !current || !['SENDING', 'WAITING'].includes(current.phase) || current.baselineId === undefined || !telemetry.data) return
    const baselineId = current.baselineId
    const recentCommandEvents = telemetry.data
      .filter((entry: any) => Number(entry.id) > baselineId && Number(entry.rack_id) === Number(current.rack.id))
      .sort((a: any, b: any) => Number(b.id) - Number(a.id))
    const failedEntry = recentCommandEvents.find((entry: any) => Number(entry.is_endpoint) === 1 && Number(entry.state) === -2)
    if (failedEntry) {
      const message = `Simulation reported ERROR for Rack ${racks.findIndex(rack => rack.id === current.rack.id) + 1}. Inspect the cabinet before retrying.`
      setCurrent(previous => previous?.id === current.id ? { ...previous, phase: 'ERROR', error: message } : previous)
      addLog(`ERROR · ${message}`, 'error')
      return
    }
    const finalEntry = telemetry.data
      .filter((entry: any) => Number(entry.id) > baselineId && Number(entry.rack_id) === Number(current.rack.id))
      .sort((a: any, b: any) => Number(b.id) - Number(a.id))
      .find((entry: any) => Number(entry.is_endpoint) === 1 && Number(entry.state) === -1 &&
        (current.kind === 'HOME' ? Number(entry.displacement) <= 0 : Number(entry.displacement) >= 64))
    if (!finalEntry) return
    const nextGap = current.targetGap
    gapRef.current = nextGap
    activeRackRef.current = current.kind === 'HOME' ? null : current.rack.id
    setCurrentGap(nextGap)
    setActiveRackId(activeRackRef.current)
    addLog(current.kind === 'HOME' ? 'Return Home complete · GAP is right of Rack 6' : `Rack ${racks.findIndex(rack => rack.id === current.rack.id) + 1} opened · GAP aligned`, 'success')
    setLastCompleted(current)
    setCurrent(null)
    void queryClient.invalidateQueries({ queryKey: ['cabinet', cabinetId, 'racks'] })
  }, [cabinetId, current, queryClient, racks, telemetry.data, mechanicalLocked])

  useEffect(() => {
    if (!current || current.phase !== 'WAITING' || !current.startedAt) return
    const timer = window.setTimeout(() => {
      if (isSimulation) void api.post('/operator/simulation-stop', { address: Number(current.rack.rack_code) }, { headers: { 'X-Operator-Session': session } }).catch(() => health.refetch())
      const message = 'No endpoint confirmation received within 90 seconds. Check the rack before any retry.'
      setCurrent(previous => previous?.id === current.id ? { ...previous, phase: 'ERROR', error: message } : previous)
      addLog(`ERROR · ${message}`, 'error')
    }, Math.max(0, TELEMETRY_TIMEOUT_MS - (Date.now() - current.startedAt)))
    return () => window.clearTimeout(timer)
  }, [current?.id, current?.phase, current?.startedAt, isSimulation, session])

  const hasPendingOpen = (rackId: number) => current?.kind === 'OPEN' && current.rack.id === rackId ||
    queue.some(command => command.kind === 'OPEN' && command.rack.id === rackId)
  const isRackAlreadyActive = (rackId: number) => !current && !queue.length && activeRackRef.current === rackId
  const hasPendingHome = () => current?.kind === 'HOME' || queue.some(command => command.kind === 'HOME')
  const isAlreadyHome = () => !current && !queue.length && !groupVentilated && gapRef.current === 6 && !activeRackRef.current
  const requestCommand = (kind: Command['kind'], rack?: Rack) => {
    if (!ready || !racks.length || confirmation) return
    const selectedRack = rack || racks[0]
    if (kind === 'HOME' ? hasPendingHome() || isAlreadyHome() : hasPendingOpen(selectedRack.id) || isRackAlreadyActive(selectedRack.id)) return
    const targetGap = kind === 'HOME' ? 6 : gapForRack(racks.findIndex(item => item.id === selectedRack.id) + 1)
    const queuedDestination = queue.at(-1)?.targetGap ?? (current ? current.targetGap : gapRef.current)
    setConfirmation({ kind, rack: selectedRack, targetGap, sourceGap: queuedDestination, steps: makeSteps(racks, queuedDestination, targetGap) })
  }

  const confirmCommand = () => {
    if (!confirmation || !ready) return
    if (confirmation.kind === 'HOME' ? hasPendingHome() || isAlreadyHome() : hasPendingOpen(confirmation.rack.id) || isRackAlreadyActive(confirmation.rack.id)) {
      addLog('Duplicate command ignored; cabinet is already at the requested state')
      setConfirmation(null)
      return
    }
    setGroupVentilated(false)
    setLastCompleted(null)
    setExecutionDialogOpen(true)
    const sourceGap = queue.at(-1)?.targetGap ?? (current ? current.targetGap : gapRef.current)
    const command: Command = {
      ...confirmation,
      sourceGap,
      steps: makeSteps(racks, sourceGap, confirmation.targetGap),
      id: crypto.randomUUID(),
      phase: 'QUEUED'
    }
    setQueue(previous => [...previous, command])
    addLog(command.kind === 'HOME' ? 'RETURN_HOME confirmed and added to queue' : `OPEN_RACK ${rackNumber(command.rack)} confirmed and added to queue`)
    setConfirmation(null)
  }

  const telemetryBaselineId = current?.baselineId ?? -1
  const latestTelemetryByRack = new Map<number, any>()
  for (const entry of telemetry.data || []) {
    const previous = latestTelemetryByRack.get(Number(entry.rack_id))
    if (!previous || Number(entry.id) > Number(previous.id)) latestTelemetryByRack.set(Number(entry.rack_id), entry)
  }
  const errorRackIds = new Set([...latestTelemetryByRack.values()]
    .filter((entry: any) => Number(entry.is_endpoint) === 1 && Number(entry.state) === -2)
    .map((entry: any) => Number(entry.rack_id)))
  const lightOnRackIds = new Set([...latestTelemetryByRack.values()]
    .filter((entry: any) => Number(entry.is_endpoint) === 1 && Number(entry.state) === 0)
    .map((entry: any) => Number(entry.rack_id)))
  const activeMotion = [...latestTelemetryByRack.values()].filter((entry: any) => Number(entry.is_endpoint) !== 1 &&
    Number(entry.movement_speed) > 0 && [1, 2].includes(Number(entry.state)))
  const ventilationMode = mechanical ? mechanical.system_state === 'VENTILATED' || mechanical.current_command?.action === 'VENTILATE' : groupVentilated || !!ventilation && ['sending', 'waiting', 'success', 'uncertain'].includes(ventilation.phase)
  const ventilationActive = !!ventilation && ['sending', 'waiting'].includes(ventilation.phase)
  const ventilationMovingEvent = ventilationActive
    ? activeMotion.filter((entry: any) => Number(entry.id) > ventilation.baselineId)
      .sort((a: any, b: any) => Number(b.id) - Number(a.id))[0]
    : undefined
  const movingEvent = current && ['SENDING', 'WAITING'].includes(current.phase) && current.baselineId !== undefined
    ? activeMotion.filter((entry: any) => Number(entry.id) > telemetryBaselineId)
      .sort((a: any, b: any) => Number(b.id) - Number(a.id))[0]
    : undefined
  const displayMotionEvent = ventilationMovingEvent || movingEvent
  const observedStep = movingEvent && current?.steps.find(step => Number(step.rack.id) === Number(movingEvent.rack_id))
  const observedRack = movingEvent && racks.find(rack => Number(rack.id) === Number(movingEvent.rack_id))
  const ventilationMovingRack = ventilationMovingEvent && racks.find(rack => Number(rack.id) === Number(ventilationMovingEvent.rack_id))
  const movingOrder = observedRack ? racks.findIndex(rack => rack.id === observedRack.id) + 1 : 0
  const observedTransition = movingEvent && observedRack ? {
    rack: observedRack,
    direction: Number(movingEvent.state) === 1 ? 'LEFT' as const : 'RIGHT' as const,
    fromGap: Number(movingEvent.state) === 1 ? movingOrder - 1 : movingOrder,
    toGap: Number(movingEvent.state) === 1 ? movingOrder : movingOrder - 1
  } : undefined
  const movingStep = observedStep || observedTransition
  const movementProgress = displayMotionEvent ? Math.min(100, Math.max(0, Number(displayMotionEvent.displacement || 0) / 64 * 100)) : 0
  const stepIndex = movingStep && current ? current.steps.findIndex(step => step.rack.id === movingStep.rack.id) : -1
  const overallProgress = displayMotionEvent ? movementProgress : 0
  const wireSpeed = Number(displayMotionEvent?.movement_speed || 0)
  const speedMmPerSecond = isSimulation ? wireSpeed * 100 / 64 : null
  const measuredStepRemaining = wireSpeed > 0 ? Math.max(0, (64 - Number(displayMotionEvent?.displacement || 0)) / wireSpeed) : null
  const futureStepCount = current?.steps.length ? Math.max(0, current.steps.length - Math.max(0, stepIndex) - (displayMotionEvent ? 1 : 0)) : 0
  const remainingSeconds = measuredStepRemaining === null
    ? current?.steps.length ? Math.max(0, current.steps.length - Math.max(0, stepIndex)) * STEP_ESTIMATE_MS / 1000 : null
    : measuredStepRemaining + futureStepCount * STEP_ESTIMATE_MS / 1000
  const telemetryMoving = activeMotion.sort((a: any, b: any) => Number(b.id) - Number(a.id))[0]
  const externalMovingRack = telemetryMoving && racks.find(rack => Number(rack.id) === Number(telemetryMoving.rack_id))
  const displayMovingRack = mechanical ? racks.find(rack => mechanical.racks?.[String(rack.rack_code)]?.is_moving) : ventilationMovingRack || movingStep?.rack || observedRack || (!current && externalMovingRack)
  const displayDirection = ventilationMovingEvent
    ? Number(ventilationMovingEvent.state) === 1 ? 'LEFT' : 'RIGHT'
    : movingStep?.direction || (Number(telemetryMoving?.state) === 1 ? 'LEFT' : Number(telemetryMoving?.state) === 2 ? 'RIGHT' : null)
  const visualGap = mechanical ? mechanical.current_gap : ventilationMode ? null : movingStep && movingEvent ? movingStep.fromGap + (movingStep.toGap - movingStep.fromGap) * movementProgress / 100 : currentGap
  const layoutFromGap = movingStep?.fromGap ?? currentGap ?? 6
  const gapLeftPercent = visualGap == null ? null : mechanical ? visualGap / 7 * 100 : visualGap * 2 / 13 * 100
  const stateLabel = mechanical ? mechanical.online ? mechanical.system_state : 'Offline' : ventilationMode ? groupVentilated || ventilation?.phase === 'success' ? 'VENTILATED' : ventilation?.phase === 'uncertain' ? 'CHECK' : ventilationMovingEvent ? 'MOVING' : 'VENTILATING' : current?.phase === 'ERROR' ? 'ERROR' : current?.phase === 'SENDING' ? movingEvent ? 'MOVING' : 'SENDING' : current?.phase === 'WAITING' ? (current.kind === 'HOME' ? 'RETURNING_HOME' : movingEvent ? 'MOVING' : 'WAITING') : displayMovingRack ? 'MOVING' : activeRackId ? 'OPEN' : 'IDLE'
  const stateColor = stateLabel === 'ERROR' || stateLabel === 'CHECK' ? 'error' : stateLabel === 'MOVING' || stateLabel === 'RETURNING_HOME' || stateLabel === 'SENDING' || stateLabel === 'VENTILATING' ? 'warning' : stateLabel === 'OPEN' || stateLabel === 'VENTILATED' ? 'success' : 'default'
  const rackNumber = (rack: Rack) => racks.findIndex(item => item.id === rack.id) + 1
  const currentActiveOrder = activeRackId ? racks.findIndex(rack => rack.id === activeRackId) : -1
  const currentOpen = current?.targetGap ?? queue[0]?.targetGap ?? gapRef.current

  return <Stack className="rack-operation-panel" spacing={2}>
    <Dialog open={!!recoveryAction} onClose={() => !recoveryBusy && setRecoveryAction(null)} maxWidth="xs" fullWidth>
      <DialogTitle>{recoveryAction === 'RESUME' ? 'Resume interrupted command' : recoveryAction === 'HOME' ? 'Verify reference before homing' : 'Abort interrupted command'}</DialogTitle>
      <DialogContent><Typography variant="body2">Confirm inspected obstacles, limit sensors and actual reference position. {recoveryAction === 'HOME' ? 'Homing moves from the current position. Do not confirm an unverified reference.' : recoveryAction === 'RESUME' ? 'The same command continues from its saved position.' : 'The cabinet stops in place; homing is required before a new command.'}</Typography>{recoveryError && <Alert severity="error">{recoveryError}</Alert>}</DialogContent>
      <DialogActions><Button disabled={recoveryBusy} onClick={() => setRecoveryAction(null)}>Cancel</Button><Button disabled={recoveryBusy} onClick={() => void performRecovery()}>Confirm inspection</Button></DialogActions>
    </Dialog>
    <Paper className="rack-operation-main" variant="outlined" sx={{ p: { xs: 2, md: 2 }, borderRadius: 4 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={1.25} sx={{ mb: 1.25 }}>
        <Box>
          <Typography variant="h6" fontWeight={750}>Rack operation</Typography>
          <Typography variant="body2" color="text.secondary">Mỗi lần di chuyển một rack · Rack 1 và 2 dùng chung lối đi.</Typography>
        </Box>
        <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
          {isSimulation && <Button size="small" variant="outlined" disabled={checkBusy || !connected} onClick={() => void checkFaults()}>{checkBusy ? 'Đang kiểm tra…' : 'Kiểm tra lỗi'}</Button>}
          {isSimulation && mechanical?.online && !mechanicalLocked && !fault && <Chip size="small" label="Không có lỗi" color="success" variant="outlined" />}
          <Chip size="small" label={device?.device_type || 'Mode unknown'} color={isSimulation ? 'info' : 'primary'} variant="outlined" />
          <Chip size="small" label={`Serial ${connected ? 'ONLINE' : 'OFFLINE'}`} color={connected ? 'success' : 'error'} />
          <Chip size="small" label={`SIM ${device?.simulation_online ? 'READY' : isSimulation ? 'UNAVAILABLE' : 'N/A'}`} color={device?.simulation_online ? 'success' : isSimulation ? 'warning' : 'default'} variant="outlined" />
        </Stack>
      </Stack>
      {(health.isError || telemetry.isError) && <Alert severity="error" sx={{ mb: 1.5 }}>Không đọc được trạng thái local/telemetry. Lệnh vận hành đã bị khóa.</Alert>}
      {recoveryError && !recoveryAction && <Alert severity="error" sx={{ mb: 1.5 }}>{recoveryError}</Alert>}
      {!connected && <Alert severity="warning" sx={{ mb: 1.5 }}>Serial offline. Không thể gửi lệnh tới rack.</Alert>}
      {isSimulation && !simulationAvailable && <Alert severity="error" sx={{ mb: 1.5 }}>Simulation unavailable. GAP commands are disabled.</Alert>}
      {racks.length !== 6 && <Alert severity="warning" sx={{ mb: 1.5 }}>Cần đúng 6 rack theo thứ tự địa chỉ để dùng sơ đồ GAP. Cabinet hiện có {racks.length} rack.</Alert>}
      {blocked && <Alert severity="info" sx={{ mb: 1.5 }}>Điều khiển GAP tạm khóa trong khi thao tác cabinet khác đang chạy.</Alert>}
      {(mechanicalLocked || fault || current?.phase === 'ERROR') && <Alert severity={!mechanicalLocked && fault?.resumed ? 'info' : mechanical?.system_state === 'RECOVERING' ? 'warning' : 'error'} sx={{ mb: 1.5 }}>
        <Typography variant="body2" fontWeight={700}>Cabinet {mechanical?.cabinet_index} · Rack {fault?.rack_id ? (fault.rack_id - 1) % 6 + 1 : '—'} · {mechanical?.system_state || 'ERROR'}</Typography>
        <Typography variant="caption" display="block">{fault?.previous_state} · {fault?.error_code || current?.error || 'Waiting for Simulation snapshot'} · Current: {fault?.current_position ?? '—'} mm → Target: {fault?.target_position ?? '—'} mm · {fault?.progress !== undefined ? Math.round(fault.progress) + '%' : ''}</Typography>
        {fault?.command_id && <Typography variant="caption" display="block" sx={{ overflowWrap: 'anywhere' }}>Command: {fault.command_id}</Typography>}
        {fault?.moving_rack_id && fault.moving_rack_id !== fault.rack_id && <Typography variant="caption" display="block">Movement interrupted at Rack {(fault.moving_rack_id - 1) % 6 + 1}</Typography>}
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 0.5 }}>
          {(mechanical?.allowed_actions || []).map((action: string) => <Button key={action} size="small" disabled={!canOperate || recoveryBusy} onClick={() => setRecoveryAction(action)}>{action === 'RESUME' ? 'Resume operation' : action === 'ABORT' ? 'Abort operation' : 'Run homing'}</Button>)}
        </Stack>
        {recoveryError && <Typography variant="caption" color="error">{recoveryError}</Typography>}
      </Alert>}

      <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2}>
        <Box className="rack-operation-map" sx={{ flex: 1.6, minWidth: 0, p: { xs: 1.5, sm: 2 }, borderRadius: 3, bgcolor: '#f7fafb', border: '1px solid', borderColor: 'divider' }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="subtitle2" fontWeight={750}>{ventilationMode ? 'Thông gió · 5 khoảng hở' : 'Sơ đồ rack & lối đi'}</Typography>
            <Chip size="small" color={stateColor as any} label={stateLabel} />
          </Stack>
          <Box aria-label="Six-rack GAP arrangement" sx={{ position: 'relative', width: '100%', height: { xs: 90, sm: 116 }, mb: 1.5 }}>
            {racks.map((rack, index) => {
              const physical = mechanical?.racks?.[String(rack.rack_code)]
              const isMoving = physical ? !mechanicalLocked && physical.is_moving : displayMovingRack?.id === rack.id
              const isActive = activeRackId === rack.id
              const isError = physical ? ['ERROR', 'RECOVERING', 'STOPPED'].includes(physical.access_state) : errorRackIds.has(Number(rack.id))
              const isLightOn = lightOnRackIds.has(Number(rack.id))
              const isSpread = groupVentilated || ventilationMode && ventilation?.completedRackIds.includes(Number(rack.id))
              const isTarget = currentOpen !== null && currentOpen !== undefined && currentOpen === gapForRack(index + 1) && current?.kind !== 'HOME'
              const startUnits = rackPositionUnits(index, layoutFromGap)
              const endUnits = movingStep?.rack.id === rack.id ? rackPositionUnits(index, movingStep.toGap) : startUnits
              const rackLeft = startUnits + (endUnits - startUnits) * movementProgress / 100
              const rackState = physical ? mechanical.online ? physical.access_state : 'Offline' : isError ? 'ERROR' : isMoving ? `MOVING ${displayDirection || ''} · ${Math.round(movementProgress)}%` : isSpread ? 'SPREAD' : ventilationMode ? 'WAITING' : isActive ? 'ACTIVE' : 'IDLE'
              const rackWidth = physical ? 100 / 7 : ventilationMode ? 500 / 35 : 200 / 13
              const rackLeftPercent = physical ? physical.position_mm / 700 * 100 : ventilationMode ? index * 6 / 35 * 100 : rackLeft / 13 * 100
              return <Box key={rack.id} title={`Rack ${index + 1}: ${rackState}${isLightOn ? ' · LIGHT ON' : ''}`} sx={{
                position: 'absolute', left: `${rackLeftPercent}%`, top: 0, width: `${rackWidth}%`, height: '100%',
                px: { xs: 0.35, sm: 0.7 }, py: { xs: 0.45, sm: 0.65 }, border: '1px solid', borderRadius: 2,
                borderColor: isError ? 'error.main' : isMoving ? 'warning.main' : isActive ? 'success.main' : isTarget ? 'primary.main' : 'divider',
                bgcolor: isError ? '#fff1f0' : isMoving || isLightOn ? '#fff7e9' : isActive || isSpread ? '#eef8f1' : '#f7fafb',
                transition: 'left 120ms linear, border-color 160ms ease, background-color 160ms ease',
                boxShadow: isMoving ? 1 : 0, zIndex: isMoving ? 2 : 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', overflow: 'hidden'
              }}>
                {isLightOn && <Box aria-label={`Rack ${index + 1} light on`} sx={{ position: 'absolute', top: 4, right: 4, width: 7, height: 7, borderRadius: '50%', bgcolor: 'warning.main', boxShadow: '0 0 0 2px rgba(237, 108, 2, 0.16)' }} />}
                <Typography variant="subtitle2" fontWeight={800} sx={{ fontSize: { xs: 14, sm: 19 }, lineHeight: 1.1 }}>R{index + 1}</Typography>
                <Typography variant="caption" color={isError ? 'error.main' : isMoving ? 'warning.dark' : isActive ? 'success.dark' : 'text.secondary'} noWrap sx={{ fontSize: { xs: 7, sm: 9 }, lineHeight: 1.1, mt: 0.35 }}>
                  {rackState}
                </Typography>
              </Box>
            })}
            {ventilationMode ? racks.slice(0, 5).map((rack, index) => <Box key={`vent-gap-${rack.id}`} title={`Ventilation gap ${index + 1} · 20 mm`} aria-label={`Ventilation gap ${index + 1}`} sx={{
              position: 'absolute', left: `${(index * 6 + 5) / 35 * 100}%`, top: 0, bottom: 0, width: `${100 / 35}%`,
              border: '1px dashed', borderColor: 'info.main', bgcolor: 'rgba(2, 136, 209, 0.10)', borderRadius: 0.5,
              zIndex: 3, display: 'grid', placeItems: 'center', pointerEvents: 'none'
            }}><Typography variant="caption" fontWeight={750} color="info.dark" sx={{ fontSize: { xs: 6, sm: 8 }, writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>GAP</Typography></Box>)
              : gapLeftPercent !== null && <Box title={`ACCESS GAP · ${formatGap(currentGap)}`} aria-label={`Current access gap: ${formatGap(currentGap)}`} sx={{
                position: 'absolute', left: `${gapLeftPercent}%`, top: 0, bottom: 0, width: `${mechanical ? 100 / 7 : 100 / 13}%`,
                border: '1px dashed', borderColor: 'info.main', borderRadius: 0.6, bgcolor: 'rgba(2, 136, 209, 0.10)',
                transition: 'left 120ms linear', zIndex: 3, display: 'grid', placeItems: 'center', pointerEvents: 'none'
              }}><Typography variant="caption" fontWeight={800} color="info.dark" sx={{ fontSize: { xs: 7, sm: 9 }, writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>GAP</Typography></Box>}
          </Box>
          <Stack direction="row" spacing={{ xs: 0.75, sm: 1.5 }} useFlexGap flexWrap="wrap" alignItems="center" sx={{ minHeight: 24, px: 0.5, py: 0.35, borderRadius: 0.75, bgcolor: 'action.hover' }}>
            <Typography variant="caption" noWrap><b>Active:</b> {ventilationMode ? '—' : activeRackId ? `R${currentActiveOrder + 1}` : '—'}</Typography>
            <Typography variant="caption" noWrap><b>GAP:</b> {ventilationMode ? '5 × 20 mm · even spacing' : formatGap(currentGap)}</Typography>
            <Typography variant="caption" noWrap><b>State:</b> {stateLabel}</Typography>
            {displayMovingRack && <Typography variant="caption" noWrap color="warning.dark"><b>Moving:</b> R{rackNumber(displayMovingRack)} {displayDirection} · {Math.round(movementProgress)}%</Typography>}
            {current && <Typography variant="caption" noWrap color="text.secondary">
              {remainingSeconds !== null ? `~${remainingSeconds.toFixed(1)} s left` : current.sourceGap === current.targetGap ? 'No movement' : 'Awaiting telemetry'}
              {movingEvent ? ` · ${speedMmPerSecond !== null ? `~${speedMmPerSecond.toFixed(1)} mm/s · 100 mm` : `speed ${wireSpeed.toFixed(1)}`}` : ''}
            </Typography>}
          </Stack>
          {current && <LinearProgress variant="determinate" value={overallProgress} sx={{ mt: 0.45, height: 3, borderRadius: 3 }} />}
          {ventilation && <Box sx={{ mt: 0.75 }}>
            <Stack direction="row" justifyContent="space-between" spacing={1}>
              <Typography variant="caption" fontWeight={750} noWrap>
                {ventilation.phase === 'success' ? 'All racks evenly spaced' : ventilation.phase === 'uncertain' ? 'Ventilation needs inspection' : ventilationMovingRack ? `Moving R${rackNumber(ventilationMovingRack)} ${displayDirection} · ${Math.round(movementProgress)}%` : 'Distributing racks for ventilation'}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>{ventilation.completedRackIds.length}/6 rack commands complete</Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary" display="block">Target: six racks · five 20 mm gaps · access aisle unavailable during ventilation{ventilationMovingEvent && wireSpeed > 0 ? ` · ${speedMmPerSecond !== null ? `~${speedMmPerSecond.toFixed(1)} mm/s` : `speed ${wireSpeed.toFixed(1)}`}` : ''}</Typography>
            <LinearProgress variant="determinate" value={ventilation.completedRackIds.length / 6 * 100} sx={{ mt: 0.35, height: 3, borderRadius: 3 }} />
          </Box>}
        </Box>

        <Box className="rack-operation-controls" sx={{ flex: 1, minWidth: { xs: 0, lg: 290 }, borderLeft: { lg: '1px solid' }, borderColor: { lg: 'divider' }, pl: { lg: 2 } }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="subtitle2" fontWeight={750}>Mở rack</Typography>
            <Typography variant="caption" color="text.secondary">Queue {queue.length}</Typography>
          </Stack>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 0.75 }}>
            {racks.map((rack, index) => {
              const duplicateOpen = hasPendingOpen(rack.id)
              const alreadyActive = isRackAlreadyActive(rack.id)
              const disabled = !ready || !!current?.error || !!confirmation || duplicateOpen || alreadyActive
              return <Button key={rack.id} size="small" aria-label={`Open R${index + 1}`} title={duplicateOpen ? `Rack ${index + 1} already has an open command pending` : alreadyActive ? `Rack ${index + 1} is already active` : `Open Rack ${index + 1}`} variant={activeRackId === rack.id ? 'contained' : 'outlined'} disabled={disabled} onClick={() => requestCommand('OPEN', rack)} sx={{ minWidth: 0, minHeight: 36, px: 0.25, py: 0, fontSize: 14, fontWeight: 700, borderRadius: 2, boxShadow: 'none' }}>
                R{index + 1}
              </Button>
            })}
          </Box>
          <Stack className="rack-operation-lights" direction="row" spacing={0.5} alignItems="center" sx={{ mt: 1.5 }}>
            <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>Đèn</Typography>
            {racks.map((rack, index) => {
              const lightOn = lightOnRackIds.has(Number(rack.id))
              const action = lightOn ? 'LIGHT_OFF' : 'LIGHT'
              return <IconButton key={rack.id} size="small" title={`Turn light ${lightOn ? 'off' : 'on'} for Rack ${index + 1}`} aria-label={`Turn light ${lightOn ? 'off' : 'on'} for Rack ${index + 1}`} color={lightOn ? 'warning' : 'default'} disabled={!ready || !!current || queue.length > 0 || lightBusy || !!confirmation} onClick={() => onLightRequest(rack, action)} sx={{ width: 36, height: 46, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                <Lightbulb fontSize="small" />
                <Typography component="span" sx={{ fontSize: 9, fontWeight: 650, color: 'inherit', lineHeight: 1 }}>R{index + 1}</Typography>
              </IconButton>
            })}
          </Stack>
          <Button fullWidth variant="outlined" color="inherit" startIcon={<Home />} title={isAlreadyHome() ? 'The cabinet is already at HOME' : hasPendingHome() ? 'A HOME command is already pending' : 'Return Home'} disabled={!ready || !!current?.error || !!confirmation || hasPendingHome() || isAlreadyHome()} onClick={() => requestCommand('HOME')} sx={{ mt: 1.5, minHeight: 36, borderRadius: 2.5 }}>
            Return Home · GAP right of R6
          </Button>
          {!canOperate && <Typography variant="caption" color="warning.main" display="block" sx={{ mt: 1 }}>Operator permission is required.</Typography>}
        </Box>
      </Stack>
    </Paper>

    <Dialog className="cabinet-operation-dialog" open={!!confirmation} onClose={() => setConfirmation(null)} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ pb: 0.5, fontWeight: 750 }}>Confirm rack movement</DialogTitle>
      <DialogContent>
        <Stack spacing={1.25} sx={{ pt: 0.5 }}>
          <Typography variant="body1" fontWeight={700}>
            {confirmation?.kind === 'HOME' ? 'Return GAP to HOME' : `Open Rack ${confirmation ? rackNumber(confirmation.rack) : ''}`}
          </Typography>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            <Chip size="small" variant="outlined" label={`Current: ${formatGap(confirmation?.sourceGap ?? null)}`} />
            <Chip size="small" color="info" variant="outlined" label={`Target: ${formatGap(confirmation?.targetGap ?? null)}`} />
          </Stack>
          {confirmation?.sourceGap === confirmation?.targetGap ? (
            <Alert severity="info">No rack movement is needed. Only the active rack will change.</Alert>
          ) : confirmation?.sourceGap === null ? (
            <Alert severity="warning">Current GAP is unknown. Confirm only after checking the cabinet state.</Alert>
          ) : confirmation?.steps.length ? (
            <Box>
              <Typography variant="caption" color="text.secondary">MOVEMENT PLAN · {confirmation.steps.length} step{confirmation.steps.length === 1 ? '' : 's'} · approximately {confirmation.steps.length * 4.5}s</Typography>
              <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                {confirmation.steps.map((step, index) => <Typography key={`${step.rack.id}-${step.fromGap}`} variant="body2">
                  {index + 1}. Rack {rackNumber(step.rack)} {step.direction} · GAP {step.fromGap} → {step.toGap}
                </Typography>)}
              </Stack>
            </Box>
          ) : <Typography variant="body2" color="text.secondary">No rack movement is expected.</Typography>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 2, pb: 2 }}>
        <Button onClick={() => setConfirmation(null)}>Cancel</Button>
        <Button variant="contained" disabled={!ready} onClick={confirmCommand}>
          Confirm {confirmation?.kind === 'HOME' ? 'Return Home' : `Open Rack ${confirmation ? rackNumber(confirmation.rack) : ''}`}
        </Button>
      </DialogActions>
    </Dialog>

    <Dialog className="cabinet-operation-dialog" open={executionDialogOpen} onClose={() => setExecutionDialogOpen(false)} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 750 }}>
        {current?.phase === 'ERROR' ? 'Operation needs attention' : current ? current.kind === 'HOME' ? 'Returning GAP to HOME' : `Opening Rack ${rackNumber(current.rack)}` : 'Operation complete'}
      </DialogTitle>
      <DialogContent>
        {current?.phase === 'ERROR' ? <Alert severity="error">{current.error} Check the cabinet before retrying.</Alert> : current ? (
          <Stack spacing={1.25} sx={{ py: 0.5 }}>
            <Stack direction="row" spacing={1.25} alignItems="center">
              <CircularProgress size={24} />
              <Box>
                <Typography variant="body2" fontWeight={700}>
                  {current.phase === 'SENDING' ? 'Sending command to IPCSIM…' : displayMovingRack ? `Moving Rack ${rackNumber(displayMovingRack)} ${displayDirection}` : 'Waiting for simulation telemetry…'}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {current.phase === 'SENDING' ? 'The command is being delivered over Serial.' : displayMovingRack ? `${Math.round(movementProgress)}% · ${remainingSeconds !== null ? `~${remainingSeconds.toFixed(1)} s remaining` : 'movement in progress'}` : 'Success appears after the target endpoint is confirmed.'}
                </Typography>
              </Box>
            </Stack>
            <LinearProgress variant="determinate" value={current.phase === 'SENDING' ? 0 : current.steps.length ? Math.min(99, ((Math.max(0, stepIndex) + movementProgress / 100) / current.steps.length) * 100) : 90} sx={{ height: 6, borderRadius: 4 }} />
            <Typography variant="caption" color="text.secondary">
              {current.kind === 'HOME' ? `Target: ${formatGap(6)}` : `Target: Rack ${rackNumber(current.rack)} · ${formatGap(current.targetGap)}`}
              {queue.length ? ` · ${queue.length} command${queue.length === 1 ? '' : 's'} waiting` : ''}
            </Typography>
          </Stack>
        ) : lastCompleted ? (
          <Stack alignItems="center" spacing={1.25} sx={{ py: 2, textAlign: 'center' }}>
            <CheckCircle color="success" sx={{ fontSize: 48 }} />
            <Typography variant="h6" fontWeight={750}>{lastCompleted.kind === 'HOME' ? 'Returned Home successfully' : `Rack ${rackNumber(lastCompleted.rack)} opened successfully`}</Typography>
            <Typography variant="body2" color="text.secondary">Simulation endpoint telemetry confirmed the operation.</Typography>
          </Stack>
        ) : <Typography variant="body2" color="text.secondary">Command queued and waiting to start.</Typography>}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setExecutionDialogOpen(false)}>{current ? 'Continue in background' : 'Done'}</Button>
      </DialogActions>
    </Dialog>

    <Paper className="rack-operation-history" variant="outlined" sx={{ p: { xs: 2, md: 2 }, borderRadius: 4 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
        <Box sx={{ flex: 1 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="subtitle2" fontWeight={750}>Hàng đợi lệnh</Typography>
            <Chip size="small" label={`${queue.length} waiting`} color={queue.length ? 'warning' : 'default'} variant="outlined" />
          </Stack>
          <Stack spacing={0.5} sx={{ maxHeight: 140, overflowY: 'auto' }}>
            {current && <Stack direction="row" justifyContent="space-between" sx={{ px: 1, py: 0.6, bgcolor: 'action.hover', borderRadius: 0.75 }}>
              <Typography variant="body2">{current.kind === 'HOME' ? 'RETURN_HOME' : `OPEN_RACK ${rackNumber(current.rack)}`}</Typography>
              <Chip size="small" label={current.phase} color={current.phase === 'ERROR' ? 'error' : 'info'} />
            </Stack>}
            {queue.map((command, index) => <Stack key={command.id} direction="row" justifyContent="space-between" sx={{ px: 1, py: 0.6 }}>
              <Typography variant="body2">{index + 1}. {command.kind === 'HOME' ? 'RETURN_HOME' : `OPEN_RACK ${rackNumber(command.rack)}`}</Typography>
              <Chip size="small" label={command.steps.length ? `${command.steps.length} movement step${command.steps.length === 1 ? '' : 's'}` : command.sourceGap === command.targetGap ? 'No movement' : 'GAP unknown'} variant="outlined" />
            </Stack>)}
            {!current && !queue.length && <Typography variant="body2" color="text.secondary">No command waiting.</Typography>}
          </Stack>
        </Box>
        <Box sx={{ flex: 1, borderLeft: { md: '1px solid' }, borderColor: { md: 'divider' }, pl: { md: 2 } }}>
          <Typography variant="subtitle2" fontWeight={750} sx={{ mb: 1 }}>Nhật ký thao tác</Typography>
          <Box sx={{ maxHeight: 140, overflowY: 'auto', fontFamily: 'monospace' }}>
            {(recoveryHistory.data || []).filter((entry: any) => entry.cabinet_index === mechanical?.cabinet_index).slice(0, 30).map((entry: any) => <Typography key={`recovery-${entry.id}`} variant="caption" display="block" color={entry.event.includes('error') || entry.event.includes('fault') ? 'error.main' : 'text.secondary'}>[{new Date(entry.timestamp * 1000).toLocaleTimeString()}] {entry.event}</Typography>)}
            {logs.map(entry => <Typography key={entry.id} variant="caption" display="block" color={entry.tone === 'error' ? 'error.main' : entry.tone === 'success' ? 'success.dark' : 'text.secondary'}>
              [{entry.time}] {entry.message}
            </Typography>)}
            {!logs.length && <Typography variant="body2" color="text.secondary">Operation events will appear here.</Typography>}
            <div ref={logEnd} />
          </Box>
        </Box>
      </Stack>
    </Paper>
  </Stack>
}
