import { t as sharedText, getLanguage, useLanguage } from '../i18n';
import { useState } from 'react'
import { Box, Card, CardContent, Grid, Typography, Button, Stack, Chip, FormControl, InputLabel, Select, MenuItem, Skeleton, Alert } from '@mui/material'
import { ArrowForward, StorageOutlined, CheckCircleOutline, ViewModuleOutlined, Refresh } from '@mui/icons-material'
import { Link as RouterLink } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { cabinetAPI } from '@api/cabinet'
import { PageHeader, EmptyState } from '@components/PageHeader'

// Additional UI copy for mechanical state, recovery and rack locations.
const mergedCopy: Record<string, [string, string]> = {
  "RECOVERING": ["Đang phục hồi", "Recovering"],
  "STOPPED": ["Đã dừng", "Stopped"],
  "COMMUNICATION_LOST": ["Mất liên lạc", "Communication lost"],
  "OBSTRUCTED": ["Có vật cản", "Obstructed"],
  "REFERENCE_LOST": ["Mất vị trí gốc", "Reference lost"]
}
const uiText = (value: string, ...args: any[]) => {
  const pair = mergedCopy[value]
  return pair ? pair[getLanguage() === 'en' ? 1 : 0].replace(/\{(\d+)\}/g, (_, index) => String(args[index] ?? '')) : sharedText(value, ...args)
}


