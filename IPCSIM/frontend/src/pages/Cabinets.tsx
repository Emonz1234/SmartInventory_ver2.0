import { useState } from 'react'
import {
  Box,
  Card,
  CardContent,
  Grid,
  Typography,
  Button,
  Stack,
  Chip,
  Divider,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Skeleton,
  Alert
} from '@mui/material'
import { Home, Air, ArrowForward, Storage, Tune } from '@mui/icons-material'
import { useAuthStore } from '@store/authStore'
import { Link as RouterLink } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { cabinetAPI } from '@api/cabinet'

export const Cabinets = () => {
  const [actionLoading, setActionLoading] = useState<number | null>(null)
  const [selectedCabinetId, setSelectedCabinetId] = useState('all')
  const canAccess = useAuthStore((s) => s.canAccess)

  const isMaintenanceMode = canAccess('MAINTENANCE')

  const handleVentilate = async (cabinet: any) => {
    if (String(cabinet.status || '').toLowerCase() !== 'active') return

    const cabinetId = cabinet.id
    setActionLoading(cabinetId)
    try {
      await cabinetAPI.ventilateCabinet(cabinetId)
    } catch (err) {
      console.error(err)
    } finally {
      setActionLoading(null)
    }
  }

  const q = useQuery({
    queryKey: ['cabinets', 'list'],
    queryFn: async () => {
      const resp = await cabinetAPI.list()
      return resp.data
    },
    refetchInterval: 2000
  })

  const cabinets: any[] = q.data ?? []
  const visibleCabinets = cabinets.filter((cabinet) => (
    selectedCabinetId === 'all' || String(cabinet.id) === selectedCabinetId
  ))
  const totalRacks = cabinets.reduce((total, cabinet) => total + (cabinet.rack_count || 0), 0)
  const onlineCabinets = cabinets.filter((cabinet) => String(cabinet.status || '').toLowerCase() === 'active').length

  return (
    <Box>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'center' }} spacing={2} sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold', letterSpacing: '-0.02em' }}>
            Cabinet Control
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            Monitor cabinet groups and control rack ventilation.
          </Typography>
        </Box>
        {cabinets.length > 0 && (
          <FormControl size="small" sx={{ minWidth: { xs: '100%', md: 260 } }}>
            <InputLabel id="cabinet-group-filter-label">Cabinet group</InputLabel>
            <Select
              labelId="cabinet-group-filter-label"
              value={selectedCabinetId}
              label="Cabinet group"
              onChange={(event) => setSelectedCabinetId(event.target.value)}
              startAdornment={<Tune color="action" sx={{ mr: 1 }} />}
            >
              <MenuItem value="all">All cabinet groups</MenuItem>
              {cabinets.map((cabinet) => (
                <MenuItem key={cabinet.id} value={String(cabinet.id)}>
                  {cabinet.cabinet_name || cabinet.cabinet_code || `Cabinet ${cabinet.id}`}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
      </Stack>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={4}>
          <Card sx={{ bgcolor: 'primary.main', color: 'primary.contrastText' }}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Box>
                  <Typography variant="body2" sx={{ opacity: 0.8 }}>Cabinet groups</Typography>
                  <Typography variant="h4" sx={{ fontWeight: 'bold', mt: 0.5 }}>{cabinets.length}</Typography>
                </Box>
                <Storage sx={{ fontSize: 40, opacity: 0.75 }} />
              </Stack>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card>
            <CardContent>
              <Typography variant="body2" color="text.secondary">Total racks</Typography>
              <Typography variant="h4" sx={{ fontWeight: 'bold', mt: 0.5 }}>{totalRacks}</Typography>
              <Typography variant="caption" color="text.secondary">Across all groups</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card>
            <CardContent>
              <Typography variant="body2" color="text.secondary">Active groups</Typography>
              <Typography variant="h4" sx={{ fontWeight: 'bold', mt: 0.5 }}>{onlineCabinets}</Typography>
              <Typography variant="caption" color="text.secondary">Based on current status</Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {q.isLoading ? (
        <Grid container spacing={2}>
          {Array.from({ length: 4 }).map((_, index) => (
            <Grid item xs={12} sm={6} lg={4} key={index}>
              <Skeleton variant="rounded" height={300} />
            </Grid>
          ))}
        </Grid>
      ) : q.isError ? (
        <Alert severity="error">Unable to load cabinet groups. Please try again.</Alert>
      ) : visibleCabinets.length === 0 ? (
        <Alert severity="info">No cabinet group matches the selected filter.</Alert>
      ) : (
        <Grid container spacing={2}>
          {visibleCabinets.map((cabinet: any) => {
            const name = cabinet.cabinet_name || cabinet.cabinet_code || `Cabinet ${cabinet.id}`
            const code = cabinet.cabinet_code || cabinet.code || `CB-${cabinet.id}`
            const status = cabinet.status || 'Unknown'
            const isActive = String(status).toLowerCase() === 'active'
            const statusColor = isActive ? 'success' : 'default'

            return (
              <Grid item xs={12} sm={6} lg={4} key={cabinet.id}>
                <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', borderTop: '4px solid', borderColor: 'primary.main' }}>
                  <CardContent sx={{ flexGrow: 1 }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="h6" noWrap title={name}>{name}</Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{code}</Typography>
                      </Box>
                      <Chip label={isActive ? 'Active' : 'Inactive'} color={statusColor} size="small" />
                    </Stack>

                    <Divider sx={{ my: 2 }} />

                    <Stack direction="row" alignItems="center" spacing={1.5}>
                      <Box sx={{ p: 1.25, borderRadius: 2, bgcolor: 'primary.50', color: 'primary.main', display: 'flex' }}>
                        <Storage />
                      </Box>
                      <Box>
                        <Typography variant="h5" sx={{ fontWeight: 'bold', lineHeight: 1 }}>{cabinet.rack_count || 0}</Typography>
                        <Typography variant="caption" color="text.secondary">Racks in this group</Typography>
                      </Box>
                    </Stack>
                  </CardContent>
                  <CardContent sx={{ pt: 0 }}>
                    <Stack direction="row" spacing={1}>
                      <Button
                        component={RouterLink}
                        to={`/cabinets/${cabinet.id}`}
                        variant="contained"
                        size="small"
                        endIcon={<ArrowForward />}
                        sx={{ flex: 1, minHeight: 42 }}
                      >
                        View racks
                      </Button>
                      {isMaintenanceMode && (
                        <Button variant="outlined" size="small" startIcon={<Home />} sx={{ minHeight: 42, minWidth: 42, px: 1.5 }}>
                          Home
                        </Button>
                      )}
                    </Stack>
                    <Button
                      variant="outlined"
                      color="info"
                      fullWidth
                      startIcon={<Air />}
                      component={RouterLink}
                      to={`/operation?cabinet=${cabinet.id}`}
                      sx={{ mt: 1, minHeight: 42 }}
                    >
                      Operator workspace
                    </Button>
                  </CardContent>
                </Card>
              </Grid>
            )
          })}
        </Grid>
      )}
    </Box>
  )
}
