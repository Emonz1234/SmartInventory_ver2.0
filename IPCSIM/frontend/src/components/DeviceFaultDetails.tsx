import { Alert, Button, Stack, Typography } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'
import { t, useLanguage } from '../i18n'

export function deviceFaultSummary(health: any, language: string) {
  const vi = language === 'vi'
  const anyConnected = health.serial_connected && (health.simulation_states || []).some((state: any) => state.online)
  const reportedReasons = (health.fault_reasons || (health.simulation_states || [])
    .filter((state: any) => ['ERROR', 'RECOVERING', 'STOPPED', 'COMMUNICATION_LOST'].includes(state.system_state))
    .map((state: any) => ({ ...state.fault_context, cabinet_index: state.cabinet_index, system_state: state.system_state })))
  const reasons = reportedReasons.filter((fault: any) => !anyConnected || (fault.error_code || fault.system_state) !== 'COMMUNICATION_LOST')
  if (reportedReasons.length && !reasons.length && anyConnected) return ''
  return reasons.map((fault: any) => {
    const code = fault.error_code || fault.system_state || 'HARDWARE_FAULT'
    const names: Record<string, string> = {
      TRANSACTION_UNCERTAIN: vi ? 'Chưa xác định kết quả giao dịch; cần kiểm tra trước khi tiếp tục' : 'Transaction outcome uncertain; inspect before continuing',
      HARDWARE_FAULT: vi ? 'Thiết bị báo lỗi nhưng chưa cung cấp mã lỗi chi tiết' : 'Hardware fault reported without a specific fault code',
      RECOVERING: vi ? 'Đang chờ xác nhận phục hồi' : 'Awaiting recovery confirmation',
      STOPPED: vi ? 'Thao tác đã dừng' : 'Operation stopped',
      COMMUNICATION_LOST: vi ? 'Mất kết nối Simulation' : 'Simulation connection lost',
      OBSTRUCTED: vi ? 'Phát hiện vật cản' : 'Obstruction detected',
      SKEWED: vi ? 'Giá bị lệch' : 'Rack skew detected',
      MOTOR_OVERLOAD: vi ? 'Động cơ quá tải' : 'Motor overload',
    }
    const rack = fault.rack_id || fault.moving_rack_id
    const position = [fault.cabinet_index ? `Cabinet ${fault.cabinet_index}` : '', rack ? `Rack ${(Number(rack)-1)%6+1}` : ''].filter(Boolean).join(' / ')
    const recovery = fault.cleared ? (vi ? ' · Lỗi đã clear, chờ xác nhận phục hồi' : ' · Fault cleared, awaiting recovery confirmation') : ''
    return `${position ? position + ': ' : ''}${names[code] || t(code)} (${code})${recovery}${fault.current_step ? ' · ' + fault.current_step : ''}`
  }).join('\n') || (vi ? 'Chưa nhận được nguyên nhân chi tiết; kiểm tra trang Sự cố và Hoạt động thiết bị.' : 'No detailed reason received; inspect Faults and Device activity.')
}

export function DeviceFaultDetails({ health }: { health: any }) {
  const language = useLanguage()
  const summary = deviceFaultSummary(health, language)
  if (health.hardware_status !== 'FAULT' || !summary) return null
  return <Alert severity="warning" sx={{ mb: 2 }}><Stack spacing={1}>
    <Typography variant="body2" sx={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{summary}</Typography>
    <Button component={RouterLink} to="/breakdown" size="small" color="inherit" sx={{ alignSelf: 'flex-start' }}>{t('Sự cố & phục hồi')}</Button>
  </Stack></Alert>
}
