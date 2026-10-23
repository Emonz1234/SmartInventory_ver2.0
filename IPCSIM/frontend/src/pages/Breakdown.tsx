import { TablePageMenu, useTablePage } from '@components/TablePageMenu'
import { useRef, useState } from 'react'
import { Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  Tabs, Tab, MenuItem, Skeleton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField, Typography } from '@mui/material'
import { CheckCircleOutline, HelpOutline, Refresh, ReportProblemOutlined, WarningAmberOutlined } from '@mui/icons-material'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import api from '@api/client'
import { PageHeader } from '@components/PageHeader'
import { useFaultOverview } from '@components/MaintenanceNotice'
import { t, errorText, useLanguage, getLanguage } from '../i18n'

const location = (row: any) => `${t('Cabinet')} ${String(row.cabinet_index).padStart(2, '0')} · Rack ${String(row.rack_index).padStart(2, '0')}`
const locationLabel = (row: any) => <><Box component="span" sx={{ whiteSpace:'nowrap' }}>{t('Cabinet')} {String(row.cabinet_index).padStart(2, '0')}</Box>{' \u00b7 '}<Box component="span" sx={{ whiteSpace:'nowrap' }}>Rack {String(row.rack_index).padStart(2, '0')}</Box></>
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
  const [tab, setTab] = useState(0)
  const [maintenance, setMaintenance] = useState<any>(null)
  const [error, setError] = useState<any>('')
  const [historyRows, setHistoryRows] = useState(5)
  const inFlight = useRef(false)
  const query = useFaultOverview({ cabinet: cabinet || undefined, rack: rack || undefined, severity: severity || undefined,
    status: status || undefined, hours, search, offset: page * historyRows, limit: historyRows })
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
  const resolved = useFaultOverview({status:'RESOLVED',hours:24,limit:1})
  const matches = (row:any) => (!cabinet || row.cabinet_index === Number(cabinet)) && (!search || `${location(row)} ${row.description || ''} ${(row.codes || []).join(' ')} ${row.common_code || ''}`.toLowerCase().includes(search.toLowerCase()))
  const visibleWarnings = warnings.filter(matches).sort((a,b) => Number(b.active_fault)-Number(a.active_fault) || b.count-a.count || b.last_detected_at-a.last_detected_at)

  const maintenancePaging = useTablePage(visibleWarnings.length, JSON.stringify([cabinet,search]))
  const maintenanceLive = warnings.find(row => row.address === maintenance?.address) || maintenance
  const readableUi = {
    '& .MuiTypography-body2': { fontSize:15, lineHeight:1.5 },
    '& .MuiTypography-caption': { fontSize:14, lineHeight:1.5 },
    '& .MuiChip-root': { fontSize:13, minHeight:28 },
    '& .MuiButton-root': { fontSize:14, whiteSpace:'nowrap', minWidth:0, minHeight:36 },
    '& .MuiTableCell-root': { fontSize:15, lineHeight:1.5 },
    '& .MuiTableCell-head': { fontSize:14, fontWeight:700 },
  }
  return <Stack spacing={1.75} sx={readableUi}>
    <Box sx={{'& .MuiTypography-overline':{display:'none'},'& h4':{fontSize:28},'& .MuiStack-root':{mb:0}}}><PageHeader title={t('Faults & maintenance')} description={t('Current safety, active faults and racks requiring inspection.')} action={<Button variant="outlined" startIcon={<Refresh />} disabled={query.isFetching} onClick={() => void Promise.all([query.refetch(),resolved.refetch()])}>{t('Refresh')}</Button>} /></Box>
    <Stack data-testid="fault-safety" direction="row" spacing={1} alignItems="center"><Icon color={tone === 'default' ? 'disabled' : tone} fontSize="small" /><Typography variant="body2" fontWeight={750}>{t(safety)}</Typography></Stack>
    <Box sx={{display:'grid',gridTemplateColumns:{xs:'repeat(2,1fr)',sm:'repeat(5,1fr)'},gap:1}}>{[[t('Active faults'),summary.active_faults],[t('CRITICAL'),active.filter(row => row.severity === 'CRITICAL').length],[t('WARNING'),active.filter(row => row.severity === 'WARNING').length],[`${t('RESOLVED')} · 24h`,resolved.isError ? null : resolved.data?.history_total],[t('Warning racks'),summary.warning_racks]].map(([label,value]) => <Card key={String(label)}><Box sx={{px:2,py:1.25}}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography fontSize={28} fontWeight={750}>{query.isError || query.isLoading || value == null ? '—' : value}</Typography></Box></Card>)}</Box>
    {query.isError && <Alert severity="error">{t('Fault data could not be loaded. Refresh to confirm current safety.')}</Alert>}
    {!!data.recovery_pending?.length && <Alert severity="warning"><Stack spacing={0.5}>
      <span>{t('Faults cleared. The operation remains paused until the operator confirms recovery.')}</span>
      {data.recovery_pending.map((entry:any) => entry.cabinet_id ? <Link key={entry.cabinet_index} to={`/cabinets/${entry.cabinet_id}`}>{t('Inspect cabinet')} {entry.cabinet_index}</Link> : <span key={entry.cabinet_index}>{t('Cabinet')} {entry.cabinet_index}</span>)}
    </Stack></Alert>}
    {query.isLoading && <Skeleton height={40} />}
    <Stack direction={{xs:'column',sm:'row'}} spacing={1} flexWrap="wrap" useFlexGap>
      <Tabs variant="scrollable" scrollButtons="auto" value={tab} onChange={(_,value) => {setTab(value);setPage(0)}} sx={{minHeight:44,'& .MuiTab-root':{minHeight:44,py:1,fontSize:14}}}><Tab label={t('Fault history')} /><Tab label={t('Maintenance Attention')} /></Tabs>
      {select('Cabinet',cabinet,value => {setCabinet(value);setRack('')},[['',t('All cabinets')],...cabinetIds.map(id => [String(id),`${t('Cabinet')} ${id}`] as [string,string])])}
      {tab === 1 && <TextField size="small" label={t('Search error code')} value={search} onChange={e => {setSearch(e.target.value)}} sx={{flex:1}} />}
    </Stack>
    {tab === 1 && <Box sx={{display:'grid',gridTemplateColumns:'minmax(0,1fr)',gap:1.75,alignItems:'start'}}>
      {tab === 1 && <Card sx={{minWidth:0}}><Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap spacing={1} sx={{p:1.5}}><Box><Typography fontWeight={750}>{t('Maintenance Attention')} · {visibleWarnings.length}</Typography><Typography variant="caption" color="text.secondary">{t('Repeated-fault policy: {0} occurrences per rack within {1} minutes.',data.config?.threshold ?? '—',data.config?.window_minutes ?? '—')}</Typography></Box><TablePageMenu {...maintenancePaging.controls} /></Stack><TableContainer><Table stickyHeader size="small" aria-label={t('Maintenance Attention')} sx={{'& td, & th':{px:1.25,py:1.25}}}><TableHead><TableRow>{['Cabinet / Rack','Recent faults on rack','Details'].map(label => <TableCell key={label}>{t(label)}</TableCell>)}</TableRow></TableHead><TableBody>
        {maintenancePaging.slice(visibleWarnings).map(warning => <TableRow hover key={warning.address} data-testid="maintenance-warning"><TableCell><Typography variant="body2" fontWeight={750}>{locationLabel(warning)}</Typography><Chip size="small" variant="outlined" color="warning" label={t(warning.maintenance_status)} sx={{height:'auto','& .MuiChip-label':{whiteSpace:'normal'}}} /></TableCell><TableCell><Typography variant="body2">{t('{0} faults in the last {1} minutes',warning.count,warning.window_minutes)}</Typography><Typography variant="caption" color="text.secondary">{t('Last fault')}: {date(warning.last_detected_at)}</Typography></TableCell><TableCell><Button size="small" onClick={() => setMaintenance(warning)}>{t('Details')}</Button></TableCell></TableRow>)}
        {!visibleWarnings.length && <TableRow><TableCell colSpan={3}>{t(query.isError ? 'Fault data could not be loaded. Refresh to confirm current safety.' : query.isLoading ? 'Waiting for Simulation snapshot' : 'No repeated-fault warnings in the configured window.')}</TableCell></TableRow>}
      </TableBody></Table></TableContainer></Card>}
    </Box>}
    {tab === 0 && <>
    <Card><CardContent><Stack spacing={1.5}><Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap spacing={1}><Typography variant="h6" fontWeight={750}>{t('Fault history')}</Typography><TablePageMenu count={data.history_total || 0} page={Math.min(page, Math.max(0, Math.ceil((data.history_total || 0) / historyRows) - 1))} rowsPerPage={historyRows} onPageChange={(_,value) => setPage(value)} onRowsPerPageChange={event => {setHistoryRows(Number(event.target.value));setPage(0)}} /></Stack>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {select('Rack',rack,setRack,[['',t('All racks')],...racks.filter(row => !cabinet || row.cabinet_index === Number(cabinet)).map(row => [String(row.address),location(row)] as [string,string])])}
        {select('Severity',severity,setSeverity,[['',t('All severities')],...['INFO','WARNING','ERROR','CRITICAL'].map(value => [value,t(value)] as [string,string])])}
        <Button size="small" variant={status === 'RESOLVED' ? 'contained' : 'outlined'} onClick={() => change(setStatus,status === 'RESOLVED' ? '' : 'RESOLVED')}>{t('RESOLVED')}</Button>
        {select('Status',status,setStatus,[['',t('All statuses')],...['ACTIVE','RESOLVED'].map(value => [value,t(value)] as [string,string])])}
        {select('Time range',hours,value => setHours(Number(value)),[1,24,168,720].map(value => [value,t('Last {0} hours',value)]))}
        <TextField size="small" label={t('Search error code')} value={search} onChange={event => change(setSearch,event.target.value)} />
        <Button onClick={() => {setCabinet('');setRack('');setSeverity('');setStatus('');setHours(24);setSearch('');setPage(0)}}>{t('Clear filters')}</Button>
      </Stack>
      <TableContainer><Table stickyHeader size="small" aria-label={t('Fault history')}><TableHead><TableRow>{['Time','Severity','Cabinet / Rack','Fault','Status','Duration','Details'].map(label => <TableCell key={label}>{t(label)}</TableCell>)}</TableRow></TableHead><TableBody>
        {(data.history || []).map((fault:any) => <TableRow hover key={fault.id} sx={{ opacity:fault.status === 'RESOLVED' ? 0.7 : 1 }}><TableCell>{date(fault.detected_at)}</TableCell><TableCell><Chip size="small" label={t(fault.severity)} color={severityColor(fault.severity)} /></TableCell><TableCell>{location(fault)}</TableCell><TableCell><Typography variant="body2">{t(fault.description)}</Typography><Typography variant="caption">{fault.error_code}</Typography></TableCell><TableCell><Chip size="small" label={t(fault.status)} color={fault.status === 'ACTIVE' ? 'error' : 'success'} variant="outlined" /></TableCell><TableCell>{duration(fault.duration_seconds)}</TableCell><TableCell><Button size="small" onClick={() => setSelected(fault)}>{t('Details')}</Button></TableCell></TableRow>)}
        {!data.history?.length && <TableRow><TableCell colSpan={7}>{t('No matching fault occurrences.')}</TableCell></TableRow>}
      </TableBody></Table></TableContainer>
    </Stack></CardContent></Card>
    <Typography variant="caption">{t('Faults in last 24 hours')}: {summary.faults_24h ?? '—'} · {t('Most affected rack')}: {summary.most_affected_rack ? `${location(summary.most_affected_rack)} · ${summary.most_affected_rack.count}` : '—'}</Typography></>}
    <Box component="details"><Box component="summary" sx={{cursor:'pointer',fontSize:14,color:'text.secondary'}}>{t('Cabinet / Rack safety')}</Box><Stack direction="row" flexWrap="wrap" useFlexGap spacing={0.75} sx={{mt:1}}>{racks.filter(row => !cabinet || row.cabinet_index === shownCabinet).map(row => <Chip key={row.address} data-testid={`fault-rack-${row.address}`} size="small" variant="outlined" color={statusColor(row.safety_status)} label={`${location(row)} · ${t(row.safety_status)}`} />)}</Stack></Box>
    <Dialog sx={readableUi} open={!!maintenanceLive} onClose={() => setMaintenance(null)} maxWidth="sm" fullWidth><DialogTitle>{t('Maintenance Attention')}</DialogTitle><DialogContent>{maintenanceLive && <Stack spacing={1.5}>
      <Typography fontWeight={750}>{location(maintenanceLive)}</Typography><Chip size="small" color="warning" label={t(maintenanceLive.maintenance_status)} />
      <Typography>{t('{0} faults in the last {1} minutes',maintenanceLive.count,maintenanceLive.window_minutes)}</Typography><Typography variant="body2">{t(maintenanceLive.active_fault ? 'Active fault' : 'No active fault')} · {t('Last fault')}: {t(maintenanceLive.last_fault)} · {date(maintenanceLive.last_detected_at)}</Typography><Typography variant="body2">{t('Most frequent code')}: {maintenanceLive.common_code}{maintenanceLive.same_fault_repeated ? ` · ${t('Repeated same fault detected')}` : ''}</Typography><Alert severity="warning">{t('Inspect sensors, mechanism and wiring before continued intensive operation.')}</Alert>
      {maintenanceLive.acknowledgement && <Typography variant="caption">{t('Seen by')} {maintenanceLive.acknowledgement.username} · {date(maintenanceLive.acknowledgement.acknowledged_at)}</Typography>}<Typography variant="caption">{t('Acknowledgement does not mean maintenance is complete.')}</Typography>{error && <Alert severity="error">{errorText(error)}</Alert>}
    </Stack>}</DialogContent><DialogActions>{maintenanceLive?.cabinet_id && <Button component={Link} to={`/cabinets/${maintenanceLive.cabinet_id}`}>{t('Inspect cabinet')}</Button>}<Button disabled={acknowledging != null || !warnings.some(row => row.address === maintenanceLive?.address) || maintenanceLive?.maintenance_status === 'ACKNOWLEDGED'} onClick={() => void acknowledge(maintenanceLive)}>{t('Acknowledge Maintenance Warning')}</Button><Button onClick={() => setMaintenance(null)}>{t('Close')}</Button></DialogActions></Dialog>
    <Dialog sx={readableUi} open={!!selectedLive} onClose={() => setSelected(null)} maxWidth="sm" fullWidth aria-labelledby="fault-details-title"><DialogTitle id="fault-details-title">{t('Fault details')}</DialogTitle><DialogContent><Stack spacing={1.5}>
      {detail.isError && <Alert severity="warning">{t('Fault data could not be loaded. Refresh to confirm current safety.')}</Alert>}
      {selectedLive && <><Typography fontWeight={750}>{location(selectedLive)} · {t(selectedLive.description)}</Typography><Chip label={`${t(selectedLive.severity)} · ${t(selectedLive.status)}`} color={severityColor(selectedLive.severity)} />
        <Typography variant="body2" color="text.secondary">{t(selectedLive.online ? 'Online' : 'Communication status unknown')}</Typography>
        {[[t('Fault ID'),selectedLive.id],[t('Error code'),(selectedLive.codes || [selectedLive.error_code]).join(' · ')],[t('First detected'),date(selectedLive.detected_at)],[t('Resolved time'),date(selectedLive.resolved_at)],[t('Duration'),duration(selectedLive.duration_seconds)],[t('Related transaction'),selectedLive.transaction_id || '—'],[t('Snapshot sequence'),selectedLive.context?.sequence ?? '—'],[t('Current step'),selectedLive.context?.current_step ? JSON.stringify(selectedLive.context?.current_step) : '—'],[t('Recent faults on rack'),selectedLive.recent_fault_count]].map(([label,value]) => <Box key={String(label)} sx={{ overflowWrap:'anywhere' }}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography variant="body2">{value}</Typography></Box>)}
        {selectedLive.recent_fault_count >= data.config?.threshold && <Alert severity="warning">{t('Repeated failures detected on this Rack. Maintenance inspection is recommended.')}</Alert>}
        {selectedLive.status === 'ACTIVE' && <Alert severity="warning">{t('Operation blocked until fault is cleared')}</Alert>}
      </>}
    </Stack></DialogContent><DialogActions>{selectedLive?.cabinet_id && <Button component={Link} to={`/cabinets/${selectedLive.cabinet_id}`}>{t('Inspect cabinet')}</Button>}<Button onClick={() => setSelected(null)}>{t('Close')}</Button></DialogActions></Dialog>
    <Typography variant="caption" color="text.secondary">{t('Repeated-fault policy: {0} occurrences per rack within {1} minutes.',data.config?.threshold ?? '—',data.config?.window_minutes ?? '—')} {t('Communication loss is not counted as a device fault.')}</Typography>
  </Stack>
}
