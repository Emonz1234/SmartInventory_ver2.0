// Recovery permissions come exclusively from reconciled backend snapshots.
export const lockedSimulationStates = ['ERROR', 'RECOVERING', 'STOPPED', 'COMMUNICATION_LOST']

export function recoveryIsReady(state: any, online: boolean, incident: any) {
  const fault = state?.fault_context
  return online && !!fault?.cleared && !fault.resumed && ['RECOVERING', 'STOPPED'].includes(state?.system_state) &&
    !Object.values(state?.sensors?.faults || {}).some((errors: any) => errors?.length > 0) &&
    incident?.bootId === state?.boot_id && incident?.context?.fault_id === fault?.fault_id &&
    (state?.allowed_actions || []).some((action: string) => ['RESUME', 'HOME'].includes(action))
}

export function recoveryWasAcknowledged(state: any, pending: any) {
  if (!pending || !state?.online || state.boot_id !== pending.bootId || !(state.sequence > pending.sequence) ||
    lockedSimulationStates.includes(state.system_state)) return false
  const fault = state.fault_context
  const sameCommand = state.active_command_id === pending.commandId || state.last_command_id === pending.commandId
  if (pending.action === 'RESUME') return sameCommand && (fault?.resumed || !fault && !state.active_command_id)
  return state.current_command?.action === 'HOME' && fault?.fault_id === pending.faultId ||
    !fault && state.current_gap === 6 && state.system_state === 'IDLE' && (!pending.commandId || sameCommand)
}
