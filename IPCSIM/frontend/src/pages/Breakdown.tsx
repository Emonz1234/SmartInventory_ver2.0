import { useRef, useState } from 'react'
import { Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  Grid, MenuItem, Skeleton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TablePagination, TextField, Typography } from '@mui/material'
import { CheckCircleOutline, HelpOutline, Refresh, ReportProblemOutlined, WarningAmberOutlined } from '@mui/icons-material'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import api from '@api/client'
import { PageHeader } from '@components/PageHeader'
import { useFaultOverview } from '@components/MaintenanceNotice'
import { t, errorText, useLanguage, getLanguage } from '../i18n'

const location = (row: any) => `${t('Cabinet')} ${String(row.cabinet_index).padStart(2, '0')} / Rack ${String(row.rack_index).padStart(2, '0')}`
const date = (value: number | null) => value == null ? '—' : new Date(value * 1000).toLocaleString(getLanguage() === 'vi' ? 'vi-VN' : 'en-GB', { timeZone:'Asia/Ho_Chi_Minh' })
const duration = (seconds: number) => `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`
const severityColor = (severity: string) => severity === 'CRITICAL' || severity === 'ERROR' ? 'error' : severity === 'WARNING' ? 'warning' : 'info'
const statusColor = (status: string) => status.includes('ACTIVE') ? 'error' : status.includes('MAINTENANCE') || status.includes('INSPECTION') ? 'warning' : status === 'UNKNOWN' ? 'default' : 'success'

