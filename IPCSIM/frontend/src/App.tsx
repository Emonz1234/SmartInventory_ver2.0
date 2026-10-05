import { t as uiText, errorText, useLanguage, recordError } from './i18n';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { Alert, Box, CircularProgress, CssBaseline, Stack, ThemeProvider, Typography, createTheme } from '@mui/material'
import { FormEvent, useEffect, useMemo, useState } from 'react'
import { viVN, enUS } from '@mui/material/locale'
import { InventoryWorkspace } from './pages/InventoryWorkspace'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Layout } from '@components/Layout/Layout'
import { Dashboard, Cabinets, CabinetDetail, Transactions, Breakdown, Environment, Operation, System } from '@pages/index'
import api from '@api/client'
import { OperatorLogin } from '@components/OperatorLogin'

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
    primary: { main: '#087c78' },
    secondary: { main: '#ff4081' },
    background: { default: '#f4f7f9', paper: '#ffffff' },
    text: { primary: '#17343a', secondary: '#647a80' },
    divider: '#e0e8eb'
  },
  typography: {
    fontFamily: '"Segoe UI", "Roboto", "Arial", sans-serif',
    fontSize: 14
  },
  components: {
    MuiCardContent: { styleOverrides: { root: { padding: 16, '&:last-child': { paddingBottom: 16 } } } },
    MuiTablePagination: { styleOverrides: { toolbar: { minHeight: 44 } } },
    MuiCard: { defaultProps: { elevation: 0 }, styleOverrides: { root: { borderRadius: 16, border: '1px solid #e0e8eb' } } },
    MuiPaper: { styleOverrides: { rounded: { borderRadius: 12 } } },
    MuiTableCell: { styleOverrides: { root: { borderBottom: '1px solid #edf1f3', padding: '9px 14px' }, head: { backgroundColor: '#f7fafb', color: '#647a80', fontWeight: 700, whiteSpace: 'nowrap', fontSize: 12 } } },
    MuiChip: { styleOverrides: { root: { borderRadius: 8, fontWeight: 600 } } },
    MuiOutlinedInput: { styleOverrides: { root: { borderRadius: 10 } } },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          minHeight: 36,
          borderRadius: 8,
          paddingLeft: 14,
          paddingRight: 14
        }
      }
    }
  }
})

function App() {
  const language = useLanguage();
  const localizedTheme = useMemo(() => createTheme(theme, language === 'vi' ? viVN : enUS), [language])
  const [authenticated, setAuthenticated] = useState(!!localStorage.getItem('token'))
  const [token, setToken] = useState('')
  const [operatorSession, setOperatorSession] = useState(() => localStorage.getItem(OPERATOR_SESSION_KEY) || '')
  const [operatorName, setOperatorName] = useState(() => localStorage.getItem(OPERATOR_NAME_KEY) || '')
  const [operatorPermissions, setOperatorPermissions] = useState<string[]>(readPermissions)
  const [checkingSession, setCheckingSession] = useState(() => !!localStorage.getItem(OPERATOR_SESSION_KEY))
  const [operatorLogin, setOperatorLogin] = useState({ username: '', password: '' })
  const [operatorError, setOperatorError] = useState<any>('')
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
          setSessionWarning('Chưa xác minh được phiên local. Kiểm tra kết nối tới IPC.')
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
        if (!response.ok) {
          let detail = ''
          let responseData: any = {}
          try {
            responseData = await response.json()
            detail = responseData.detail || ''
          } catch {
          }
          if (response.status === 401) {
            localStorage.removeItem('token')
            setToken('')
            setAuthenticated(false)
          }
          throw recordError(Object.assign(new Error(detail || 'Edge API token không hợp lệ hoặc thiết bị chưa sẵn sàng.'), { response: { status: response.status, data: responseData } }))
        }
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
      setOperatorError(failure || 'Đăng nhập local thất bại; kiểm tra tài khoản đã đồng bộ về IPC.')
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
  if (checkingSession) return <ThemeProvider theme={localizedTheme}><CssBaseline /><Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', p: 2 }}><Stack alignItems="center" spacing={2}><CircularProgress /><Typography>{uiText("Đang xác minh phiên đăng nhập")}</Typography></Stack></Box></ThemeProvider>

  if (!authenticated || !operatorSession) return <ThemeProvider theme={localizedTheme}><CssBaseline />
    <OperatorLogin authenticated={authenticated} token={token} onTokenChange={setToken} login={operatorLogin} onLoginChange={setOperatorLogin} error={operatorError} busy={operatorBusy} onSubmit={submitOperatorLogin} />
  </ThemeProvider>

  return (
    <ThemeProvider theme={localizedTheme}>
      <CssBaseline />
      <QueryClientProvider client={queryClient}>
        <Router basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Layout operatorName={operatorName} onLogout={() => void logoutOperator()}>
            {sessionWarning && <Alert severity="warning" sx={{ mb: 2 }}>{errorText(sessionWarning)}</Alert>}
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/inventory" element={<InventoryWorkspace session={operatorSession} permissions={operatorPermissions} onSessionExpired={expireOperatorSession} />} />
              <Route path="/cabinets" element={<Cabinets />} />
              <Route path="/cabinets/:id" element={<CabinetDetail session={operatorSession} permissions={operatorPermissions} onSessionExpired={expireOperatorSession} />} />
              <Route path="/transactions" element={<Transactions session={operatorSession} onSessionExpired={expireOperatorSession} />} />
              <Route path="/breakdown" element={<Breakdown />} />
              <Route path="/environment" element={<Environment />} />
              <Route path="/operation" element={<Operation />} />
              <Route path="/logs" element={<Navigate to="/breakdown" replace />} />
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
