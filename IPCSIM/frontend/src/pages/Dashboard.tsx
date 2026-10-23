import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, Box, Button, Card, Chip, Drawer, Grid, IconButton, ListItemButton, Skeleton, Stack, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography } from '@mui/material'
import { ArrowForward, Close, CloudSyncOutlined, Inventory2Outlined, MemoryOutlined, Refresh, StorageOutlined, ThermostatOutlined, WaterDropOutlined, WarningAmberOutlined, ErrorOutline, Sync, CheckCircleOutline, WifiOffOutlined, HelpOutline, LockOpenOutlined } from '@mui/icons-material'
import { Link as RouterLink } from 'react-router-dom'
import { dashboardAPI } from '@api/dashboard'
import { cabinetAPI } from '@api/cabinet'
import { environmentAPI } from '@api/environment'
import api from '@api/client'
import { PageHeader } from '@components/PageHeader'
import { useFaultOverview } from '@components/MaintenanceNotice'
import { deviceFaultSummary } from '@components/DeviceFaultDetails'
import { t, getLanguage, useLanguage } from '../i18n'
import { formatDateTime, formatTimeShort, parseVietnamDate } from '@utils/date'

const time = (value: any) => typeof value === 'string' || typeof value === 'number' ? parseVietnamDate(value)?.getTime() || 0 : 0
const numeric = (value: any): number | null => value == null || value === '' || typeof value === 'boolean' || !Number.isFinite(Number(value)) ? null : Number(value)
const smokeValue = (value: any): number | null => {
  if (value == null || value === '') return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'number') return Number.isFinite(value) ? value === 0 ? 0 : 1 : null
  const text = String(value).toLowerCase().trim()
  if (['1','true','yes','co','alert','detected','on'].includes(text)) return 1
  if (['0','false','no','khong','ok','safe','off','none'].includes(text)) return 0
  return null
}
const cabinetIndex = (cabinet: any) => Number(cabinet.cabinet_index || String(cabinet.cabinet_code || '').match(/C(\d+)$/i)?.[1] || cabinet.id)
const cabinetLabel = (cabinet: any) => `Cabinet ${String(cabinetIndex(cabinet)).padStart(2,'0')}`
const bodyOf = (value: any) => { if (value && typeof value === 'object') return value; try { return JSON.parse(value || '{}') } catch { return {} } }
const tones: Record<string, string> = { Normal:'#087c78', Moving:'#3274ad', Open:'#9172bf', Warning:'#bb7837', Fault:'#c35454', Offline:'#85979d', Unknown:'#b5c1c5' }
const chipTone = (status: string): 'default' | 'success' | 'info' | 'warning' | 'error' => status === 'Fault' ? 'error' : status === 'Warning' ? 'warning' : status === 'Normal' ? 'success' : ['Moving','Open'].includes(status) ? 'info' : 'default'
const headingSx = { fontSize:17, fontWeight:750 }
const panelSx = { p:1.25, minWidth:0, height:'100%' }

