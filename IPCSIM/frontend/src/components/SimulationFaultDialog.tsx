import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material'
import { CheckCircle, Home, WarningAmber } from '@mui/icons-material'
import { errorText, t, useLanguage } from '../i18n'

interface Props {
  incident: any
  ready: boolean
  online: boolean
  canResume: boolean
  canHome: boolean
  busy: boolean
  action?: string
  error: any
  onRecover: (action: 'RESUME' | 'HOME') => void
}

export function SimulationFaultDialog({ incident, ready, online, canResume, canHome, busy, action, error, onRecover }: Props) {
  useLanguage()
  const context = incident?.context
  // Offline transport warnings belong to the global monitor. A reconnected
  // interrupted command still needs explicit checkpoint recovery confirmation.
  if (context?.error_code === 'COMMUNICATION_LOST' && !['REQUIRES_HOME', 'FATAL'].includes(context?.classification) &&
    (!online || !context?.command_id)) return null
  const command = incident?.command
  const localRack = (address: number) => (address - 1) % 6 + 1
  const rack = context?.moving_rack_id || context?.rack_id || command?.rack_id
  const faultRack = context?.rack_id || rack
  const tone = ready ? 'success' : 'error'
  return <Dialog open={!!incident} disableEscapeKeyDown maxWidth="sm" fullWidth
    aria-labelledby="simulation-fault-title" aria-describedby="simulation-fault-description"
    PaperProps={{ sx: { borderRadius: 4, overflow: 'hidden', border: '1px solid', borderColor: `${tone}.main` } }}>
    <Box sx={{ height: 6, bgcolor: `${tone}.main` }} />
    <DialogTitle id="simulation-fault-title">
      <Stack direction="row" alignItems="center" spacing={1.5}>
        {ready ? <CheckCircle color="success" sx={{ fontSize: 36 }} /> : <WarningAmber color="error" sx={{ fontSize: 36 }} />}
        <Box><Typography component="span" fontWeight={750}>{ready ? t('Fault resolved') : t('Operation interrupted')}</Typography>
          <Typography variant="body2" color="text.secondary">{t('Cabinet')} {incident?.cabinetIndex ?? '—'}{faultRack ? ` · Rack ${localRack(faultRack)}` : ''}</Typography></Box>
        <Chip label={ready ? 'READY' : 'FAULT / ERROR'} color={tone} sx={{ ml: 'auto !important' }} />
      </Stack>
    </DialogTitle>
    <DialogContent>
      <Stack spacing={1.5}>
        <Alert severity={tone} id="simulation-fault-description">
          {ready ? t('The device is ready to continue operating.') : !online ? t('Simulation connection lost. Fault clearance cannot be confirmed.') : t('Resolve the fault in Simulation. The operation remains paused.')}
        </Alert>
        <Typography variant="body2" fontWeight={650}>
          {t('Operation:')} {context?.operation || command?.action || '—'}
          {command?.rack_id ? ` · Rack ${localRack(command.rack_id)}` : ''}
        </Typography>
        <Typography variant="body2">
          {context?.error_code ? `${t(context.error_code)} (${context.error_code})` : incident?.error ? errorText(incident.error) : t('Waiting for Simulation snapshot')}
        </Typography>
        <Box sx={{ bgcolor: ready ? '#edf7ed' : 'background.default', p: 1.5, borderRadius: 2 }}>
          <Typography variant="body2" fontWeight={650}>{t('Paused position')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {rack ? `Rack ${localRack(rack)} · ` : ''}{context?.current_position ?? '—'} mm → {context?.target_position ?? '—'} mm
            {context?.progress != null ? ` · ${Math.round(context.progress)}%` : ''}
          </Typography>
          <Typography variant="caption" color="text.secondary">{t('Continue resumes the saved step. Completed steps will not be repeated.')}</Typography>
        </Box>
        {ready && <Typography variant="caption" color="text.secondary">{t('Confirm that obstacles, sensors and the mechanical reference have been inspected before choosing an action.')}</Typography>}
        {ready && !canResume && !busy && <Alert severity="warning">{t('Direct resume is unavailable. Verify the reference and return Home.')}</Alert>}
        <Box component="details" sx={{ fontSize: 12, color: 'text.secondary', overflowWrap: 'anywhere' }}>
          <Box component="summary" sx={{ cursor: 'pointer' }}>{t('Details')}</Box>
          <Typography variant="caption" display="block">{t('Command:')} {context?.command_id || incident?.localCommand?.id || '—'}</Typography>
          <Typography variant="caption" display="block">{t('Fault code:')} {context?.error_code || '—'} · {context?.classification || '—'}</Typography>
          <Typography variant="caption" display="block">{t('Target GAP:')} {command?.target_gap ?? context?.command?.[2] ?? '—'}</Typography>
          <Typography variant="caption" display="block">{t('Fault ID:')} {context?.fault_id || '—'}</Typography>
        </Box>
        {error && <Alert severity="error">{errorText(error)}</Alert>}
        {busy && <Stack direction="row" spacing={1} alignItems="center"><CircularProgress size={18} /><Typography variant="body2">{action === 'HOME' ? t('Waiting for Simulation to start homing…') : t('Waiting for Simulation to resume the saved command…')}</Typography></Stack>}
      </Stack>
    </DialogContent>
    <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
      <Button variant="outlined" color="inherit" startIcon={<Home />} disabled={!ready || !canHome || busy} onClick={() => onRecover('HOME')}>{t('Return Home')}</Button>
      <Button variant="contained" color="success" disabled={!ready || !canResume || busy} onClick={() => onRecover('RESUME')}>{t('Continue operation')}</Button>
    </DialogActions>
  </Dialog>
}
