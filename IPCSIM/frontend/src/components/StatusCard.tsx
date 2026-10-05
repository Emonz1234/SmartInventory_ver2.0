import { t as uiText, useLanguage } from '../i18n';
import { Card, CardContent, Typography, Box, Chip } from '@mui/material'

interface StatusCardProps {
  title: string
  value: string | number
  unit?: string
  status?: 'success' | 'warning' | 'error' | 'info'
  color?: string
}

const statusColors = {
  success: '#4caf50',
  warning: '#ff9800',
  error: '#f44336',
  info: '#2196f3'
}

export const StatusCard = ({ title, value, unit, status, color }: StatusCardProps) => {
  useLanguage();
  return (
    <Card>
      <CardContent>
        <Typography variant="caption" color="textSecondary" display="block" sx={{ mb: 1 }}>
          {uiText(title)}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
            {value}
          </Typography>
          {unit && (
            <Typography variant="body2" color="textSecondary">
              {unit}
            </Typography>
          )}
        </Box>
        {status && (
          <Chip
            label={uiText(status)}
            size="small"
            color={status === 'error' ? 'error' : status === 'warning' ? 'warning' : 'success'}
          />
        )}
      </CardContent>
    </Card>
  )
}
