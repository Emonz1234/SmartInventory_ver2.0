import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { cabinetAPI } from '@api/cabinet'
import { Alert, Box, Button, Card, CardContent, Chip, Grid, Stack, Typography } from '@mui/material'

export const CabinetDetail = () => {
  const { id } = useParams(), navigate = useNavigate()
  const query = useQuery({ queryKey: ['cabinet', id, 'racks'], queryFn: async () => (await cabinetAPI.getRacks(Number(id))).data, refetchInterval: 2000 })
  return <Stack spacing={2}>
    <Button onClick={() => navigate('/cabinets')}>Back to cabinets</Button>
    <Typography variant="h4">Cabinet topology and monitoring</Typography>
    <Alert severity="info">Controls require a Server operator account. Inventory changes require a confirmed operation.</Alert>
    <Button variant="contained" onClick={() => navigate(`/operation?cabinet=${id}`)}>Open operator workspace</Button>
    {query.isError && <Alert severity="error">Local API unavailable; retry the connection.</Alert>}
    {!query.isLoading && !query.data?.length && <Alert severity="warning">Rack addresses and compartments await approved hardware configuration.</Alert>}
    <Grid container spacing={2}>{(query.data || []).map((rack: any) => <Grid item xs={12} md={4} key={rack.id}>
      <Card><CardContent><Typography variant="h6">{rack.rack_name || rack.rack_code}</Typography>
        <Chip label={rack.status || 'Unknown'} /><Typography>Serial address: {rack.rack_code}</Typography>
        <Typography>Position: {rack.position ?? '--'}</Typography>
        <Typography>Last sample: {rack.last_updated || '--'}</Typography>
        <Button onClick={() => navigate(`/operation?cabinet=${id}&rack=${rack.id}`)}>Select this rack</Button>
      </CardContent></Card>
    </Grid>)}</Grid>
  </Stack>
}
