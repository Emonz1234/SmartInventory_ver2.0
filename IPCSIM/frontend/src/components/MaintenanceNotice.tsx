import { Alert, Stack } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import api from '@api/client'
import { t, useLanguage } from '../i18n'

export function useFaultOverview(filters: Record<string, any> = {}) {
  return useQuery<any>({ queryKey: ['fault-overview', filters], queryFn: async () =>
    (await api.get('/faults/overview', { params: filters })).data, refetchInterval: 5000, retry: false })
}

export function MaintenanceNotice({ cabinetIndex }: { cabinetIndex?: number }) {
  useLanguage()
  const query = useFaultOverview()
  const warnings = (query.data?.maintenance_warnings || []).filter((warning: any) =>
    cabinetIndex == null || warning.cabinet_index === cabinetIndex)
  if (!warnings.length) return null
  return <Alert severity="warning" sx={{ mb: 2 }}><Stack spacing={0.5}>
    {warnings.map((warning: any) => <span key={warning.address}>
      {t('Cabinet')} {warning.cabinet_index} / Rack {warning.rack_index} — {t('Maintenance attention')}
      {warning.maintenance_status === 'ACKNOWLEDGED' ? ` · ${t('ACKNOWLEDGED')}` : ''}
    </span>)}
    <Link to="/breakdown">{t('Review maintenance warnings')}</Link>
  </Stack></Alert>
}