export const Dashboard = () => {
  const language = useLanguage()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const summary = useQuery({ queryKey:['dashboard','summary'], queryFn:async () => (await dashboardAPI.getSummary()).data, refetchInterval:5000 })
  const health = useQuery<any>({ queryKey:['header-health'], queryFn:async () => (await api.get('/system/health')).data, refetchInterval:2000 })
  const cabinetsQuery = useQuery<any[]>({ queryKey:['cabinets','list'], queryFn:async () => (await cabinetAPI.list()).data, refetchInterval:2000 })
  const topology = useQuery({ queryKey:['environment','racks'], queryFn:async () => {
    const cabinets: any[] = (await cabinetAPI.list()).data || []
    return Promise.all(cabinets.map(async cabinet => ({cabinet, racks:(await cabinetAPI.getRacks(cabinet.id)).data || []})))
  }, refetchInterval:30000 })
  const readings = useQuery<any[]>({ queryKey:['environment','history',24], queryFn:async () => (await environmentAPI.history(24)).data.data || [], refetchInterval:5000 })
  const faults = useFaultOverview({hours:24,limit:5})
  const snapshot = useQuery<any>({ queryKey:['overview','activity'], queryFn:async () => (await api.get('/device/snapshot')).data, refetchInterval:5000 })
  const session = localStorage.getItem('edgeOperatorSession') || ''
  const transactions = useQuery<any[]>({ queryKey:['local-transactions',session], enabled:!!session, queryFn:async () => (await api.get('/operator/operations',{headers:{'X-Operator-Session':session}})).data, refetchInterval:5000, retry:false })
  const state = health.isError ? {} : health.data || {}
  const isIPC = state.device_type === 'IPC'
  const healthKnown = !!health.data && !health.isError
  const summaryKnown = !!summary.data && !summary.isError
  const cabinetKnown = !!cabinetsQuery.data && !cabinetsQuery.isError
  const cabinetList = cabinetKnown ? [...(cabinetsQuery.data || [])].sort((a,b) => cabinetIndex(a)-cabinetIndex(b)) : []
  const rackList: any[] = topology.isError ? [] : (topology.data || []).flatMap(group => group.racks.map((rack: any) => ({...rack,cabinet_id:group.cabinet.id})))
  const liveStates: any[] = healthKnown ? state.simulation_states || [] : []
  const mechanical = (cabinet: any) => liveStates.find(row => Number(row.cabinet_index) === cabinetIndex(cabinet)) || (cabinetKnown ? cabinet.mechanical : null)
  const activeFaults: any[] = faults.isError ? [] : faults.data?.active_faults || []
  const copy = (vi: string, en: string) => getLanguage() === 'en' ? en : vi
  const recentFaults: any[] = faults.isError ? [] : [...(faults.data?.history || [])].sort((a,b) => time(b.detected_at) - time(a.detected_at))
  const maintenanceCabinets = [...new Set<number>((faults.data?.maintenance_warnings || []).map((row: any) => Number(row.cabinet_index)))].sort((a,b)=>a-b).map(index => ({index, racks: (faults.data?.maintenance_warnings || []).filter((row: any)=>Number(row.cabinet_index)===index)}))
  const orderedFaults = [...activeFaults].sort((a,b) => ({CRITICAL:0,ERROR:1,WARNING:2,INFO:3}[a.severity as 'CRITICAL'] ?? 4)-({CRITICAL:0,ERROR:1,WARNING:2,INFO:3}[b.severity as 'CRITICAL'] ?? 4) || time(b.detected_at)-time(a.detected_at))
  const faultKnown = !!faults.data?.summary && !faults.isError
  const hardwareRack = (rack: any) => state.hardware_racks?.[String(rack.rack_code)]
  const rackOnline = (rack: any) => healthKnown && !!state.serial_connected && !!hardwareRack(rack) && hardwareRack(rack).hardware_error !== 'INVALID_RACK'
  const cabinetOnline = (cabinet: any) => isIPC
    ? rackList.some(rack => Number(rack.cabinet_id) === Number(cabinet.id) && rackOnline(rack))
    : healthKnown && mechanical(cabinet)?.online === true
  const statusOf = (cabinet: any, rack?: any): string => {
    if (isIPC) {
      if (!healthKnown) return 'Unknown'
      if (!rack) {
        const supported = rackList.filter(r => Number(r.cabinet_id) === Number(cabinet.id) && hardwareRack(r) && hardwareRack(r).hardware_error !== 'INVALID_RACK')
        return supported.length ? supported.map(r => statusOf(cabinet, r)).sort((a,b) => priority[a]-priority[b])[0] : state.serial_connected ? 'Unknown' : 'Offline'
      }
      const hardware = hardwareRack(rack)
      if (!hardware || hardware.hardware_error === 'INVALID_RACK') return 'Offline'
      if (!state.serial_connected) return 'Offline'
      if (hardware.hardware_state === 'ERROR' || hardware.hardware_error) return 'Fault'
      if (['OPENING','CLOSING'].includes(hardware.hardware_state)) return 'Moving'
      if (hardware.hardware_state === 'OPENED') return 'Open'
      if (hardware.hardware_state === 'CLOSED') return 'Normal'
      return 'Unknown'
    }
    const m = mechanical(cabinet)
    const rackIndex = Number(rack?.rack_index || (Number(rack?.rack_code)-1)%6+1)
    const fault = orderedFaults.find(row => Number(row.cabinet_index) === cabinetIndex(cabinet) && (!rack || Number(row.rack_index) === rackIndex))
    if (fault) return ['CRITICAL','ERROR'].includes(fault.severity) ? 'Fault' : 'Warning'
    if (!healthKnown) return 'Unknown'
    if (m && (!m.online || m.system_state === 'COMMUNICATION_LOST')) return 'Offline'
    if (!m) return String(cabinet.status).toUpperCase() === 'ACTIVE' ? 'Unknown' : 'Offline'
    const contextRack = Number(m.fault_context?.rack_id || m.fault_context?.moving_rack_id)
    const contextMatches = !rack || contextRack > 0 && (contextRack-1)%6+1 === rackIndex
    if (m.fault_context && contextMatches) return m.system_state === 'RECOVERING' ? 'Warning' : 'Fault'
    if (!rack && ['ERROR','STOPPED','RECOVERING'].includes(m.system_state)) return m.system_state === 'RECOVERING' ? 'Warning' : 'Fault'
    if ((faults.data?.maintenance_warnings || []).some((row: any) => Number(row.cabinet_index) === cabinetIndex(cabinet) && (!rack || Number(row.rack_index) === rackIndex))) return 'Warning'
    const r = rack ? m.racks?.[String(rack.rack_code)] : null
    if (r?.is_moving || !rack && ['MOVING','OPENING','CLOSING','HOMING'].includes(m.system_state)) return 'Moving'
    if (r?.access_state === 'OPEN' || !rack && m.system_state === 'OPEN') return 'Open'
    return rack && !r ? 'Unknown' : 'Normal'
  }
  const priority: Record<string, number> = {Fault:0,Warning:1,Moving:2,Open:3,Unknown:4,Offline:5,Normal:6}
  const cabinetStatus = (cabinet: any) => isIPC ? statusOf(cabinet) : [statusOf(cabinet), ...rackList.filter(rack=>Number(rack.cabinet_id)===Number(cabinet.id)).map(rack=>statusOf(cabinet,rack))]
    .sort((a,b)=>priority[a]-priority[b])[0]
  const statusIcon = (status: string) => ({Fault:ErrorOutline,Warning:WarningAmberOutlined,Moving:Sync,Open:LockOpenOutlined,Normal:CheckCircleOutline,Offline:WifiOffOutlined,Unknown:HelpOutline}[status] || HelpOutline)
  const onlineCount = cabinetList.filter(cabinetOnline).length
  const cabinetCounts = [
    {label:'Online',count:onlineCount,color:tones.Normal},
    {label:'Offline / Unknown',count:cabinetList.length-onlineCount,color:tones.Offline},
    {label:'Moving',count:cabinetList.filter(cabinet=>cabinetStatus(cabinet)==='Moving').length,color:tones.Moving},
    {label:'Fault / Warning',count:cabinetList.filter(cabinet=>['Fault','Warning'].includes(cabinetStatus(cabinet))).length,color:tones.Fault},
  ]
  const latest = new Map<number,any>()
  ;[...(readings.isError ? [] : readings.data || [])].sort((a,b) => time(b.created_at)-time(a.created_at) || Number(b.id)-Number(a.id)).forEach(row => {if (!latest.has(Number(row.rack_id))) latest.set(Number(row.rack_id),row)})
  const now = Date.now()
  // Match the existing telemetry-active window; require independent live cabinet state.
  const fresh = rackList.flatMap(rack => {
    const cabinet = cabinetList.find(row => Number(row.id) === Number(rack.cabinet_id)), row = latest.get(Number(rack.id))
    const age = now-time(row?.created_at)
    return healthKnown && cabinet && (isIPC ? rackOnline(rack) : cabinetOnline(cabinet)) && row && age >= 0 && age <= 15000 ? [{...row,rack,cabinet}] : []
  })
  const climate = (key: string) => {
    const values = fresh.map(row => numeric(row[key])).filter((value): value is number => value != null && (key !== 'humidity' || value >= 0 && value <= 100))
    return values.length ? {average:values.reduce((a,b)=>a+b,0)/values.length,min:Math.min(...values),max:Math.max(...values),count:values.length} : null
  }
  const temperature = climate('temperature'), humidity = climate('humidity')
  const smokeAlerts = fresh.filter(row => smokeValue(row.smoke_detected ?? row.smoke) === 1)
  const smokeCoverage = fresh.filter(row => smokeValue(row.smoke_detected ?? row.smoke) != null).length
  const sensorFaults = activeFaults.filter(row => /SMOKE|GAS|TEMPERATURE|HUMIDITY|SENSOR/.test(String(row.code || row.error_code)))
  const sensorCritical = smokeAlerts.length > 0 || sensorFaults.some(row=>['CRITICAL','ERROR'].includes(row.severity))
  const sensorAlerts = new Set([...smokeAlerts.map(row => `${cabinetIndex(row.cabinet)}:${row.rack.rack_index || (Number(row.rack.rack_code)-1)%6+1}`),...sensorFaults.map(row => `${row.cabinet_index}:${row.rack_index}`)]).size
  const activity = [
    ...(snapshot.isError ? [] : snapshot.data?.operation_history || []).map((row: any) => {const body=bodyOf(row.body);return {id:`command:${row.id}`,label:body.kind || body.action || 'Operation',location:body.address ? `Cabinet ${Math.floor((Number(body.address)-1)/6)+1} / Rack ${(Number(body.address)-1)%6+1}` : '',status:row.execution_state || 'unconfirmed',time:row.completed_at || row.updated_at || row.created_at,link:'/operation'}}),
    ...(transactions.isError ? [] : transactions.data || []).filter(row => ['PICK','PUT','ADJUST'].includes(row.operation_type || row.kind)).map(row => ({id:`transaction:${row.id}`,label:row.operation_type || row.kind,location:row.cabinet_index ? `Cabinet ${row.cabinet_index} / Rack ${row.rack_index}` : '',status:row.operation_status,time:row.completed_at || row.updated_at || row.created_at,link:'/transactions'})),
    ...(faults.isError ? [] : faults.data?.history || []).map((row: any) => ({id:`fault:${row.id}`,label:row.description || row.error_code,location:`Cabinet ${row.cabinet_index} / Rack ${row.rack_index}`,status:row.status,time:row.resolved_at || row.detected_at,link:'/breakdown'}))
  ].filter(row => time(row.time)).sort((a,b)=>time(b.time)-time(a.time)).slice(0,4)
  const selected = cabinetList.find(row => Number(row.id) === selectedId)
  const selectedRacks = selected ? rackList.filter(rack => Number(rack.cabinet_id) === Number(selected.id)).sort((a,b)=>Number(a.rack_index || a.rack_code)-Number(b.rack_index || b.rack_code)) : []
  const stock = summaryKnown ? (summary.data as any)?.inventory_summary || {} : {}
  const count = (value: any, known: boolean) => known ? value ?? 'N/A' : 'N/A'
  const refresh = () => {void Promise.all([summary.refetch(),health.refetch(),cabinetsQuery.refetch(),topology.refetch(),readings.refetch(),faults.refetch(),snapshot.refetch(), ...(session ? [transactions.refetch()] : [])])}
  const readyCount = cabinetList.filter(row=>isIPC ? cabinetOnline(row) && String(row.status).toUpperCase() === 'ACTIVE' : mechanical(row)?.online).length
  const simulationStatus = !healthKnown || !liveStates.length ? 'Unknown' : !state.serial_connected || !liveStates.some(row=>row.online) ? 'Disconnected' : liveStates.some(row=>!row.online) ? 'Degraded' : 'Connected'
  const shortTime = (value: any) => time(value) ? formatTimeShort(value) : 'N/A'
  return <Stack spacing={1.25} data-testid="operations-overview">
    <PageHeader title={t('Tổng quan vận hành')} description={t('Nắm nhanh tình hình kho hàng, hoạt động tủ và kết nối thiết bị trước khi bắt đầu công việc.')} action={<Button variant="outlined" startIcon={<Refresh />} disabled={summary.isFetching || health.isFetching} onClick={refresh}>{t('Làm mới')}</Button>} />
    {[summary,cabinetsQuery,health,faults,readings,topology,snapshot,transactions].some(query=>query.isError) && <Alert severity="warning">{t('Some overview data is unavailable. Refresh to confirm current status.')}</Alert>}
    {healthKnown && state.hardware_status === 'FAULT' && <Alert severity="error" sx={{py:0}}><Tooltip title={<Box sx={{whiteSpace:'pre-line'}}>{deviceFaultSummary(state,language)}</Box>}><Button component={RouterLink} to="/breakdown" color="inherit" size="small">{t('Thiết bị: có lỗi')} &middot; {t('Sự cố & phục hồi')}</Button></Tooltip></Alert>}
    {healthKnown && state.offline_mode && <Alert severity="info" sx={{py:0}}>{t('Server đang offline.')} {t(state.local_operation_available ? 'Có thể vận hành với dữ liệu local.' : 'Thiết bị chưa sẵn sàng vận hành.')} {t('Giao dịch sẽ đồng bộ khi kết nối trở lại.')}</Alert>}
    <Grid container spacing={1.25} sx={{width:'calc(100% + 10px) !important',ml:'-10px !important',mt:'0 !important'}}>{[
      {label:'Total cabinets',value:count(cabinetList.length,cabinetKnown),detail:`${readyCount} / ${cabinetList.length} ${t('Connected')}`,icon:StorageOutlined,link:'/cabinets',color:'#087c78'},
      {label:'Total racks',value:count((summary.data as any)?.cabinet_status?.total_racks ?? rackList.length,summaryKnown || !!topology.data && !topology.isError),detail:t('Cabinet & rack overview'),icon:StorageOutlined,link:'/cabinets',color:'#9172bf'},
      {label:'Tổng tồn kho',value:count(stock.total_stock,summaryKnown),detail:`${stock.total_items ?? 'N/A'} ${t('products')} \u00b7 ${stock.low_stock_count ?? 'N/A'} ${t('Low stock')}`,icon:Inventory2Outlined,link:'/inventory',color:'#3274ad'},
      {label:'Active incidents',value:count(faults.data?.summary?.active_faults ?? activeFaults.length,faultKnown),detail:!faultKnown ? t('Unknown') : `${activeFaults.filter(row=>row.severity==='CRITICAL').length} ${t('Critical')}`,icon:WarningAmberOutlined,link:'/breakdown',color:activeFaults.length ? '#c35454' : '#087c78'}
    ].map(metric=><Grid item xs={6} md={3} key={metric.label}><Card><ListItemButton component={RouterLink} to={metric.link} sx={{p:1,justifyContent:'space-between',gap:1}}><Box sx={{minWidth:0,flex:1}}><Typography variant="body2" color="text.secondary">{t(metric.label)}</Typography><Stack direction="row" spacing={1} alignItems="baseline"><Typography fontSize={26} lineHeight={1.2} fontWeight={750}>{metric.value}</Typography><Tooltip title={metric.detail}><Typography variant="caption" noWrap color="text.secondary" sx={{minWidth:0}}>{metric.detail}</Typography></Tooltip></Stack></Box><metric.icon sx={{color:metric.color}} /></ListItemButton></Card></Grid>)}</Grid>
    <Grid container spacing={1.25} sx={{width:'calc(100% + 10px) !important',ml:'-10px !important',mt:'0 !important'}}>
      <Grid item xs={12} lg={8}><Card sx={{...panelSx,p:1.5}}><Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} sx={{mb:1.25}}><Typography sx={headingSx}>{t('Cabinet overview')}</Typography><Button size="small" component={RouterLink} to="/cabinets" endIcon={<ArrowForward />}>{t('Details')}</Button></Stack>
        <Box data-testid="overview-cabinet-summary" sx={{display:'grid',gridTemplateColumns:{xs:'repeat(2,minmax(0,1fr))',sm:'repeat(4,minmax(0,1fr))'},gap:1,mb:1.25,pb:1.25,borderBottom:'1px solid',borderColor:'divider'}}>{cabinetCounts.map(row=><Stack key={row.label} direction="row" spacing={0.5} alignItems="center"><Box sx={{width:6,height:6,borderRadius:'50%',bgcolor:row.color}} /><Typography variant="caption" color="text.secondary">{t(row.label)}</Typography><Typography variant="body2" fontWeight={700}>{cabinetKnown && healthKnown ? row.count : 'N/A'}</Typography></Stack>)}</Box>
        {!isIPC && (cabinetsQuery.isLoading ? <Skeleton height={120} /> : !cabinetList.length ? <Typography variant="body2" color="text.secondary">{t(cabinetKnown ? 'No cabinets available' : 'Unknown')}</Typography> : <Box data-testid="overview-cabinet-grid" sx={{display:'grid',gridTemplateColumns:{xs:'repeat(4,minmax(0,1fr))',sm:'repeat(8,minmax(0,1fr))'},gap:1}}>
          {cabinetList.map(cabinet=>{const status=cabinetStatus(cabinet), Icon=statusIcon(status), emphasized=['Fault','Warning','Moving'].includes(status), online=cabinetOnline(cabinet);return <Tooltip key={cabinet.id} title={`${cabinetLabel(cabinet)} / ${cabinet.cabinet_name || cabinet.cabinet_code} / ${t(status)}`}><ListItemButton data-testid="overview-cabinet" data-status={status} aria-label={`${cabinetLabel(cabinet)} / ${t(status)}`} onClick={()=>setSelectedId(Number(cabinet.id))} sx={{justifyContent:'space-between',gap:0.5,px:1,py:0.75,minHeight:40,border:'1px solid',borderColor:emphasized ? tones[status] : online ? 'success.main' : 'divider',borderRadius:2,bgcolor:emphasized ? `${tones[status]}14` : status==='Normal' ? '#f4f9f8' : '#f8fafb',color:emphasized ? tones[status] : status==='Normal' ? 'text.primary' : 'text.secondary',minWidth:0,'&:hover':{bgcolor:`${tones[status]}22`}}}>
            <Typography fontSize={15} fontWeight={emphasized ? 750 : 650}>{String(cabinetIndex(cabinet)).padStart(2,'0')}</Typography><Icon sx={{fontSize:18,color:tones[status],flexShrink:0}} />
          </ListItemButton></Tooltip>})}
        </Box>)}
        {isIPC && <Box data-testid="ipc-rack-overview" sx={{display:'grid',gridTemplateColumns:{xs:'repeat(2,minmax(0,1fr))',sm:'repeat(3,minmax(0,1fr))'},gap:1.25}}>
          {[...rackList].sort((a,b)=>Number(a.rack_index)-Number(b.rack_index)).map(rack => {
            const cabinet = cabinetList.find(row=>Number(row.id)===Number(rack.cabinet_id))
            const status = cabinet ? statusOf(cabinet,rack) : 'Unknown'
            const hardware = hardwareRack(rack)
            const online = rackOnline(rack)
            const saved = !!hardware?.last_confirmed_state && (hardware.position_stale || !online)
            const position = saved ? hardware.last_confirmed_state : hardware?.hardware_state || status
            return <Button data-testid={`ipc-rack-${rack.rack_code}`} data-status={status} key={rack.id} component={RouterLink} to="/cabinets" variant="outlined" sx={{display:'block',textAlign:'left',minWidth:0,p:1.5,borderRadius:2.5,borderColor:online ? '#b9dcd8' : 'divider',bgcolor:online ? '#f7fbfa' : '#fafbfc',color:'text.primary',textTransform:'none','&:hover':{borderColor:'primary.main',bgcolor:'#f0f7f6'}}}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={0.5} sx={{mb:1.5}}>
                <Typography fontSize={16} fontWeight={750}>Rack {String(rack.rack_index || rack.rack_code).padStart(2,'0')}</Typography>
                <Tooltip title={t(online ? 'Connected' : 'Disconnected')}><Box sx={{width:8,height:8,borderRadius:'50%',bgcolor:online ? 'success.main' : '#b6c1c8',flexShrink:0}} /></Tooltip>
              </Stack>
              <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={0.5} sx={{minHeight:26}}>
                <Typography variant="caption" color={online ? 'success.main' : 'text.secondary'}>{t(online ? 'Connected' : 'Disconnected')}</Typography>
                <Chip size="small" label={t(position)} color={chipTone(status)} variant="outlined" sx={{height:24,fontSize:12,fontWeight:600,borderColor:online ? undefined : 'divider'}} />
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{display:'block',mt:0.75,minHeight:18,fontSize:11,lineHeight:'18px'}}>{saved ? copy('Trạng thái gần nhất', 'Last confirmed position') : '\u00a0'}</Typography>
            </Button>
          })}
        </Box>}
      </Card></Grid>
      <Grid item xs={12} lg={4}><Card sx={panelSx}><Typography sx={{...headingSx,mb:1}}>{t('System connectivity')}</Typography><Stack spacing={0.75}>{[
        {label:'Server / MQTT',status:!healthKnown ? 'Unknown' : state.server_online ? 'Connected' : 'Disconnected',good:state.server_online,tip:t('Server connection reported by IPC; MQTT detail is not provided.')},
        {label:isIPC ? 'Hardware' : 'Simulation',status:isIPC ? !healthKnown ? 'Unknown' : state.hardware_status === 'FAULT' ? 'Fault' : state.serial_connected ? 'Connected' : 'Disconnected' : simulationStatus,good:isIPC ? state.serial_connected && state.hardware_status !== 'FAULT' : simulationStatus==='Connected',tip:isIPC ? t('Hardware') : t('Based on live Simulation responses, independently of Serial.')},
        {label:'Serial / COM',status:!healthKnown ? 'Unknown' : state.serial_connected ? 'Connected' : 'Disconnected',good:state.serial_connected,tip:t('Kết nối Serial tới bộ mô phỏng / phần cứng.')},
        {label:'Data synchronization',status:!healthKnown ? 'Unknown' : state.server_synced ? 'Synced' : 'Pending',good:state.server_synced,tip:state.last_successful_sync ? formatDateTime(state.last_successful_sync) : t('Chưa có dữ liệu đồng bộ')},
      ].map(row=><Tooltip key={row.label} title={row.tip}><Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}><Typography variant="body2">{t(row.label)}</Typography><Chip data-testid={`connectivity-${row.label}`} size="small" variant="outlined" color={row.status==='Unknown' ? 'default' : row.good ? 'success' : 'warning'} label={t(row.status)} /></Stack></Tooltip>)}</Stack><Stack direction="row" justifyContent="space-between" alignItems="center" sx={{mt:1}}><Tooltip title={`${t('Dữ liệu local')}: ${t(!healthKnown ? 'Unknown' : state.database_healthy ? 'Sẵn sàng' : 'Cần kiểm tra')}`}><Typography variant="caption">{count(state.pending_transactions,healthKnown)} {t('pending transactions')}</Typography></Tooltip><Button size="small" component={RouterLink} to="/system" endIcon={<ArrowForward />}>{t('Details')}</Button></Stack></Card></Grid>
    </Grid>
    <Card sx={{p:1.25}}><Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',sm:'repeat(3,minmax(0,1fr))'},gap:1.5}}>
      {[{label:'Temperature',metric:temperature,unit:'\u00b0C',icon:ThermostatOutlined,color:'#bb7837'},{label:'Humidity',metric:humidity,unit:'%RH',icon:WaterDropOutlined,color:'#3274ad'}].map(row=><Stack key={row.label} data-testid={`overview-${row.label.toLowerCase()}`} direction="row" spacing={1} alignItems="center"><row.icon sx={{color:row.color}} /><Box><Stack direction="row" spacing={1} alignItems="baseline" flexWrap="wrap"><Typography variant="body2" color="text.secondary">{t(row.label)} &middot; {t('Average')}</Typography><Typography fontSize={22} fontWeight={700} lineHeight={1.2}>{row.metric ? row.metric.average.toFixed(1) : 'N/A'} <Typography component="span" variant="caption">{row.unit}</Typography></Typography></Stack><Typography variant="caption" color="text.secondary">{row.metric ? `${t('Min / Max')}: ${row.metric.min.toFixed(1)} / ${row.metric.max.toFixed(1)}` : t('No fresh online sensor data')}</Typography></Box></Stack>)}
      <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center"><Box><Stack direction="row" spacing={1} alignItems="center"><Typography variant="body2" color="text.secondary">{t('Sensor alerts')}</Typography><Tooltip title={t('Temperature / humidity limits are not provided by the current API.')}><Chip size="small" label={sensorAlerts ? `${sensorAlerts} \u00b7 ${t(sensorCritical ? 'Critical' : 'Warning')}` : t('Unknown')} color={sensorAlerts ? sensorCritical ? 'error' : 'warning' : 'default'} variant="outlined" /></Tooltip></Stack><Typography variant="caption" display="block" color={smokeAlerts.length ? 'error.main' : 'text.secondary'}>{smokeAlerts.length ? t('Phát hiện khói') : smokeCoverage ? t('Không có khói') : t('Chưa có số đo khói')} &middot; {fresh.length} / {rackList.length}</Typography></Box><Tooltip title={`${t('Details')} / ${fresh.length} ${t('fresh racks')}`}><IconButton size="small" component={RouterLink} to="/environment" aria-label={t('Details')}><ArrowForward fontSize="small" /></IconButton></Tooltip></Stack>
    </Box></Card>
    <Grid container spacing={1.25} sx={{width:'calc(100% + 10px) !important',ml:'-10px !important',mt:'0 !important'}}>
      <Grid item xs={12} md={6}><Card sx={{...panelSx,height:'auto'}}><Stack direction="row" justifyContent="space-between" alignItems="center"><Typography sx={headingSx}>{copy('Lỗi gần nhất trong 24 giờ', 'Latest faults in 24 hours')}</Typography><Button size="small" component={RouterLink} to="/breakdown" endIcon={<ArrowForward />}>{t('Details')}</Button></Stack>
        {!recentFaults.length ? <Typography variant="body2" color="text.secondary" sx={{py:0.5}}>{faultKnown ? copy('Không ghi nhận lỗi trong 24 giờ.', 'No faults recorded in the last 24 hours.') : t('Unknown')}</Typography> : recentFaults.slice(0,2).map(fault=><ListItemButton data-testid="overview-incident" key={fault.id} component={RouterLink} to="/breakdown" sx={{px:0,py:0.25,gap:1}}><Chip size="small" variant="outlined" label={t(fault.status === 'RESOLVED' ? 'RESOLVED' : fault.severity)} color={fault.status === 'RESOLVED' ? 'default' : ['CRITICAL','ERROR'].includes(fault.severity) ? 'error' : 'warning'} /><Box sx={{flex:1,minWidth:0}}><Tooltip title={t(fault.description || fault.error_code)}><Typography variant="body2" noWrap fontWeight={650}>Cabinet {String(fault.cabinet_index).padStart(2,'0')} &middot; Rack {String(fault.rack_index).padStart(2,'0')} <Typography component="span" variant="caption" color="text.secondary">{t(fault.description || fault.error_code)}</Typography></Typography></Tooltip></Box><Tooltip title={formatDateTime(fault.detected_at)}><Typography variant="caption">{shortTime(fault.detected_at)}</Typography></Tooltip></ListItemButton>)}
        <Box sx={{mt:0.75,pt:0.75,borderTop:'1px solid',borderColor:'divider'}}>
          <Typography variant="body2" fontWeight={700}>{copy('Tủ cần chú ý kiểm tra/bảo trì', 'Cabinets requiring inspection / maintenance')} · {faultKnown ? maintenanceCabinets.length : '—'}</Typography>
          {maintenanceCabinets.length ? maintenanceCabinets.slice(0,2).map(cabinet => <ListItemButton data-testid="overview-maintenance" key={cabinet.index} component={RouterLink} to="/breakdown" sx={{px:0,py:0.25,gap:1}}><WarningAmberOutlined color="warning" fontSize="small" /><Typography variant="body2" fontWeight={650}>{t('Cabinet')} {String(cabinet.index).padStart(2,'0')}</Typography><Typography variant="caption" color="text.secondary" sx={{minWidth:0,flex:1}}>{[...new Set(cabinet.racks.map((row:any)=>`R${String(row.rack_index).padStart(2,'0')}`))].join(', ')}</Typography></ListItemButton>) : <Typography variant="body2" color="text.secondary" sx={{py:0.25}}>{faultKnown ? copy('Không có tủ cần chú ý.', 'No cabinets requiring attention.') : t('Unknown')}</Typography>}
        </Box>
      </Card></Grid>
      <Grid item xs={12} md={6}><Card sx={panelSx}><Stack direction="row" justifyContent="space-between" alignItems="center"><Typography sx={headingSx}>{t('Recent activity')}</Typography><Button size="small" component={RouterLink} to="/operation" endIcon={<ArrowForward />}>{t('Details')}</Button></Stack>
        {activity.length ? activity.map(row=><ListItemButton data-testid="overview-activity" key={row.id} component={RouterLink} to={row.link} sx={{px:0,py:0.25,gap:1}}><Box sx={{flex:1,minWidth:0}}><Tooltip title={`${t(row.label)} / ${row.location} / ${t(row.status || 'Unknown')}`}><Typography variant="body2" noWrap>{t(row.label)} &middot; {row.location}</Typography></Tooltip></Box><Tooltip title={formatDateTime(row.time)}><Typography variant="caption">{shortTime(row.time)}</Typography></Tooltip></ListItemButton>) : <Typography variant="body2" color="text.secondary" sx={{py:1}}>{t(snapshot.isError || transactions.isError ? 'Unknown' : 'No recent activity')}</Typography>}
      </Card></Grid>
    </Grid>
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>{[{label:'Kho hàng',link:'/inventory',icon:Inventory2Outlined},{label:'Hoạt động thiết bị',link:'/operation',icon:MemoryOutlined},{label:'Sự cố & phục hồi',link:'/breakdown',icon:WarningAmberOutlined}].map(row=><Button key={row.link} component={RouterLink} to={row.link} size="small" startIcon={<row.icon />}>{t(row.label)}</Button>)}<Tooltip title={t('Tổng quan cập nhật mỗi 5 giây · kết nối thiết bị mỗi 2 giây.')}><CloudSyncOutlined sx={{ml:'auto !important',color:'text.secondary',alignSelf:'center',fontSize:18}} /></Tooltip></Stack>
    <Drawer anchor="right" sx={{zIndex:theme=>theme.zIndex.drawer+2}} open={!!selected} onClose={()=>setSelectedId(null)} PaperProps={{sx:{width:{xs:'100%',sm:480},p:2}}}>
      {selected && <Stack spacing={1.5}><Stack direction="row" justifyContent="space-between" alignItems="center"><Box><Typography variant="h6" fontWeight={750}>{cabinetLabel(selected)}</Typography><Typography variant="body2" color="text.secondary">{selected.cabinet_name || selected.cabinet_code}</Typography></Box><IconButton aria-label={t('Close')} onClick={()=>setSelectedId(null)}><Close /></IconButton></Stack><Chip sx={{alignSelf:'flex-start'}} size="small" color={chipTone(cabinetStatus(selected))} label={t(cabinetStatus(selected))} /><Typography variant="body2">GAP: {healthKnown && mechanical(selected)?.online ? mechanical(selected)?.current_gap ?? 'N/A' : 'N/A'}</Typography>
        {topology.isLoading ? <Skeleton height={200} /> : <Table size="small"><TableHead><TableRow>{['Rack','Status','Position'].map(label=><TableCell key={label}>{t(label)}</TableCell>)}</TableRow></TableHead><TableBody>{selectedRacks.map(rack=>{const r=mechanical(selected)?.racks?.[String(rack.rack_code)];return <TableRow key={rack.id}><TableCell>{rack.rack_name || `Rack ${rack.rack_index || rack.id}`}</TableCell><TableCell><Chip size="small" variant="outlined" color={chipTone(statusOf(selected,rack))} label={t(statusOf(selected,rack))} /></TableCell><TableCell>{isIPC ? t(hardwareRack(rack)?.last_confirmed_state || hardwareRack(rack)?.hardware_state || 'Unknown') : healthKnown && mechanical(selected)?.online && numeric(r?.position_mm)!=null ? `${r.position_mm} mm` : 'N/A'}</TableCell></TableRow>})}</TableBody></Table>}
        {mechanical(selected)?.fault_context && <Alert severity="warning">{t(mechanical(selected).fault_context.error_code || mechanical(selected).system_state)}</Alert>}
        <Box component="details"><Box component="summary" sx={{cursor:'pointer',fontSize:15}}>{t('Latest readings')}</Box><Stack spacing={1} sx={{mt:1}}>{selectedRacks.map(rack=>{const reading=fresh.find(row=>Number(row.rack.id)===Number(rack.id));return <Box key={rack.id}><Typography variant="body2" fontWeight={650}>{rack.rack_name || `Rack ${rack.rack_index || rack.id}`}</Typography><Typography variant="body2" color="text.secondary">{reading ? `${reading.temperature ?? 'N/A'} °C · ${reading.humidity ?? 'N/A'} % · ${reading.weight ?? 'N/A'} kg · Gas: ${reading.gas ?? 'N/A'}` : t('No fresh online sensor data')}</Typography></Box>})}</Stack></Box>
        <Button variant="outlined" component={RouterLink} to={`/cabinets/${selected.id}`} endIcon={<ArrowForward />}>{t('Mở chi tiết tủ')}</Button>
        <Button component={RouterLink} to="/environment">{t('Xem môi trường theo rack')}</Button>
      </Stack>}
    </Drawer>
  </Stack>
}
