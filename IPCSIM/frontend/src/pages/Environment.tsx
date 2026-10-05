import { t as uiText, useLanguage } from '../i18n';
import { useState } from 'react'
import { Alert, Box, Button, Card, CardContent, Chip, Grid, MenuItem, Skeleton, Stack, TextField, Typography } from '@mui/material'
import { ThermostatOutlined, WaterDropOutlined, ScaleOutlined, Refresh, SensorsOutlined } from '@mui/icons-material'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { useQuery } from '@tanstack/react-query'
import { environmentAPI } from '@api/environment'
import { cabinetAPI } from '@api/cabinet'
import { formatDateTime, formatTimeShort, parseVietnamDate } from '@utils/date'
import { PageHeader, EmptyState } from '@components/PageHeader'
const smokeValue = (value: any): number | null => {
  if (value == null || value === '') return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'number') return value === 0 ? 0 : 1
  const text = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'có', 'co', 'alert', 'detected', 'on'].includes(text)) return 1
  if (['0', 'false', 'no', 'không', 'khong', 'ok', 'safe', 'off', 'none'].includes(text)) return 0
  return null
}
export const Environment = () => {
  useLanguage();
  const [cabinetId, setCabinetId] = useState('all'), [trendRackId, setTrendRackId] = useState('')
  const topology = useQuery({ queryKey: ['environment', 'racks'], queryFn: async () => {
    const cabinets: any[] = (await cabinetAPI.list()).data || []
    return Promise.all(cabinets.map(async cabinet => ({ cabinet, racks: (await cabinetAPI.getRacks(cabinet.id)).data || [] })))
  }, refetchInterval: 30000 })
  const history = useQuery({ queryKey: ['environment', 'history', 24], queryFn: async () => (await environmentAPI.history(24)).data.data || [], refetchInterval: 5000 })
  const records: any[] = [...(history.data || [])].sort((a, b) => (parseVietnamDate(b.created_at)?.getTime() || 0) - (parseVietnamDate(a.created_at)?.getTime() || 0) || b.id - a.id)
  const latest = new Map<number, any>()
  records.forEach(row => { if (!latest.has(Number(row.rack_id))) latest.set(Number(row.rack_id), row) })
  const groups = (topology.data || []).filter(group => cabinetId === 'all' || String(group.cabinet.id) === cabinetId)
  const racks: any[] = groups.flatMap(group => group.racks)
  const selectedRack = racks.find(rack => String(rack.id) === trendRackId) || racks[0]
  const trend = records.filter(row => Number(row.rack_id) === Number(selectedRack?.id)).reverse().map(row => ({ ...row, time: parseVietnamDate(row.created_at)?.getTime(), smoke: smokeValue(row.smoke_detected ?? row.smoke) })).filter(row => row.time != null)
  const smokeAlerts = racks.filter(rack => smokeValue(latest.get(Number(rack.id))?.smoke_detected ?? latest.get(Number(rack.id))?.smoke) === 1).length
  const loading = topology.isLoading || history.isLoading
  return <Box>
    <PageHeader title={uiText("Môi trường lưu trữ")} description={uiText("Theo dõi nhiệt độ, độ ẩm, tải trọng và cảnh báo khói theo từng rack.")} action={<Button startIcon={<Refresh />} variant="outlined" disabled={topology.isFetching || history.isFetching} onClick={() => { void topology.refetch(); void history.refetch() }}>{uiText("Làm mới")}</Button>} />
    {(topology.isError || history.isError) && <Alert severity="error" sx={{ mb: 2 }}>{uiText("Không tải đầy đủ dữ liệu môi trường. Vui lòng làm mới.")}</Alert>}
    {smokeAlerts > 0 && <Alert severity="error" sx={{ mb: 2 }}>{uiText("Có")} {smokeAlerts} {uiText("rack báo phát hiện khói trong số đo gần nhất. Kiểm tra thiết bị và khu vực lưu trữ.")}</Alert>}
    <Card sx={{ mb: 2 }}><CardContent><Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1.5}>
      <TextField select size="small" label={uiText("Nhóm tủ")} value={cabinetId} onChange={event => { setCabinetId(event.target.value); setTrendRackId('') }} sx={{ minWidth: { sm: 280 } }}><MenuItem value="all">{uiText("Tất cả nhóm tủ")}</MenuItem>{(topology.data || []).map(group => <MenuItem key={group.cabinet.id} value={String(group.cabinet.id)}>{(group.cabinet.cabinet_name || group.cabinet.cabinet_code)}</MenuItem>)}</TextField>
      <Stack direction="row" spacing={1}><Chip size="small" icon={<SensorsOutlined />} label={uiText("{0} / {1} rack có số đo", racks.filter(rack => latest.has(Number(rack.id))).length, racks.length)} variant="outlined" /><Chip size="small" label={uiText("Cập nhật mỗi 5 giây")} variant="outlined" /></Stack>
    </Stack></CardContent></Card>
    {loading ? <Grid container spacing={1.5}>{Array.from({ length: 6 }, (_, index) => <Grid item xs={12} sm={6} xl={4} key={index}><Skeleton variant="rounded" height={200} /></Grid>)}</Grid> : groups.length === 0 ? <Card><EmptyState text={uiText("Chưa có rack trong nhóm tủ này")} /></Card> : groups.map(({ cabinet, racks }) => <Box key={cabinet.id} sx={{ mb: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}><Typography variant="h6" fontWeight={700}>{(cabinet.cabinet_name || cabinet.cabinet_code)}</Typography><Typography variant="body2" color="text.secondary">{racks.length} rack</Typography></Stack>
      <Grid container spacing={1.5}>{racks.map((rack: any) => {
        const snapshot = latest.get(Number(rack.id))
        const smoke = smokeValue(snapshot?.smoke_detected ?? snapshot?.smoke)
        return <Grid item xs={12} sm={6} xl={4} key={rack.id}><Card sx={{ height: '100%', borderColor: smoke === 1 ? 'error.light' : 'divider' }}><CardContent sx={{ p: 2 }}>
          <Stack direction="row" justifyContent="space-between" spacing={1} sx={{ mb: 1.75 }}><Box><Typography fontWeight={700}>{(rack.rack_name || `Rack ${rack.id}`)}</Typography><Typography variant="caption" color="text.secondary">{uiText("Rack ID")} {rack.id}</Typography></Box><Chip size="small" label={smoke === 1 ? uiText('Phát hiện khói') : smoke === 0 ? uiText('Không có khói') : uiText('Chưa có số đo khói')} color={smoke === 1 ? 'error' : smoke === 0 ? 'success' : 'default'} variant="outlined" /></Stack>
          <Grid container spacing={1}>{[
            { label: 'Nhiệt độ', value: snapshot?.temperature, unit: '°C', icon: ThermostatOutlined, color: '#bb7837' },
            { label: 'Độ ẩm', value: snapshot?.humidity, unit: '%', icon: WaterDropOutlined, color: '#3274ad' },
            { label: 'Tải trọng', value: snapshot?.weight, unit: 'kg', icon: ScaleOutlined, color: '#087c78' }
          ].map(metric => <Grid item xs={4} key={metric.label}><Box sx={{ bgcolor: '#f7fafb', borderRadius: 2, p: 1.25 }}><metric.icon sx={{ fontSize: 20, color: metric.color }} /><Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 0.5 }}>{uiText(metric.label)}</Typography><Typography fontWeight={750} sx={{ mt: 0.5, fontSize: 19 }}>{(metric.value ?? '—')} <Box component="span" sx={{ fontSize: 11, color: 'text.secondary', fontWeight: 400 }}>{metric.unit}</Box></Typography></Box></Grid>)}</Grid>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1.5 }}>{snapshot ? uiText("Số đo gần nhất: {0}", formatDateTime(snapshot.created_at)) : uiText('Chưa nhận được số đo trong 24 giờ qua')}</Typography>
        </CardContent></Card></Grid>
      })}</Grid>{racks.length === 0 && <Typography color="text.secondary">{uiText("Nhóm tủ chưa có rack.")}</Typography>}
    </Box>)}
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1.5} sx={{ mt: 3, mb: 1.5 }}><Box><Typography variant="h6" fontWeight={700}>{uiText("Xu hướng trong 24 giờ")}</Typography><Typography variant="body2" color="text.secondary">{uiText("Số đo của một rack theo thời gian.")}</Typography></Box><TextField select size="small" label={uiText("Rack hiển thị")} value={selectedRack ? String(selectedRack.id) : ''} onChange={event => setTrendRackId(event.target.value)} sx={{ minWidth: 240 }} disabled={!racks.length}>{!racks.length && <MenuItem value="">{uiText("Chưa có rack")}</MenuItem>}{racks.map(rack => <MenuItem key={rack.id} value={String(rack.id)}>{(rack.rack_name || `Rack ${rack.id}`)} · ID {rack.id}</MenuItem>)}</TextField></Stack>
    <Grid container spacing={1.5}>{[true, false].map(climate => <Grid item xs={12} lg={6} key={String(climate)}><Card><CardContent sx={{ p: 2 }}><Typography fontWeight={700} sx={{ mb: 2 }}>{climate ? uiText('Nhiệt độ & độ ẩm') : uiText('Tải trọng & khói')}</Typography>
      {loading ? <Skeleton height={220} variant="rounded" /> : !trend.length ? <EmptyState text={uiText("Chưa có số đo cho rack này")} /> : <ResponsiveContainer width="100%" height={220}><LineChart data={trend} margin={{ right: 8, left: -10 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7eef0" /><XAxis dataKey="time" type="number" domain={['dataMin', 'dataMax']} tickFormatter={value => formatTimeShort(new Date(value).toISOString())} minTickGap={30} tick={{ fontSize: 11 }} />
        <YAxis yAxisId="left" unit={climate ? '°C' : 'kg'} tick={{ fontSize: 11 }} /><YAxis yAxisId="right" orientation="right" unit={climate ? '%' : ''} domain={climate ? [0, 100] : [0, 1]} ticks={climate ? undefined : [0, 1]} tickFormatter={climate ? undefined : value => value === 1 ? uiText('Có khói') : uiText('Không')} tick={{ fontSize: 11 }} />
        <Tooltip labelFormatter={value => formatDateTime(new Date(Number(value)).toISOString())} contentStyle={{ borderRadius: 12, borderColor: '#e0e8eb' }} /><Legend />
        <Line yAxisId="left" dataKey={climate ? 'temperature' : 'weight'} name={climate ? uiText('Nhiệt độ (°C)') : uiText('Tải trọng (kg)')} stroke={climate ? '#bb7837' : '#087c78'} dot={false} strokeWidth={2} />
        <Line yAxisId="right" dataKey={climate ? 'humidity' : 'smoke'} type={climate ? 'linear' : 'stepAfter'} name={climate ? uiText('Độ ẩm (%)') : uiText('Khói (0: không, 1: có)')} stroke={climate ? '#3274ad' : '#c35454'} dot={false} strokeWidth={2} />
      </LineChart></ResponsiveContainer>}
    </CardContent></Card></Grid>)}</Grid>
  </Box>
}
