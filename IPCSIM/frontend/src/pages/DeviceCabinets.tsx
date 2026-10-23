import { useQuery } from '@tanstack/react-query'
import { Alert, CircularProgress } from '@mui/material'
import api from '@api/client'
import { cabinetAPI } from '@api/cabinet'
import { Cabinets } from './Cabinets'
import { CabinetDetail } from './CabinetDetail'
import { useLanguage } from '../i18n'

// Both launchers serve this bundle; resolve topology from the connected edge.
export function DeviceCabinets(props: { session: string; permissions: string[]; onSessionExpired: () => void }) {
  const language = useLanguage()
  const health = useQuery({ queryKey: ['header-health'], queryFn: async () => (await api.get('/system/health')).data, refetchInterval: 2000 })
  const cabinets = useQuery({ queryKey: ['cabinets', 'list'], queryFn: async () => (await cabinetAPI.list()).data, refetchInterval: 2000 })
  if (health.isError || cabinets.isError) return <Alert severity="error">{language === 'vi' ? 'Không tải được thông tin tủ. Vui lòng thử lại.' : 'Unable to load cabinet information. Please retry.'}</Alert>
  if (!health.data || !cabinets.data) return <CircularProgress />
  if (health.data.device_type !== 'IPC') return <Cabinets />
  if (!cabinets.data.length) return <Alert severity="info">{language === 'vi' ? 'Chờ Server đồng bộ tủ IPC và 6 rack.' : 'Waiting for the Server to synchronize the IPC cabinet and its six racks.'}</Alert>
  if (cabinets.data.length !== 1 || cabinets.data[0].rack_count !== 6) return <Alert severity="error">{language === 'vi' ? 'Cấu hình IPC cần đúng 1 tủ và 6 rack. Kiểm tra danh mục tại Server.' : 'IPC requires exactly one cabinet and six racks. Check the Server catalog.'}</Alert>
  return <CabinetDetail {...props} cabinetId={String(cabinets.data[0].id)} />
}
