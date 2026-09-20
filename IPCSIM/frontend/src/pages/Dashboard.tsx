import { useEffect } from 'react'
import { Grid, Card, CardContent, Typography, Box, Chip, Stack, Divider, Skeleton, Alert, Button } from '@mui/material'
import { useSystemStore } from '@store/systemStore'
import { Circle, Storage, Inventory2, WarningAmber, Thermostat, Opacity, Scale, Wifi, ArrowForward } from '@mui/icons-material'
import { useQuery } from '@tanstack/react-query'
import { dashboardAPI } from '@api/dashboard'
import { formatDateTime } from '@utils/date'
import { Link as RouterLink } from 'react-router-dom'

const normalizeSmokeValue = (value: any) => {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'number') return value === 0 ? 0 : 1

  const normalized = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'có', 'co', 'alert', 'detected', 'on'].includes(normalized)) return 1
  if (['0', 'false', 'no', 'không', 'khong', 'ok', 'safe', 'off', 'none'].includes(normalized)) return 0
  return null
}

const MetricCard = ({ icon, label, value, detail, accent }: any) => (
  <Card sx={{ height: '100%', borderTop: '3px solid', borderColor: accent }}>
    <CardContent>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
        <Box>
          <Typography variant="body2" color="text.secondary">{label}</Typography>
          <Typography variant="h4" sx={{ fontWeight: 'bold', mt: 0.75 }}>{value}</Typography>
          <Typography variant="caption" color="text.secondary">{detail}</Typography>
        </Box>
        <Box sx={{ color: accent, bgcolor: `${accent}16`, p: 1.25, borderRadius: 2, display: 'flex' }}>{icon}</Box>
      </Stack>
    </CardContent>
  </Card>
)

const HealthRow = ({ label, value, good }: { label: string; value: string; good: boolean }) => (
  <Stack direction="row" justifyContent="space-between" alignItems="center">
    <Stack direction="row" spacing={1} alignItems="center">
      <Circle sx={{ fontSize: 9, color: good ? 'success.main' : 'error.main' }} />
      <Typography variant="body2">{label}</Typography>
    </Stack>
    <Typography variant="body2" color={good ? 'success.main' : 'error.main'} sx={{ fontWeight: 'bold' }}>{value}</Typography>
  </Stack>
)

