import { ReactNode } from 'react'
import { Box, Stack, Typography } from '@mui/material'

export const PageHeader = ({ title, description, action }: { title: string; description: string; action?: ReactNode }) => (
  <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1.5} sx={{ mb: 2 }}>
    <Box><Typography variant="overline" color="primary.main" sx={{ fontWeight: 700, letterSpacing: 1.8 }}>IPCSIM / GIÁM SÁT</Typography>
      <Typography variant="h4" sx={{ fontWeight: 750, letterSpacing: '-0.035em', fontSize: { xs: 26, md: 32 } }}>{title}</Typography>
      <Typography color="text.secondary" sx={{ mt: 0.75, maxWidth: 720 }}>{description}</Typography>
    </Box>{action}
  </Stack>
)

export const EmptyState = ({ text }: { text: string }) => <Box sx={{ py: 3, textAlign: 'center' }}><Typography fontWeight={600}>{text}</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>Thử đổi bộ lọc hoặc chờ dữ liệu mới.</Typography></Box>