export const Breakdown = ({ session, onSessionExpired }: { session: string; onSessionExpired: () => void }) => {
  useLanguage()
  const client = useQueryClient()
  const [cabinet, setCabinet] = useState(''), [rack, setRack] = useState(''), [severity, setSeverity] = useState('')
  const [status, setStatus] = useState(''), [hours, setHours] = useState(24), [search, setSearch] = useState(''), [page, setPage] = useState(0)
  const [selected, setSelected] = useState<any>(null), [acknowledging, setAcknowledging] = useState<number | null>(null)
  const [error, setError] = useState<any>('')
  const inFlight = useRef(false)
  const query = useFaultOverview({ cabinet: cabinet || undefined, rack: rack || undefined, severity: severity || undefined,
    status: status || undefined, hours, search, offset: page * 25, limit: 25 })
  const data = query.data || {}, summary = data.summary || {}
  const racks: any[] = data.racks || [], active: any[] = data.active_faults || [], warnings: any[] = data.maintenance_warnings || []
  const cabinetIds = [...new Set<number>(racks.map(row => row.cabinet_index))].sort((a,b) => a-b)
  const shownCabinet = cabinet ? Number(cabinet) : cabinetIds[0]
  const safety = query.isError || !data.summary ? 'UNKNOWN' : summary.safety_status
  const tone = safety.includes('ACTIVE') ? 'error' : safety.includes('MAINTENANCE') || safety.includes('RECOVERY') ? 'warning' : safety === 'UNKNOWN' ? 'default' : 'success'
  const Icon = tone === 'error' ? ReportProblemOutlined : tone === 'warning' ? WarningAmberOutlined : tone === 'default' ? HelpOutline : CheckCircleOutline
  const detail = useQuery({ queryKey:['fault-detail',selected?.id], enabled:!!selected,
    queryFn:async () => (await api.get(`/faults/${selected.id}`)).data, refetchInterval:5000 })
  const selectedLive = detail.data || selected && [...active, ...(data.history || [])].find(row => row.id === selected.id) || selected
  const change = (setter: (value: any) => void, value: any) => { setter(value); setPage(0) }
  const acknowledge = async (warning: any) => {
    if (inFlight.current) return
    inFlight.current = true; setAcknowledging(warning.address); setError('')
    try {
      await api.post('/operator/maintenance/acknowledge', { address: warning.address, occurrence_id: warning.latest_occurrence_id }, { headers: { 'X-Operator-Session': session } })
      await client.invalidateQueries({ queryKey: ['fault-overview'] })
    } catch (failure: any) {
      if (failure?.response?.status === 403) onSessionExpired()
      setError(failure)
    } finally { inFlight.current = false; setAcknowledging(null) }
  }
  const select = (label: string, value: string | number, setter: (value:any)=>void, options: [string | number,string][]) =>
    <TextField select size="small" label={t(label)} value={value} SelectProps={{ displayEmpty:true }} InputLabelProps={{ shrink:true }} onChange={event => change(setter,event.target.value)} sx={{ minWidth: 155 }}>
      {options.map(([key,text]) => <MenuItem key={key} value={key}>{text}</MenuItem>)}
    </TextField>
  return <Stack spacing={2}>
    <PageHeader title={t('Faults & maintenance')} description={t('Current safety, active faults and racks requiring inspection.')} action={<Button variant="outlined" startIcon={<Refresh />} disabled={query.isFetching} onClick={() => void query.refetch()}>{t('Refresh')}</Button>} />
    <Card data-testid="fault-safety" sx={{ borderLeft: '6px solid', borderLeftColor: tone === 'default' ? 'grey.500' : `${tone}.main` }}><CardContent>
      <Stack direction="row" alignItems="center" spacing={1.5}><Icon color={tone === 'default' ? 'disabled' : tone} sx={{ fontSize: 36 }} /><Box>
        <Typography variant="h6" fontWeight={750}>{t(safety)}</Typography><Typography variant="body2" color="text.secondary">{t(safety === 'UNKNOWN' ? 'Some devices are offline or have no current data. Safety cannot be confirmed.' : active.length ? 'Operation blocked until fault is cleared' : warnings.length ? 'Inspection is recommended. A maintenance warning does not automatically block operations.' : 'No active device faults detected.')}</Typography>
      </Box></Stack>
      <Grid container spacing={2} sx={{ mt: 0.5 }}>{[
        [t('Active faults'), summary.active_faults], [t('Warning racks'), summary.warning_racks], [t('Faults in last 24 hours'), summary.faults_24h],
        [t('Most affected rack'), summary.most_affected_rack ? `${location(summary.most_affected_rack)} · ${summary.most_affected_rack.count}` : '—']
      ].map(([label,value]) => <Grid item xs={6} md={3} key={String(label)}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography fontWeight={750}>{query.isError ? '—' : value ?? '—'}</Typography></Grid>)}</Grid>
    </CardContent></Card>
    {query.isError && <Alert severity="error">{t('Fault data could not be loaded. Refresh to confirm current safety.')}</Alert>}
    {!!data.recovery_pending?.length && <Alert severity="warning"><Stack spacing={0.5}>
      <span>{t('Faults cleared. The operation remains paused until the operator confirms recovery.')}</span>
      {data.recovery_pending.map((entry:any) => entry.cabinet_id ? <Link key={entry.cabinet_index} to={`/cabinets/${entry.cabinet_id}`}>{t('Inspect cabinet')} {entry.cabinet_index}</Link> : <span key={entry.cabinet_index}>{t('Cabinet')} {entry.cabinet_index}</span>)}
    </Stack></Alert>}
    {query.isLoading && <Skeleton height={150} />}
    <Box><Typography variant="h6" fontWeight={750} sx={{ mb:1 }}>{t('Active faults')}</Typography>
      {!active.length && !query.isError && !query.isLoading && <Alert severity={safety === 'UNKNOWN' ? 'info' : 'success'}>{t(safety === 'UNKNOWN' ? 'No recorded active faults. Connection status remains unknown.' : 'No active device faults detected.')}</Alert>}
      <Grid container spacing={1.5}>{active.map(fault => <Grid item xs={12} md={6} key={fault.id}><Card data-testid="active-fault" sx={{ borderColor:'error.main', bgcolor:'#fff7f6' }}><CardContent><Stack spacing={1}>
        <Stack direction="row" spacing={1} alignItems="center"><ReportProblemOutlined color="error" /><Chip size="small" color={severityColor(fault.severity)} label={t(fault.severity)} /><Typography fontWeight={750}>{location(fault)}</Typography></Stack>
        <Typography fontWeight={650}>{t(fault.description)}</Typography><Typography variant="caption">{fault.codes.join(' · ')}</Typography>
        <Typography variant="body2">{t('Detected')}: {date(fault.detected_at)} · {t('ACTIVE')}</Typography>
        {fault.transaction_id && <Typography variant="body2" sx={{ overflowWrap:'anywhere' }}>{t('Related transaction')}: {fault.transaction_id}</Typography>}
        {!fault.online && <Chip size="small" label={t('Communication status unknown')} />}
        <Typography color="error" variant="body2">{t('Operation blocked until fault is cleared')}</Typography>
        <Stack direction="row" spacing={1}><Button onClick={() => setSelected(fault)}>{t('Details')}</Button>{fault.cabinet_id && <Button component={Link} to={`/cabinets/${fault.cabinet_id}`}>{t('Inspect cabinet')}</Button>}</Stack>
      </Stack></CardContent></Card></Grid>)}</Grid>
    </Box>
    <Box><Typography variant="h6" fontWeight={750} sx={{ mb:1 }}>{t('Maintenance Attention')}</Typography>
      {!warnings.length && !query.isLoading && !query.isError && <Typography variant="body2" color="text.secondary">{t('No repeated-fault warnings in the configured window.')}</Typography>}
      <Grid container spacing={1.5}>{warnings.map(warning => <Grid item xs={12} md={6} key={warning.address}><Card data-testid="maintenance-warning" sx={{ borderColor:warning.maintenance_status === 'ACKNOWLEDGED' ? 'divider' : 'warning.main' }}><CardContent><Stack spacing={1}>
        <Stack direction="row" spacing={1} alignItems="center"><WarningAmberOutlined color="warning" /><Typography fontWeight={750}>{location(warning)}</Typography><Chip size="small" color="warning" label={t(warning.maintenance_status)} /></Stack>
        <Typography>{t('{0} faults in the last {1} minutes',warning.count,warning.window_minutes)}</Typography>
        <Typography variant="body2">{t(warning.active_fault ? 'Active fault' : 'No active fault')} · {t('Last fault')}: {t(warning.last_fault)} · {date(warning.last_detected_at)}</Typography>
        <Typography variant="body2">{t('Most frequent code')}: {warning.common_code}{warning.same_fault_repeated ? ` · ${t('Repeated same fault detected')}` : ''}</Typography>
        <Typography variant="body2" color="text.secondary">{t('Inspect sensors, mechanism and wiring before continued intensive operation.')}</Typography>
        {warning.acknowledgement && <Typography variant="caption">{t('Seen by')} {warning.acknowledgement.username} · {date(warning.acknowledgement.acknowledged_at)} — {t('Acknowledgement does not mean maintenance is complete.')}</Typography>}
        <Button variant="outlined" disabled={acknowledging != null || warning.maintenance_status === 'ACKNOWLEDGED'} onClick={() => void acknowledge(warning)}>{t('Acknowledge Maintenance Warning')}</Button>
      </Stack></CardContent></Card></Grid>)}</Grid>{error && <Alert severity="error" sx={{ mt:1 }}>{errorText(error)}</Alert>}
    </Box>
    <Card><CardContent><Stack spacing={1.5}><Typography variant="h6" fontWeight={750}>{t('Cabinet / Rack safety')}</Typography>
      {select('Cabinet',cabinet,value => {setCabinet(value);setRack('')},[['',t('All cabinets')],...cabinetIds.map(id => [String(id),`${t('Cabinet')} ${id}`] as [string,string])])}
      <Typography variant="caption">{t('Cabinet')} {shownCabinet ?? '—'}</Typography>
      <Grid container spacing={1}>{racks.filter(row => row.cabinet_index === shownCabinet).map(row => <Grid item xs={6} sm={2} key={row.address}><Box data-testid={`fault-rack-${row.address}`} sx={{ p:1.5, border:'1px solid', borderColor:statusColor(row.safety_status) === 'default' ? 'grey.400' : `${statusColor(row.safety_status)}.main`, borderRadius:2 }}>
        <Typography fontWeight={750}>R{row.rack_index}</Typography><Chip icon={row.safety_status === 'NORMAL' ? <CheckCircleOutline /> : row.safety_status === 'UNKNOWN' ? <HelpOutline /> : <WarningAmberOutlined />} size="small" color={statusColor(row.safety_status)} label={t(row.safety_status)} sx={{ height:'auto', '& .MuiChip-label':{whiteSpace:'normal'} }} />
      </Box></Grid>)}</Grid>
    </Stack></CardContent></Card>
    <Card><CardContent><Stack spacing={1.5}><Typography variant="h6" fontWeight={750}>{t('Fault history')}</Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {select('Rack',rack,setRack,[['',t('All racks')],...racks.filter(row => !cabinet || row.cabinet_index === Number(cabinet)).map(row => [String(row.address),location(row)] as [string,string])])}
        {select('Severity',severity,setSeverity,[['',t('All severities')],...['INFO','WARNING','ERROR','CRITICAL'].map(value => [value,t(value)] as [string,string])])}
        {select('Status',status,setStatus,[['',t('All statuses')],...['ACTIVE','RESOLVED'].map(value => [value,t(value)] as [string,string])])}
        {select('Time range',hours,value => setHours(Number(value)),[1,24,168,720].map(value => [value,t('Last {0} hours',value)]))}
        <TextField size="small" label={t('Search error code')} value={search} onChange={event => change(setSearch,event.target.value)} />
        <Button onClick={() => {setCabinet('');setRack('');setSeverity('');setStatus('');setHours(24);setSearch('');setPage(0)}}>{t('Clear filters')}</Button>
      </Stack>
      <TableContainer sx={{ maxHeight:350 }}><Table stickyHeader size="small" aria-label={t('Fault history')}><TableHead><TableRow>{['Time','Severity','Cabinet / Rack','Fault','Status','Duration','Details'].map(label => <TableCell key={label}>{t(label)}</TableCell>)}</TableRow></TableHead><TableBody>
        {(data.history || []).map((fault:any) => <TableRow hover key={fault.id}><TableCell>{date(fault.detected_at)}</TableCell><TableCell><Chip size="small" label={t(fault.severity)} color={severityColor(fault.severity)} /></TableCell><TableCell>{location(fault)}</TableCell><TableCell><Typography variant="body2">{t(fault.description)}</Typography><Typography variant="caption">{fault.error_code}</Typography></TableCell><TableCell><Chip size="small" label={t(fault.status)} color={fault.status === 'ACTIVE' ? 'error' : 'success'} variant="outlined" /></TableCell><TableCell>{duration(fault.duration_seconds)}</TableCell><TableCell><Button size="small" onClick={() => setSelected(fault)}>{t('Details')}</Button></TableCell></TableRow>)}
        {!data.history?.length && <TableRow><TableCell colSpan={7}>{t('No matching fault occurrences.')}</TableCell></TableRow>}
      </TableBody></Table></TableContainer><TablePagination component="div" count={data.history_total || 0} page={page} rowsPerPage={25} rowsPerPageOptions={[25]} onPageChange={(_,value) => setPage(value)} />
    </Stack></CardContent></Card>
    <Dialog open={!!selectedLive} onClose={() => setSelected(null)} maxWidth="sm" fullWidth aria-labelledby="fault-details-title"><DialogTitle id="fault-details-title">{t('Fault details')}</DialogTitle><DialogContent><Stack spacing={1.5}>
      {detail.isError && <Alert severity="warning">{t('Fault data could not be loaded. Refresh to confirm current safety.')}</Alert>}
      {selectedLive && <><Typography fontWeight={750}>{location(selectedLive)} · {t(selectedLive.description)}</Typography><Chip label={`${t(selectedLive.severity)} · ${t(selectedLive.status)}`} color={severityColor(selectedLive.severity)} />
        {[[t('Fault ID'),selectedLive.id],[t('Error code'),selectedLive.codes.join(' · ')],[t('First detected'),date(selectedLive.detected_at)],[t('Resolved time'),date(selectedLive.resolved_at)],[t('Duration'),duration(selectedLive.duration_seconds)],[t('Related transaction'),selectedLive.transaction_id || '—'],[t('Snapshot sequence'),selectedLive.context.sequence ?? '—'],[t('Current step'),selectedLive.context.current_step ? JSON.stringify(selectedLive.context.current_step) : '—'],[t('Recent faults on rack'),selectedLive.recent_fault_count]].map(([label,value]) => <Box key={String(label)} sx={{ overflowWrap:'anywhere' }}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography variant="body2">{value}</Typography></Box>)}
        {selectedLive.recent_fault_count >= data.config?.threshold && <Alert severity="warning">{t('Repeated failures detected on this Rack. Maintenance inspection is recommended.')}</Alert>}
      </>}
    </Stack></DialogContent><DialogActions><Button onClick={() => setSelected(null)}>{t('Close')}</Button></DialogActions></Dialog>
    <Typography variant="caption" color="text.secondary">{t('Repeated-fault policy: {0} occurrences per rack within {1} minutes.',data.config?.threshold ?? '—',data.config?.window_minutes ?? '—')} {t('Communication loss is not counted as a device fault.')}</Typography>
  </Stack>
}
