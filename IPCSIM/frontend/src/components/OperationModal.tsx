import { t as uiText, useLanguage } from '../i18n';
import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  Card,
  CardContent,
  Stack,
  Button,
  CircularProgress,
  Alert,
  List,
  ListItem,
  ListItemText,
  Chip
} from '@mui/material'
import { CheckCircle, Error } from '@mui/icons-material'
import { useQuery } from '@tanstack/react-query'
import { systemAPI } from '@api/system'

interface OperationModalProps {
  open: boolean
  cabinetId: number | null
  rackId: number | null
  operation: 'open' | 'close' | 'ventilate' | null // open/close rack, ventilate cabinet
  cabinetCode?: string
  racks?: Array<{ id: number; rack_code: string }>
  onClose: () => void
}

export const OperationModal = ({
  open,
  rackId,
  operation,
  cabinetCode,
  racks = [],
  onClose
}: OperationModalProps) => {
  useLanguage();
  const [isComplete, setIsComplete] = useState(false)
  const [hasError, setHasError] = useState(false)
  const [, setCompletionTime] = useState<number | null>(null)
  const [operationStartTime, setOperationStartTime] = useState<number | null>(null)
  const [operationSessionId, setOperationSessionId] = useState<number>(Date.now())

  const getEventTime = (value: string | null | undefined) => {
    if (!value) return 0
    const parsed = new Date(value).getTime()
    return Number.isNaN(parsed) ? 0 : parsed
  }

  const resetStatuses = () => {
    setIsComplete(false)
    setHasError(false)
    setCompletionTime(null)
    setOperationStartTime(null)
    setOperationSessionId(Date.now() + Math.random())
  }

  useEffect(() => {
    if (!open) {
      resetStatuses()
      return
    }

    if (operationStartTime === null) {
      const nextStart = Date.now()
      setOperationStartTime(nextStart)
      setOperationSessionId(nextStart + Math.random())
    }
  }, [open, operationStartTime])

  // Poll operation data to detect when the simulator confirms the endpoint was reached.
  const operationQuery = useQuery({
    queryKey: ['operationData', 'polling', rackId, operation, operationSessionId],
    queryFn: async () => {
      const resp = await systemAPI.getOperationData(20)
      return resp.data.data
    },
    enabled: open && !isComplete && (operation === 'open' || operation === 'close'),
    refetchInterval: 500,
    staleTime: 100
  })

  const isFinalOperationComplete = (entry: any) => {
    if (!entry || Number(entry.rack_id) !== Number(rackId)) return false
    if (operationStartTime !== null && getEventTime(entry.created_at) < operationStartTime) return false

    const isEndpoint = Number(entry.is_endpoint ?? 0) === 1
    const state = Number(entry.state ?? -1)
    const movementSpeed = Number(entry.movement_speed ?? 0)
    const displacement = Number(entry.displacement ?? 0)

    return isEndpoint && (state === -1 || movementSpeed === 0 || displacement === 0 || displacement >= 64)
  }

  useEffect(() => {
    if (!open || !operationQuery.data || isComplete) return

    if (rackId && (operation === 'open' || operation === 'close')) {
      const finalEntry = [...operationQuery.data]
        .filter((entry: any) => Number(entry.rack_id) === Number(rackId))
        .filter((entry: any) => {
          if (operationStartTime === null) return true
          return getEventTime(entry.created_at) >= operationStartTime
        })
        .sort((a: any, b: any) => Number(b.id ?? 0) - Number(a.id ?? 0))[0]

      if (finalEntry && isFinalOperationComplete(finalEntry)) {
        setIsComplete(true)
        setCompletionTime(Date.now())
      }
    }
  }, [operationQuery.data, rackId, operation, isComplete, open, operationStartTime])

  const getTitle = () => {
    if (operation === 'ventilate') return `Ventilating Cabinet`
    return operation === 'open' ? 'Opening Rack' : 'Closing Rack'
  }

  const getAffectedRacks = () => {
    if (operation === 'ventilate' && racks.length > 0) {
      return racks
    }
    if (rackId && racks.length > 0) {
      return racks.filter((r) => r.id === rackId)
    }
    return []
  }

  const affectedRacks = getAffectedRacks()

  return (
    <Dialog
      open={open}
      onClose={() => !isComplete && onClose()}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 2
        }
      }}
    >
      <DialogTitle sx={{ fontWeight: 'bold', pb: 1 }}>
        {uiText(getTitle())}
      </DialogTitle>

      <DialogContent sx={{ pt: 2 }}>
        {isComplete ? (
          <Box sx={{ textAlign: 'center', py: 3 }}>
            <CheckCircle sx={{ fontSize: 80, color: 'green', mb: 2 }} />
            <Typography variant="h5" sx={{ fontWeight: 'bold', mb: 1 }}>
              {operation === 'open' ? uiText('Rack Opened Successfully!') : operation === 'close' ? uiText('Rack Closed Successfully!') : uiText('Ventilation Complete!')}
            </Typography>
            <Typography variant="body2" color="textSecondary"> {uiText("Simulation ACK confirmed. The rack reached the endpoint successfully.")} </Typography>
          </Box>
        ) : hasError ? (
          <Box sx={{ textAlign: 'center', py: 3 }}>
            <Error sx={{ fontSize: 80, color: 'red', mb: 2 }} />
            <Typography variant="h5" sx={{ fontWeight: 'bold', mb: 1 }}> {uiText("Operation Failed")} </Typography>
            <Typography variant="body2" color="error"> {uiText("An error occurred during the operation")} </Typography>
          </Box>
        ) : (
          <Stack spacing={3}>
            {/* Cabinet info */}
            {cabinetCode && (
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="subtitle2" color="textSecondary" sx={{ mb: 1 }}> {uiText("Cabinet")} </Typography>
                  <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                    {cabinetCode}
                  </Typography>
                </CardContent>
              </Card>
            )}

            {/* Affected racks */}
            {affectedRacks.length > 0 && (
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}> {uiText("Affected Racks (")}{affectedRacks.length})
                </Typography>
                <List dense sx={{ bgcolor: '#f5f5f5', borderRadius: 1 }}>
                  {affectedRacks.map((rack) => (
                    <ListItem key={rack.id}>
                      <ListItemText primary={rack.rack_code} />
                      <Chip label="Processing..." size="small" variant="outlined" />
                    </ListItem>
                  ))}
                </List>
              </Box>
            )}

            {/* Progress indicator */}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 2 }}>
              <CircularProgress size={40} sx={{ mr: 2 }} />
              <Stack spacing={0.5}>
                <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                  {operation === 'open' ? uiText('Opening...') : operation === 'close' ? uiText('Closing...') : uiText('Ventilating...')}
                </Typography>
                <Typography variant="caption" color="textSecondary"> {uiText("Waiting for simulation ACK and endpoint confirmation...")} </Typography>
              </Stack>
            </Box>

            {/* Info message */}
            <Alert severity="info" sx={{ fontSize: '0.85rem' }}> {uiText("The popup will only switch to success after the simulation confirms the rack reached the target endpoint.")} </Alert>
          </Stack>
        )}
      </DialogContent>

      <DialogActions sx={{ pt: 0, pb: 2, px: 3 }}>
        {isComplete ? (
          <Button onClick={() => {
            resetStatuses()
            onClose()
          }} variant="contained" fullWidth> {uiText("Close")} </Button>
        ) : (
          <Button onClick={onClose}> {uiText("Cancel")} </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
