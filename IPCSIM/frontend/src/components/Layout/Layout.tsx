import { Box, Alert, Link } from '@mui/material'
import { Header } from './Header'
import { Sidebar, DRAWER_WIDTH } from './Sidebar'

interface LayoutProps {
  children: React.ReactNode
}

export const Layout = ({ children }: LayoutProps) => {
  return (
    <Box sx={{ display: 'flex', height: '100vh' }}>
      <Header />
      <Box sx={{ display: 'flex', width: '100%', mt: '64px' }}>
        <Sidebar />
        <Box
          component="main"
          sx={{
            flexGrow: 1,
            p: 3,
            width: { xs: '100%', sm: `calc(100% - ${DRAWER_WIDTH}px)` },
            backgroundColor: '#f1f8f7',
            overflowY: 'auto',
            height: `calc(100vh - 64px)`
          }}
        >
          <Alert severity="info" sx={{ mb: 2 }}>
            Dữ liệu cục bộ đồng bộ từ Server. Chọn Inventory hoặc Operation để đăng nhập tài khoản vận hành; quản trị danh mục tại Server.
            {(import.meta as any).env.VITE_SERVER_UI_URL && <Link sx={{ ml: 1 }} href={(import.meta as any).env.VITE_SERVER_UI_URL}>Mở Control Center</Link>}
          </Alert>
          {children}
        </Box>
      </Box>
    </Box>
  )
}
