import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Tooltip, Typography } from '@mui/material'
import { CheckCircle, Home, WarningAmber } from '@mui/icons-material'
import { errorText, getLanguage, t, useLanguage } from '../i18n'

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
  const copy = (vi: string, en: string) => getLanguage() === 'en' ? en : vi
  const finite = (value: any) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null
  const localRack = (address: number) => finite(address) !== null && Number(address) > 0 ? (Number(address) - 1) % 6 + 1 : '—'
  const rack = context?.moving_rack_id || context?.rack_id || command?.rack_id
  const faultRack = context?.rack_id || rack
  const severity = String(context?.severity || incident?.severity || '').toUpperCase()
  const warning = severity === 'WARNING'
  const critical = severity === 'CRITICAL' || context?.classification === 'FATAL'
  const tone = ready ? 'success' : warning ? 'warning' : 'error'
  const operation = context?.operation || command?.action || '—'
  const position = finite(context?.current_position)
  const target = finite(context?.target_position)
  const progress = finite(context?.progress)
  const reason = !online ? t('Simulation connection lost. Fault clearance cannot be confirmed.') : !ready ? t('Resolve the fault in Simulation. The operation remains paused.') : !canResume ? t('Direct resume is unavailable. Verify the reference and return Home.') : ''
  return <Dialog open={!!incident} disableEscapeKeyDown maxWidth="sm" fullWidth
    aria-labelledby="simulation-fault-title" aria-describedby="simulation-fault-description"
    PaperProps={{ sx: { borderRadius: 3, overflow: 'hidden', border: '1px solid', borderColor: `${tone}.main` } }}>
    <Box sx={{ height: 4, bgcolor: `${tone}.main` }} />
    <DialogTitle id="simulation-fault-title" sx={{ px: 2.5, pt: 2, pb: 1 }}>
      <Stack direction="row" alignItems="flex-start" spacing={1.25}>
        {ready ? <CheckCircle color="success" sx={{ fontSize: 28 }} /> : <WarningAmber color={warning ? 'warning' : 'error'} sx={{ fontSize: 28 }} />}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography component="span" fontWeight={750} color={ready ? 'success.dark' : warning ? 'warning.dark' : 'error.main'} sx={{ overflowWrap: 'anywhere', fontSize: 20 }}>{context?.error_code || (incident?.error ? errorText(incident.error) : t('Operation interrupted'))}</Typography>
          <Typography variant="body1" fontWeight={650}>{t('Cabinet')} {incident?.cabinetIndex ?? '—'}{faultRack ? ` · Rack ${localRack(faultRack)}` : ''}</Typography>
          <Typography variant="body2" color="text.secondary">{ready ? t('Fault resolved') : t('Operation interrupted')} · {operation}{command?.rack_id ? ` · Rack ${localRack(command.rack_id)}` : ''}</Typography>
        </Box>
        <Chip size="small" label={ready ? 'READY' : critical ? t('Critical') : warning ? t('Warning') : 'FAULT / ERROR'} color={tone} />
      </Stack>
    </DialogTitle>
    <DialogContent sx={{ px: 2.5, pb: 1.5 }}>
      <Stack spacing={1.25}>
        <Typography variant="body2">{context?.error_code ? t(context.error_code) : t('Waiting for Simulation snapshot')}</Typography>
        <Alert severity={tone} id="simulation-fault-description" sx={{ py: 0.25 }}>
          {ready ? canResume ? t('The device is ready to continue operating.') : t('Direct resume is unavailable. Verify the reference and return Home.') : reason}
        </Alert>
        <Box sx={{ bgcolor: ready ? '#edf7ed' : 'background.default', p: 1.25, borderRadius: 2 }}>
          <Typography variant="body2" fontWeight={650}>{t('Paused position')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {rack ? `Rack ${localRack(rack)} · ` : ''}{position === null ? '—' : position.toFixed(1)} / {target === null ? '—' : target.toFixed(1)} mm
            {progress !== null ? ` · ${Math.round(Math.min(100, Math.max(0, progress)))}%` : ''}
          </Typography>
          <Typography variant="caption" color="text.secondary">{copy('Tiếp tục từ bước đã lưu, không chạy lại bước đã xong.', 'Resume from the saved step; completed steps are not repeated.')}</Typography>
        </Box>
        {ready && <Typography variant="caption" color="text.secondary">{t('Confirm that obstacles, sensors and the mechanical reference have been inspected before choosing an action.')}</Typography>}
        <Box component="details" sx={{ fontSize: 14, color: 'text.secondary', overflowWrap: 'anywhere' }}>
          <Box component="summary" sx={{ cursor: 'pointer' }}>{copy('Chi tiết kỹ thuật', 'Technical details')}</Box>
          <Typography variant="caption" display="block">{t('Command:')} {context?.command_id || incident?.localCommand?.id || '—'}</Typography>
          <Typography variant="caption" display="block">{t('Fault code:')} {context?.error_code || '—'} · {context?.classification || '—'}</Typography>
          <Typography variant="caption" display="block">{t('Target GAP:')} {command?.target_gap ?? context?.command?.[2] ?? '—'}</Typography>
          <Typography variant="caption" display="block">{t('Fault ID:')} {context?.fault_id || '—'}</Typography>
          <Typography variant="caption" display="block">{t('Paused position')}: {String(context?.current_position ?? '—')} / {String(context?.target_position ?? '—')} mm</Typography>
        </Box>
        {error && <Alert severity="error">{errorText(error)}</Alert>}
        {busy && <Stack direction="row" spacing={1} alignItems="center"><CircularProgress size={18} /><Typography variant="body2">{action === 'HOME' ? t('Waiting for Simulation to start homing…') : t('Waiting for Simulation to resume the saved command…')}</Typography></Stack>}
      </Stack>
    </DialogContent>
    <DialogActions sx={{ px: 2.5, pb: 2, gap: 1, flexWrap: 'wrap' }}>
      <Tooltip title={!ready ? reason : !canHome ? copy('Chưa được phép về HOME.', 'HOME is not currently permitted.') : ''}><span><Button variant="outlined" color="inherit" startIcon={<Home />} disabled={!ready || !canHome || busy} onClick={() => onRecover('HOME')}>{t('Return Home')}</Button></span></Tooltip>
      <Tooltip title={reason}><span><Button variant="contained" color="success" disabled={!ready || !canResume || busy} onClick={() => onRecover('RESUME')}>{t('Continue operation')}</Button></span></Tooltip>
    </DialogActions>
  </Dialog>
}
