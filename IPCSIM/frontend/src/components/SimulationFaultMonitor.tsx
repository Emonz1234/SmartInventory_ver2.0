import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { Alert, Dialog, DialogContent, DialogTitle, Stack } from '@mui/material'
import { t, useLanguage } from '../i18n'
import api from '@api/client'
import { systemAPI } from '@api/system'
import { cabinetAPI } from '@api/cabinet'
import { SimulationFaultDialog } from './SimulationFaultDialog'
import { lockedSimulationStates, recoveryIsReady, recoveryWasAcknowledged } from './simulationRecovery'

// Keep faults visible on every page. The cabinet page owns its local workflow
// and renders the same dialog; this monitor handles the other cabinet groups.
export function SimulationFaultMonitor({ session, permissions, onSessionExpired }: {
  session: string; permissions: string[]; onSessionExpired: () => void
}) {
  useLanguage()
  const location = useLocation()
  const health = useQuery({ queryKey: ['cabinet-operation-health'], queryFn: async () => (await systemAPI.getSystemHealth()).data, refetchInterval: 1000 })
  const cabinets = useQuery({ queryKey: ['cabinets', 'list'], queryFn: async () => (await cabinetAPI.list()).data, refetchInterval: 2000 })
  const displayedId = location.pathname.match(/^\/cabinets\/([^/]+)\/?$/)?.[1]
  const displayedGroup = cabinets.data?.find((cabinet: any) => String(cabinet.id) === displayedId)?.cabinet_index
  const [incident, setIncident] = useState<any>(null)
  const [pending, setPending] = useState<any>(null)
  const [error, setError] = useState<any>('')
  const inFlight = useRef(false)
  const device = health.data as any
  const states: any[] = device?.simulation_states || []
  // A disconnected cabinet does not imply a system-wide connection loss.
  const anyCabinetConnected = !health.isError && !!device?.serial_connected &&
    states.some(entry => entry.online)
  const connectionLost = device?.device_type === 'IPCSIM' && !anyCabinetConnected
  const disconnectedGroups = states.filter(entry => !entry.online).map(entry => entry.cabinet_index)
  const state = states.find(entry => entry.cabinet_index === incident?.cabinetIndex)
  const cabinet = cabinets.data?.find((entry: any) => entry.cabinet_index === incident?.cabinetIndex)
  const online = !!state?.online && !!device?.serial_connected && !!device?.simulation_online && !health.isError
  const ready = recoveryIsReady(state, online, incident)
  const authorized = permissions.includes('cabinet.control') && !cabinets.isError && String(cabinet?.status).toUpperCase() === 'ACTIVE'
  const ownedByCabinetPage = !!displayedId && (!cabinets.data || displayedGroup === incident?.cabinetIndex ||
    states.some(entry => entry.cabinet_index === displayedGroup && lockedSimulationStates.includes(entry.system_state) && entry.fault_context))

  useEffect(() => {
    if (displayedId && !cabinets.data) return
    const failed = states.find(entry => (entry.cabinet_index !== displayedGroup || entry.fault_context?.error_code === 'COMMUNICATION_LOST') && lockedSimulationStates.includes(entry.system_state) && entry.fault_context)
    const source = incident ? state : failed
    if (!source?.fault_context || !lockedSimulationStates.includes(source.system_state)) return
    setIncident((previous: any) => ({ cabinetIndex: source.cabinet_index, bootId: source.boot_id,
      context: { ...source.fault_context }, command: source.current_command ?? previous?.command,
      gap: source.current_gap }))
  }, [health.data, displayedId, displayedGroup, cabinets.data])

  useEffect(() => {
    if (incident?.context?.error_code === 'COMMUNICATION_LOST' && online && !state?.fault_context && !lockedSimulationStates.includes(state.system_state)) {
      setIncident(null)
      return
    }
    // Another mounted workflow can confirm recovery for this cabinet. Clearing
    // sensors alone stays RECOVERING and must keep the incident visible.
    if (!pending && incident && online && state?.boot_id === incident.bootId &&
      !lockedSimulationStates.includes(state.system_state) &&
      (state.fault_context?.resumed || !state.fault_context && !state.active_command_id &&
        (state.last_command_id === incident.context?.command_id || state.system_state === 'IDLE' && state.current_gap === 6))) setIncident(null)
  }, [health.data, pending, online])

  useEffect(() => {
    if (!pending || !online || state?.boot_id !== pending.bootId || !(state.sequence > pending.sequence)) return
    if (recoveryWasAcknowledged(state, pending)) {
      setIncident(null)
      setPending(null)
      inFlight.current = false
      setError('')
    } else if (state.system_state === 'ERROR' && !state.fault_context?.cleared ||
      state.event === 'CONTROL_REJECTED' && state.request_id === pending.requestId) {
      setPending(null)
      inFlight.current = false
      setError('Recovery was rejected. Check the current Simulation state.')
    }
  }, [health.data, pending, online])

  const recover = async (action: 'RESUME' | 'HOME') => {
    if (!ready || !authorized || inFlight.current || !(state.allowed_actions || []).includes(action)) return
    inFlight.current = true
    setError('')
    setPending({ action, sequence: state.sequence, bootId: state.boot_id,
      faultId: state.fault_context.fault_id, commandId: state.fault_context.command_id, requestId: null })
    try {
      const response = await api.post('/operator/simulation-recovery', { cabinet_index: state.cabinet_index,
        action, fault_id: state.fault_context.fault_id, confirmed: true }, { headers: { 'X-Operator-Session': session } })
      setPending((previous: any) => previous ? { ...previous, requestId: response.data.request_id } : null)
      await health.refetch()
    } catch (failure: any) {
      if (failure?.response?.status === 403) onSessionExpired()
      setError(failure)
      setPending(null)
      inFlight.current = false
    }
  }

  // The read-only Faults page presents all active faults together. Hardware stays
  // interlocked; visiting the cabinet page opens its existing recovery workflow.
  return <><SimulationFaultDialog incident={ownedByCabinetPage || location.pathname === '/breakdown' ? null : incident} ready={ready || !!pending && online && !!state?.fault_context?.cleared && state?.system_state === 'RECOVERING'} online={online}
    canResume={authorized && (state?.allowed_actions || []).includes('RESUME')}
    canHome={authorized && (state?.allowed_actions || []).includes('HOME')}
    busy={!!pending} action={pending?.action} error={error} onRecover={action => void recover(action)} />
    <Dialog open={connectionLost} disableEscapeKeyDown maxWidth="sm" fullWidth
      aria-labelledby="simulation-connection-title" PaperProps={{ sx: { borderRadius: 4, borderTop: '6px solid', borderColor: 'warning.main' } }}>
      <DialogTitle id="simulation-connection-title">{t('Simulation connection lost')}</DialogTitle>
      <DialogContent><Stack spacing={2}>
        <Alert severity="warning">{t('Waiting for Simulation to reconnect. Device operations are unavailable.')}</Alert>
        {disconnectedGroups.length > 0 && <span>{t('Cabinet')} {disconnectedGroups.join(', ')}</span>}
      </Stack></DialogContent>
    </Dialog>
  </>
}
