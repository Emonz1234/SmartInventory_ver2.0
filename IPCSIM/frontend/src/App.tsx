import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { CssBaseline, ThemeProvider, createTheme, Box, TextField, Button, Typography } from '@mui/material'
import { useState } from 'react'
import { EdgeWorkspace } from './pages/EdgeWorkspace'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Layout } from '@components/Layout/Layout'
import { Dashboard, Inventory, Cabinets, CabinetDetail, Transactions, Breakdown, Environment, Logs, Operation, System, Maintenance } from '@pages/index'

const queryClient = new QueryClient()

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#0077a3' },
    secondary: { main: '#ff4081' },
    background: { default: '#f1f8f7', paper: '#ffffff' }
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
    fontSize: 14
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          minHeight: 64,
          borderRadius: 8,
          paddingLeft: 20,
          paddingRight: 20
        }
      }
    }
  }
})

function App() {
  const [authenticated, setAuthenticated] = useState(!!localStorage.getItem('token'))
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  if (!authenticated) return <Box component="form" sx={{ maxWidth: 420, mx: 'auto', mt: 12 }} onSubmit={async e => {
    e.preventDefault()
    try {
      const base = (import.meta as any).env.VITE_EDGE_API_URL || '/api'
      const response = await fetch(base + '/system/health', {headers: {Authorization: `Bearer ${token}`}})
      if (!response.ok) throw new Error('Token không hợp lệ hoặc thiết bị chưa sẵn sàng')
      localStorage.setItem('token', token)
      setAuthenticated(true)
    } catch (err) {setError(String(err))}
  }}><Typography variant="h4">Edge Monitor</Typography><Typography sx={{ my: 2 }}>Nhập token được cấu hình cho thiết bị này.</Typography><TextField label="Edge API token" type="password" value={token} onChange={e => setToken(e.target.value)} fullWidth required /><Button type="submit">Kết nối</Button>{error && <Typography color="error">{error}</Typography>}</Box>
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <QueryClientProvider client={queryClient}>
        <Router basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Layout>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/inventory" element={<EdgeWorkspace />} />
              <Route path="/cabinets" element={<Cabinets />} />
              <Route path="/cabinets/:id" element={<CabinetDetail />} />
              <Route path="/transactions" element={<Transactions />} />
              <Route path="/breakdown" element={<Breakdown />} />
              <Route path="/environment" element={<Environment />} />
              <Route path="/operation" element={<EdgeWorkspace />} />
              <Route path="/logs" element={<Logs />} />
              <Route path="/system" element={<System />} />
              <Route path="/maintenance" element={<System />} />
            </Routes>
          </Layout>
        </Router>
      </QueryClientProvider>
    </ThemeProvider>
  )
}

export default App