export const Dashboard = () => {
  const status = useSystemStore((s) => s.status)
  const updateStatus = useSystemStore((s) => s.updateStatus)

  const q = useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: async () => {
      const resp = await dashboardAPI.getSummary()
      return resp.data
    },
    refetchInterval: 2000
  })

  const data: any = q.data
  const smokeValue = normalizeSmokeValue(data?.environment_summary?.smoke_detected ?? data?.environment_summary?.smoke)
  const cabinetStatus = data?.cabinet_status
  const environment = data?.environment_summary
  const systemStatus = data?.system_status ?? status

  useEffect(() => {
    if (!data?.system_status) return
    updateStatus({
      serial_connected: data.system_status.serial_connected,
      simulation_online: data.system_status.simulation_online,
      database_healthy: data.system_status.database_healthy,
      server_synced: data.system_status.server_synced
    })
  }, [data, updateStatus])

  return (
    <Box>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'center' }} sx={{ mb: 3 }} spacing={1}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold', letterSpacing: '-0.02em' }}>Operations dashboard</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>Live overview of inventory, cabinets and device health.</Typography>
        </Box>
        <Chip icon={<Circle sx={{ fontSize: '10px !important' }} />} label="Auto-refresh: 5s" color="info" variant="outlined" />
      </Stack>

      {q.isError && <Alert severity="error" sx={{ mb: 2 }}>Unable to load live dashboard data.</Alert>}
      {q.isLoading ? <Grid container spacing={2}>{Array.from({ length: 6 }).map((_, index) => <Grid item xs={12} sm={6} md={4} key={index}><Skeleton variant="rounded" height={140} /></Grid>)}</Grid> : (
        <>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={12} sm={6} md={3}><MetricCard icon={<Storage />} label="Active cabinets" value={`${cabinetStatus?.active_cabinets ?? 0}/${cabinetStatus?.total_cabinets ?? 0}`} detail={`${cabinetStatus?.inactive_cabinets ?? 0} inactive groups`} accent="#16846b" /></Grid>
            <Grid item xs={12} sm={6} md={3}><MetricCard icon={<Inventory2 />} label="Inventory stock" value={data?.inventory_summary?.total_stock ?? '--'} detail={`${data?.inventory_summary?.total_items ?? 0} item types`} accent="#0077a3" /></Grid>
            <Grid item xs={12} sm={6} md={3}><MetricCard icon={<WarningAmber />} label="Low stock alerts" value={data?.inventory_summary?.low_stock_count ?? 0} detail="Items below minimum" accent="#d97706" /></Grid>
            <Grid item xs={12} sm={6} md={3}><MetricCard icon={<Storage />} label="Active racks" value={`${cabinetStatus?.active_racks ?? 0}/${cabinetStatus?.total_racks ?? 0}`} detail="Racks sending telemetry" accent="#7c3aed" /></Grid>
          </Grid>

          <Grid container spacing={2}>
            <Grid item xs={12} md={5}>
              <Card sx={{ height: '100%' }}>
                <CardContent>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                    <Typography variant="h6" sx={{ fontWeight: 'bold' }}>Device health</Typography>
                    <Wifi color={systemStatus.simulation_online ? 'success' : 'error'} />
                  </Stack>
                  <Stack spacing={1.75}>
                    <HealthRow label="Serial connection" value={systemStatus.serial_connected ? 'Connected' : 'Offline'} good={systemStatus.serial_connected} />
                    <HealthRow label="Serial telemetry source" value={systemStatus.serial_connected ? 'Connected' : 'Offline / not configured'} good={systemStatus.serial_connected} />
                    <HealthRow label="Database" value={systemStatus.database_healthy ? 'Healthy' : 'Error'} good={systemStatus.database_healthy} />
                    <HealthRow label="Server sync" value={systemStatus.server_synced ? 'Synced' : 'Offline'} good={systemStatus.server_synced} />
                  </Stack>
                  <Divider sx={{ my: 2 }} />
                  <Typography variant="caption" color="text.secondary">Active groups are based on telemetry received within the last 15 seconds.</Typography>
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} md={4}>
              <Card sx={{ height: '100%' }}>
                <CardContent>
                  <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>Environment snapshot</Typography>
                  <Stack spacing={2}>
                    <Stack direction="row" spacing={1.5} alignItems="center"><Thermostat color="error" /><Box><Typography variant="caption" color="text.secondary">Temperature</Typography><Typography variant="h6">{environment?.temperature != null ? `${environment.temperature}°C` : '--'}</Typography></Box></Stack>
                    <Stack direction="row" spacing={1.5} alignItems="center"><Opacity color="info" /><Box><Typography variant="caption" color="text.secondary">Humidity</Typography><Typography variant="h6">{environment?.humidity != null ? `${environment.humidity}%` : '--'}</Typography></Box></Stack>
                    <Stack direction="row" spacing={1.5} alignItems="center"><Scale color="success" /><Box><Typography variant="caption" color="text.secondary">Weight</Typography><Typography variant="h6">{environment?.weight != null ? `${environment.weight} kg` : '--'}</Typography></Box></Stack>
                  </Stack>
                  <Chip sx={{ mt: 2 }} size="small" label={smokeValue === 1 ? 'Smoke alert' : smokeValue === 0 ? 'Smoke clear' : 'Smoke unknown'} color={smokeValue === 1 ? 'error' : smokeValue === 0 ? 'success' : 'default'} />
                  <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 1 }}>Updated: {formatDateTime(environment?.last_updated)}</Typography>
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} md={3}>
              <Card sx={{ height: '100%' }}>
                <CardContent>
                  <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>Active groups</Typography>
                  {cabinetStatus?.active_groups?.length ? <Stack spacing={1.5}>{cabinetStatus.active_groups.map((cabinet: any) => <Stack key={cabinet.id} direction="row" justifyContent="space-between" alignItems="center"><Box><Typography variant="body2" sx={{ fontWeight: 'bold' }}>{cabinet.name}</Typography><Typography variant="caption" color="text.secondary">{cabinet.code}</Typography></Box><Chip label="Active" size="small" color="success" /></Stack>)}</Stack> : <Typography variant="body2" color="text.secondary">No cabinet group is currently active.</Typography>}
                  <Button component={RouterLink} to="/cabinets" endIcon={<ArrowForward />} size="small" sx={{ mt: 2, px: 0 }}>View cabinets</Button>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </>
      )}
    </Box>
  )
}
