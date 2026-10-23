import { t as uiText } from '../i18n';
import { ReactNode } from 'react'
import { Box, Stack, Typography } from '@mui/material'

export const PageHeader = ({ title, description, action }: { title: string; description: string; action?: ReactNode }) => (
  <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1.5} sx={{ mb: 1.5 }}>
    <Box sx={{minWidth:0}}>
      <Typography variant="h4" sx={{ fontWeight: 750, letterSpacing: '-0.035em', fontSize: { xs: 26, md: 28 } }}>{uiText(title)}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 860 }}>{uiText(description)}</Typography>
    </Box>{action}
  </Stack>
)

export const EmptyState = ({ text }: { text: string }) => <Box sx={{ py: 3, textAlign: 'center' }}><Typography fontWeight={600}>{uiText(text)}</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{uiText("Thử đổi bộ lọc hoặc chờ dữ liệu mới.")}</Typography></Box>
