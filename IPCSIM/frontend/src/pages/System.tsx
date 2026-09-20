import { useQuery } from '@tanstack/react-query'
import { Alert, Stack, Typography } from '@mui/material'
import { systemAPI } from '@api/system'

export const System = () => {
  const state = useQuery({ queryKey: ['system-health'], queryFn: async () => (await systemAPI.getSystemHealth()).data, refetchInterval: 2000 })
  return <Stack spacing={2}><Typography variant="h4">Local runtime</Typography>
    <Alert severity="info">Connection settings come from this instance environment file. Master data is managed on Server.</Alert>
    {state.isError && <Alert severity="error">Local API is unavailable.</Alert>}
    <pre style={{whiteSpace: 'pre-wrap'}}>{JSON.stringify(state.data || {}, null, 2)}</pre>
  </Stack>
}
