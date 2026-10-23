import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material'
import { CheckCircle } from '@mui/icons-material'
import { getLanguage, t, useLanguage } from '../i18n'
import { lockedSimulationStates } from './simulationRecovery'

// Read-only progress for an existing command; never dispatch or replay it.
export function SimulationResumeDialog({ tracking, state, online, onClose }: {
  tracking: any; state: any; online: boolean; onClose: () => void
}) {
  useLanguage()
  const sameBoot = state?.boot_id === tracking?.bootId
  const complete = online && sameBoot && state?.last_command_id === tracking?.commandId &&
    !state?.active_command_id && !lockedSimulationStates.includes(state?.system_state) && !state?.fault_context
  const moving = Object.entries(state?.racks || {}).find(([, rack]: any) => rack.is_moving)
  const physical: any = moving?.[1]
  const position = (value: any) => value != null && Number.isFinite(Number(value)) ? Number(value).toFixed(1) : '—'
  const copy = (vi: string, en: string) => getLanguage() === 'en' ? en : vi
  return <Dialog open={!!tracking} maxWidth="sm" fullWidth disableEscapeKeyDown={!complete} onClose={complete ? onClose : undefined}>
    <DialogTitle fontWeight={750}>{complete ? t('Operation complete') : copy('Đang tiếp tục lệnh đã lưu', 'Resuming saved operation')}</DialogTitle>
    <DialogContent><Stack spacing={1.25}>
      <Typography fontWeight={650}>{t('Cabinet')} {tracking?.cabinetIndex} · {tracking?.operation || '—'}</Typography>
      {!online || !sameBoot ? <Alert severity="warning">{t('Waiting for Simulation snapshot')}</Alert> : complete ?
        <Stack direction="row" alignItems="center" spacing={1}><CheckCircle color="success" /><Typography>{t('Simulation endpoint telemetry confirmed the operation.')}</Typography></Stack> :
        <Stack direction="row" alignItems="center" spacing={1}><CircularProgress size={24} /><Typography>{moving ? `Rack ${(Number(moving[0]) - 1) % 6 + 1} · ${position(physical.position_mm)} / ${position(physical.target_position_mm)} mm` : t('Waiting for simulation telemetry…')}</Typography></Stack>}
      {!complete && <Typography variant="body2" color="text.secondary">{copy('Tiếp tục từ bước đã lưu. Chỉ báo hoàn thành sau xác nhận từ Simulation.', 'Continuing the saved step. Completion requires Simulation confirmation.')}</Typography>}
    </Stack></DialogContent>
    <DialogActions><Button variant={complete ? 'contained' : 'text'} onClick={onClose}>{complete ? t('Done') : t('Continue in background')}</Button></DialogActions>
  </Dialog>
}
