import { t as uiText, useLanguage } from '../i18n';
import { Box, Card, CardContent, Typography, Button, Stack, TextField, Alert } from '@mui/material'
import { useAuthStore } from '@store/authStore'
import { Warning } from '@mui/icons-material'

export const Maintenance = () => {
  useLanguage();
  const canAccess = useAuthStore((s) => s.canAccess)

  if (!canAccess('MAINTENANCE')) {
    return (
      <Box>
        <Alert severity="error">{uiText("Access Denied: This section is for Maintenance personnel only")}</Alert>
      </Box>
    )
  }

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 3, fontWeight: 'bold' }}> {uiText("Hardware Maintenance")} </Typography>

      {/* Rack Control */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Warning color="warning" /> {uiText("Manual Rack Control")} </Typography>
          <Stack spacing={2}>
            <TextField label={uiText("Rack Code")} defaultValue="A-R01" fullWidth size="small" />
            <TextField label={uiText("Speed")} type="number" defaultValue="50" fullWidth size="small" />
            <Stack direction="row" spacing={1}>
              <Button variant="outlined" fullWidth> {uiText("Move Left")} </Button>
              <Button variant="outlined" fullWidth> {uiText("Stop")} </Button>
              <Button variant="outlined" fullWidth> {uiText("Move Right")} </Button>
              <Button variant="outlined" fullWidth> {uiText("Home")} </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {/* Diagnostics */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}> {uiText("System Diagnostics")} </Typography>
          <Stack spacing={1}>
            <Button variant="outlined" fullWidth> {uiText("Test Serial Communication")} </Button>
            <Button variant="outlined" fullWidth> {uiText("Check Sensor Calibration")} </Button>
            <Button variant="outlined" fullWidth> {uiText("Verify Database Integrity")} </Button>
          </Stack>
        </CardContent>
      </Card>

      {/* Firmware */}
      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}> {uiText("Firmware Update")} </Typography>
          <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}> {uiText("Current firmware version: v1.2.3")} </Typography>
          <Button variant="contained" fullWidth> {uiText("Check for Updates")} </Button>
        </CardContent>
      </Card>
    </Box>
  )
}
