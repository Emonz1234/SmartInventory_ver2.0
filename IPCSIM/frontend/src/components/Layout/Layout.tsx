import { t as uiText, useLanguage } from '../../i18n';
import { useState } from 'react'
import { Box, Link, Typography } from '@mui/material'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
interface LayoutProps { children: React.ReactNode; operatorName: string; onLogout: () => void }
export const Layout = ({ children, operatorName, onLogout }: LayoutProps) => {
  useLanguage();
  const [mobileOpen, setMobileOpen] = useState(false)
  return <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
    <Header operatorName={operatorName} onLogout={onLogout} onMenu={() => setMobileOpen(true)} />
    <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
    <Box component="main" sx={{ flex: 1, minWidth: 0, mt: '64px', p: { xs: 1.5, sm: 2, xl: 2.5 } }}>
      <Box sx={{ maxWidth: 1600, mx: 'auto' }}>{children}</Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>Smart Inventory · IPCSIM
        {(import.meta as any).env.VITE_SERVER_UI_URL && <Link sx={{ ml: 2 }} href={(import.meta as any).env.VITE_SERVER_UI_URL}>{uiText("Mở Control Center")}</Link>}
      </Typography>
    </Box>
  </Box>
}
