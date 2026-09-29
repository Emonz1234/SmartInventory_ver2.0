import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { Alert, Box, Button, CircularProgress, CssBaseline, Stack, TextField, ThemeProvider, Typography, createTheme } from '@mui/material'
import { FormEvent, useEffect, useState } from 'react'
import { EdgeWorkspace } from './pages/EdgeWorkspace'
import { InventoryWorkspace } from './pages/InventoryWorkspace'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Layout } from '@components/Layout/Layout'
import { Dashboard, Cabinets, CabinetDetail, Transactions, Breakdown, Environment, Logs, Operation, System, Maintenance } from '@pages/index'
import api from '@api/client'

const OPERATOR_SESSION_KEY = 'edgeOperatorSession'
const OPERATOR_PERMISSIONS_KEY = 'edgeOperatorPermissions'
const OPERATOR_NAME_KEY = 'edgeOperatorName'

function readPermissions() {
  try {
    const permissions: unknown = JSON.parse(localStorage.getItem(OPERATOR_PERMISSIONS_KEY) || '[]')
    return Array.isArray(permissions) && permissions.every(value => typeof value === 'string') ? permissions : []
  } catch {
    return []
  }
}

function clearSavedOperatorSession() {
  localStorage.removeItem(OPERATOR_SESSION_KEY)
  localStorage.removeItem(OPERATOR_PERMISSIONS_KEY)
  localStorage.removeItem(OPERATOR_NAME_KEY)
}

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
  const [operatorSession, setOperatorSession] = useState(() => localStorage.getItem(OPERATOR_SESSION_KEY) || '')
  const [operatorName, setOperatorName] = useState(() => localStorage.getItem(OPERATOR_NAME_KEY) || '')
  const [operatorPermissions, setOperatorPermissions] = useState<string[]>(readPermissions)
  const [checkingSession, setCheckingSession] = useState(() => !!localStorage.getItem(OPERATOR_SESSION_KEY))
  const [operatorLogin, setOperatorLogin] = useState({ username: '', password: '' })
  const [operatorError, setOperatorError] = useState('')
  const [operatorBusy, setOperatorBusy] = useState(false)
  const [sessionWarning, setSessionWarning] = useState('')

  useEffect(() => {
    if (!authenticated || !operatorSession) {
      setCheckingSession(false)
      return
    }
    let cancelled = false
    setCheckingSession(true)
    api.get('/operator/session', { headers: { 'X-Operator-Session': operatorSession } })
      .then(({ data }) => {
        if (cancelled) return
        const permissions = data.permissions || []
        setOperatorName(data.username || '')
        setOperatorPermissions(permissions)
        localStorage.setItem(OPERATOR_NAME_KEY, data.username || '')
        localStorage.setItem(OPERATOR_PERMISSIONS_KEY, JSON.stringify(permissions))
        setSessionWarning('')
      })
      .catch((failure: any) => {
        if (cancelled) return
        if (failure.response?.status === 403) {
          clearSavedOperatorSession()
          setOperatorSession('')
          setOperatorName('')
          setOperatorPermissions([])
          setOperatorError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.')
        } else {
          setSessionWarning('Chưa xác minh được phiên với Server. Có thể xem cache; thao tác cần Server sẽ chờ kết nối.')
        }
      })
      .finally(() => { if (!cancelled) setCheckingSession(false) })
    return () => { cancelled = true }
  }, [authenticated, operatorSession])

  async function submitOperatorLogin(event: FormEvent) {
    event.preventDefault()
    setOperatorBusy(true)
    setOperatorError('')
    try {
      if (!authenticated) {
        const base = (import.meta as any).env.VITE_EDGE_API_URL || '/api'
        const response = await fetch(base + '/system/health', { headers: { Authorization: `Bearer ${token}` } })
        if (!response.ok) throw new Error('Edge API token không hợp lệ hoặc thiết bị chưa sẵn sàng.')
        localStorage.setItem('token', token)
        setAuthenticated(true)
      }
      const { data } = await api.post('/operator/login', operatorLogin)
      const permissions = data.permissions || []
      localStorage.setItem(OPERATOR_SESSION_KEY, data.session)
      localStorage.setItem(OPERATOR_PERMISSIONS_KEY, JSON.stringify(permissions))
      localStorage.setItem(OPERATOR_NAME_KEY, operatorLogin.username)
      setOperatorSession(data.session)
      setOperatorName(operatorLogin.username)
      setOperatorPermissions(permissions)
      setOperatorLogin({ username: operatorLogin.username, password: '' })
      setSessionWarning('')
    } catch (failure: any) {
      setOperatorError(failure.response?.data?.detail || failure.message || 'Đăng nhập thất bại hoặc Server không truy cập được.')
    } finally {
      setOperatorBusy(false)
    }
  }

  async function logoutOperator() {
    try {
      await api.post('/operator/logout', {}, { headers: { 'X-Operator-Session': operatorSession } })
    } catch {
      setSessionWarning('Không liên hệ được IPC để thu hồi phiên; dữ liệu đăng nhập cục bộ đã được xóa.')
    } finally {
      clearSavedOperatorSession()
      setOperatorSession('')
      setOperatorName('')
      setOperatorPermissions([])
      setOperatorError('')
    }
  }

  function expireOperatorSession() {
    clearSavedOperatorSession()
    setOperatorSession('')
    setOperatorName('')
    setOperatorPermissions([])
    setOperatorError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.')
  }
  if (checkingSession) return <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><Stack alignItems="center" spacing={2}><CircularProgress /><Typography>Đang xác minh phiên đăng nhập</Typography></Stack></Box>

  if (!authenticated || !operatorSession) return <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', px: 2 }}>
    <Box component="form" onSubmit={submitOperatorLogin} sx={{ width: '100%', maxWidth: 400 }}>
      <Typography variant="h4" sx={{ mb: 1 }}>Đăng nhập vận hành</Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>Đăng nhập bằng tài khoản Server để tiếp tục vào IPC/IPCSIM.</Typography>
      {operatorError && <Alert severity="error" sx={{ mb: 2 }}>{operatorError}</Alert>}
      <Stack spacing={2}>
        {!authenticated && <TextField label="Edge API token" type="password" autoComplete="off" value={token} onChange={event => setToken(event.target.value)} required />}
        <TextField label="Tên đăng nhập" autoComplete="username" value={operatorLogin.username} onChange={event => setOperatorLogin({ ...operatorLogin, username: event.target.value })} required autoFocus />
        <TextField label="Mật khẩu" type="password" autoComplete="current-password" value={operatorLogin.password} onChange={event => setOperatorLogin({ ...operatorLogin, password: event.target.value })} required />
        <Button type="submit" variant="contained" disabled={operatorBusy}>{operatorBusy ? 'Đang đăng nhập…' : 'Đăng nhập'}</Button>
      </Stack>
    </Box>
  </Box>

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <QueryClientProvider client={queryClient}>
        <Router basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Layout operatorName={operatorName} onLogout={() => void logoutOperator()}>
            {sessionWarning && <Alert severity="warning" sx={{ mb: 2 }}>{sessionWarning}</Alert>}
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/inventory" element={<InventoryWorkspace session={operatorSession} permissions={operatorPermissions} onSessionExpired={expireOperatorSession} />} />
              <Route path="/cabinets" element={<Cabinets />} />
              <Route path="/cabinets/:id" element={<CabinetDetail session={operatorSession} permissions={operatorPermissions} onSessionExpired={expireOperatorSession} />} />
              <Route path="/transactions" element={<Transactions />} />
              <Route path="/breakdown" element={<Breakdown />} />
              <Route path="/environment" element={<Environment />} />
              <Route path="/operation" element={<EdgeWorkspace session={operatorSession} permissions={operatorPermissions} onSessionExpired={expireOperatorSession} />} />
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