export const Cabinets = () => {
  useLanguage();
  const [selectedGroup, setSelectedGroup] = useState(0)
  const q = useQuery({
    queryKey: ['cabinets', 'list'],
    queryFn: async () => (await cabinetAPI.list()).data,
    refetchInterval: 2000
  })
  const cabinetNumber = (cabinet: any) => {
    const index = Number(cabinet.cabinet_index)
    if (Number.isInteger(index) && index > 0) return index
    const codeNumber = String(cabinet.cabinet_code || cabinet.code || '').match(/(?:^|[-_ ])C(\d+)$/i)?.[1]
    const nameNumber = String(cabinet.cabinet_name || '').match(/(\d+)\s*$/)?.[1]
    return Number(codeNumber || nameNumber || cabinet.id)
  }
  const cabinets: any[] = [...(q.data ?? [])].sort((a,b) => cabinetNumber(a) - cabinetNumber(b) || Number(a.id) - Number(b.id))
  const groupOf = (cabinet: any) => Math.max(0, Math.floor((cabinetNumber(cabinet) - 1) / 6))
  const groups = [...new Set(cabinets.map(groupOf))]
  const currentGroup = groups.includes(selectedGroup) ? selectedGroup : groups[0] ?? 0
  const visibleCabinets = cabinets.filter(cabinet => groupOf(cabinet) === currentGroup)
  const groupLabel = (group: number) => `Cabinet ${String(group * 6 + 1).padStart(2, '0')} \u2013 ${String(group * 6 + 6).padStart(2, '0')}`
  const totalRacks = cabinets.reduce((total, cabinet) => total + (cabinet.rack_count || 0), 0)
  const onlineCabinets = cabinets.filter(cabinet => String(cabinet.status || '').toLowerCase() === 'active').length
  return <Box>
    <PageHeader title={uiText("Tủ & rack")} description={uiText("Theo dõi các nhóm tủ và mở chi tiết để thao tác rack, điều khiển đèn hoặc thông gió.")} action={<Button variant="outlined" startIcon={<Refresh />} disabled={q.isFetching} onClick={() => void q.refetch()}>{uiText("Làm mới")}</Button>} />
    <Grid container spacing={1.5} sx={{ mb: 2 }}>{[
      { label: 'Nhóm tủ', value: cabinets.length, icon: StorageOutlined, color: '#087c78' },
      { label: 'Tổng số rack', value: totalRacks, icon: ViewModuleOutlined, color: '#3274ad' },
      { label: 'Nhóm tủ hoạt động', value: onlineCabinets, icon: CheckCircleOutline, color: '#16846b' }
    ].map(metric => <Grid item xs={12} sm={4} key={metric.label}><Card><CardContent sx={{ p: 2 }}><Stack direction="row" justifyContent="space-between" alignItems="center"><Box sx={{display:'flex',alignItems:'center',gap:2}}><Typography variant="body2" color="text.secondary">{uiText(metric.label)}</Typography><Typography variant="h5" fontWeight={750}>{q.isLoading || q.isError ? '—' : metric.value}</Typography></Box><Box sx={{ display: 'flex', p: 1, borderRadius: 2, color: metric.color, bgcolor: metric.color + '12' }}><metric.icon /></Box></Stack></CardContent></Card></Grid>)}</Grid>
    <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap spacing={1.5} sx={{ mb: 1.5 }}>
      <Typography variant="h6" fontWeight={700}>{uiText('Danh s\u00e1ch nh\u00f3m t\u1ee7')}</Typography>
      {!q.isLoading && !q.isError && <Chip size="small" label={uiText('{0} / {1} nh\u00f3m t\u1ee7', visibleCabinets.length, cabinets.length)} variant="outlined" />}
      <FormControl size="small" sx={{ minWidth: 220, maxWidth: '100%' }}>
        <InputLabel id="cabinet-group-filter-label">{uiText('Nh\u00f3m t\u1ee7')}</InputLabel>
        <Select labelId="cabinet-group-filter-label" value={currentGroup} label={uiText('Nh\u00f3m t\u1ee7')} onChange={event => setSelectedGroup(Number(event.target.value))} disabled={q.isLoading || q.isError || !groups.length}>
          {(groups.length ? groups : [0]).map(group => <MenuItem key={group} value={group}>{groupLabel(group)}</MenuItem>)}
        </Select>
      </FormControl>
    </Stack>
    {q.isLoading ? <Grid container spacing={1.5}>{Array.from({ length: 6 }, (_, index) => <Grid item xs={12} sm={6} lg={4} key={index}><Skeleton variant="rounded" height={160} /></Grid>)}</Grid> : q.isError ? <Alert severity="error">{uiText("Không tải được danh sách tủ. Vui lòng thử làm mới.")}</Alert> : visibleCabinets.length === 0 ? <Card><EmptyState text={uiText("Chưa có nhóm tủ phù hợp")} /></Card> : <Grid container spacing={1.75}>{visibleCabinets.map(cabinet => {
      const name = cabinet.cabinet_name || cabinet.cabinet_code || uiText("Tủ {0}", cabinet.id)
      const code = cabinet.cabinet_code || cabinet.code || `CB-${cabinet.id}`
      const status = String(cabinet.status || '').toLowerCase()
      const isActive = status === 'active'
      const mechanical = cabinet.mechanical
      const fault = mechanical?.fault_context
      const statusLabel = mechanical ? mechanical.online ? mechanical.system_state : 'Offline' : isActive ? 'Hoạt động' : ['inactive', 'offline'].includes(status) ? 'Chưa hoạt động' : cabinet.status || 'Chưa xác định'
      const disconnected = mechanical ? !mechanical.online || mechanical.system_state === 'COMMUNICATION_LOST' : ['inactive','offline'].includes(status)
      const physicalFault = !disconnected && fault && fault.error_code !== 'COMMUNICATION_LOST'
      const rackAddress = Number(fault?.rack_id ?? fault?.moving_rack_id)
      const hasRack = Number.isInteger(rackAddress) && rackAddress > 0
      const hasPosition = typeof fault?.current_position === 'number' && Number.isFinite(fault.current_position) && typeof fault?.target_position === 'number' && Number.isFinite(fault.target_position)
      const badgeColor = disconnected ? 'warning' : physicalFault ? mechanical.system_state === 'RECOVERING' ? 'warning' : 'error' : isActive ? 'success' : 'default'
      return <Grid item xs={12} sm={6} lg={4} key={cabinet.id}><Card aria-disabled={!isActive} data-cabinet-id={cabinet.id} sx={{height:'100%',borderColor:disconnected ? 'warning.light' : 'divider'}}>
        <CardContent sx={{p:2}}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
            <Box sx={{minWidth:0}}><Typography variant="h6" fontWeight={750} sx={{fontSize:19,overflowWrap:'anywhere'}}>{name}</Typography><Typography variant="body2" color="text.secondary">{code}</Typography></Box>
            <Chip size="small" variant="outlined" color={badgeColor} label={uiText(disconnected ? 'Offline' : statusLabel)} sx={{flexShrink:0,maxWidth:'48%',height:'auto','& .MuiChip-label':{whiteSpace:'normal',py:0.5}}} />
          </Stack>
          <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} sx={{mt:2}}><Stack direction="row" spacing={0.75} alignItems="center"><ViewModuleOutlined color="action" fontSize="small" /><Typography fontWeight={650}>{cabinet.rack_count || 0} {uiText('rack')}</Typography></Stack>
            {isActive ? <Button component={RouterLink} to={`/cabinets/${cabinet.id}`} variant="outlined" endIcon={<ArrowForward />}>{uiText('Mở chi tiết tủ')}</Button> : <Button disabled variant="outlined" endIcon={<ArrowForward />}>{uiText('Mở chi tiết tủ')}</Button>}
          </Stack>
          {physicalFault && <Box component="details" sx={{mt:1.5,fontSize:14}}><Box component="summary" sx={{cursor:'pointer',color:badgeColor === 'error' ? 'error.main' : 'warning.dark'}}>{uiText('Fault details')}</Box><Stack spacing={0.5} sx={{mt:0.75}}>
            <Typography variant="body2">{hasRack ? `Rack ${(rackAddress-1)%6+1} · ` : ''}{uiText(fault.error_code || mechanical.system_state)}</Typography>
            {hasPosition && <Typography variant="body2" color="text.secondary">{fault.current_position} → {fault.target_position} mm</Typography>}
          </Stack></Box>}
        </CardContent>
      </Card></Grid>
    })}</Grid>}
    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>{uiText("Trạng thái cập nhật mỗi 2 giây. Các thao tác thiết bị thực hiện trong chi tiết tủ.")}</Typography>
  </Box>
}
