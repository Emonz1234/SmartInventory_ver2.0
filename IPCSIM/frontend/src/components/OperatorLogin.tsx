import { FormEvent, useState } from 'react'
import { Alert, Box, Button, CircularProgress, IconButton, InputAdornment, Paper, Stack, TextField, Typography } from '@mui/material'
import { ArrowForward, Inventory2Outlined, KeyOutlined, LockOutlined, PersonOutline, VisibilityOffOutlined, VisibilityOutlined } from '@mui/icons-material'

type Props = {
  authenticated: boolean
  token: string
  onTokenChange: (value: string) => void
  login: { username: string; password: string }
  onLoginChange: (value: { username: string; password: string }) => void
  error: string
  busy: boolean
  onSubmit: (event: FormEvent) => void
}

export function OperatorLogin({ authenticated, token, onTokenChange, login, onLoginChange, error, busy, onSubmit }: Props) {
  const [showPassword, setShowPassword] = useState(false)

  return <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', p: { xs: 2, sm: 3 }, background: 'radial-gradient(ellipse at top left, #e3f1ef 0%, #f4f7f9 55%)' }}>
    <Box sx={{ width: '100%', maxWidth: 440 }}>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2.5 }}>
        <Box sx={{ width: 44, height: 44, display: 'grid', placeItems: 'center', bgcolor: 'primary.main', color: 'white', borderRadius: 2.5 }}><Inventory2Outlined /></Box>
        <Box><Typography fontWeight={750}>Smart Inventory</Typography><Typography variant="body2" color="text.secondary">IPCSIM · Mô phỏng vận hành</Typography></Box>
      </Stack>

      <Paper component="form" onSubmit={onSubmit} elevation={0} sx={{ p: { xs: 2.5, sm: 3 }, border: '1px solid', borderColor: 'divider', borderRadius: 3, boxShadow: '0 12px 40px #17343a08' }}>
        <Stack spacing={0.75} sx={{ mb: 2.5 }}>
          <Typography component="h1" sx={{ fontSize: 26, fontWeight: 750, letterSpacing: '-0.025em' }}>Đăng nhập vận hành</Typography>
          <Typography variant="body2" color="text.secondary">Sử dụng tài khoản Server đã đồng bộ về IPC để tiếp tục.</Typography>
        </Stack>
        {error && <Alert severity="error" sx={{ mb: 2, overflowWrap: 'anywhere' }}>{error}</Alert>}
        <Stack spacing={2}>
          {!authenticated && <TextField label="Edge API token" type="password" size="small" autoComplete="off" value={token} onChange={event => onTokenChange(event.target.value)} required fullWidth helperText="Nhập token được cấu hình cho thiết bị IPCSIM." InputProps={{ startAdornment: <InputAdornment position="start"><KeyOutlined fontSize="small" /></InputAdornment> }} />}
          <TextField label="Tên đăng nhập" size="small" autoComplete="username" value={login.username} onChange={event => onLoginChange({ ...login, username: event.target.value })} required autoFocus fullWidth InputProps={{ startAdornment: <InputAdornment position="start"><PersonOutline fontSize="small" /></InputAdornment> }} />
          <TextField label="Mật khẩu" size="small" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={login.password} onChange={event => onLoginChange({ ...login, password: event.target.value })} required fullWidth InputProps={{
            startAdornment: <InputAdornment position="start"><LockOutlined fontSize="small" /></InputAdornment>,
            endAdornment: <InputAdornment position="end"><IconButton aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)} onMouseDown={event => event.preventDefault()} edge="end" sx={{ width: 40, height: 40 }}>{showPassword ? <VisibilityOffOutlined fontSize="small" /> : <VisibilityOutlined fontSize="small" />}</IconButton></InputAdornment>
          }} />
          <Button type="submit" variant="contained" disabled={busy} fullWidth startIcon={busy ? <CircularProgress size={18} color="inherit" /> : undefined} endIcon={busy ? undefined : <ArrowForward fontSize="small" />} sx={{ minHeight: 44, boxShadow: 'none' }}>{busy ? 'Đang đăng nhập…' : 'Đăng nhập'}</Button>
        </Stack>
      </Paper>
      <Typography variant="body2" color="text.secondary" textAlign="center" sx={{ mt: 2 }}>Quản lý kho hàng · Điều khiển tủ & rack</Typography>
    </Box>
  </Box>
}
