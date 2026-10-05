import { t as uiText, useLanguage } from '../../i18n';
import { useState } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Typography,
  Stack,
  Button,
  Alert,
  LinearProgress,
  Box
} from '@mui/material'
import { Check } from '@mui/icons-material'

interface PickWorkflowProps {
  open: boolean
  itemCode: string
  itemName: string
  availableQty: number
  rackCode: string
  onClose: () => void
  onConfirm: (qty: number) => void
}

export const PickWorkflow = ({
  open,
  itemCode,
  itemName,
  availableQty,
  rackCode,
  onClose,
  onConfirm
}: PickWorkflowProps) => {
  useLanguage();
  const [step, setStep] = useState<'select' | 'open' | 'confirm'>('select')
  const [quantity, setQuantity] = useState(1)
  const [isProcessing, setIsProcessing] = useState(false)

  const handleNext = async () => {
    if (step === 'select') {
      setStep('open')
    } else if (step === 'open') {
      setStep('confirm')
    } else {
      setIsProcessing(true)
      await new Promise((resolve) => setTimeout(resolve, 1000))
      onConfirm(quantity)
      setIsProcessing(false)
      setStep('select')
      setQuantity(1)
      onClose()
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{uiText("Pick Item")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 2 }}>
          {/* Item Info */}
          <Box>
            <Typography variant="caption" color="textSecondary"> {uiText("Item Code")} </Typography>
            <Typography>{itemCode}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="textSecondary"> {uiText("Item Name")} </Typography>
            <Typography>{itemName}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="textSecondary"> {uiText("Available Stock")} </Typography>
            <Typography>{availableQty}</Typography>
          </Box>

          {step === 'select' && (
            <TextField
              label={uiText("Pick Quantity")}
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(Math.min(availableQty, Math.max(1, parseInt(e.target.value))))}
              inputProps={{ max: availableQty, min: 1 }}
              fullWidth
            />
          )}

          {step === 'open' && (
            <Alert severity="info">{uiText("Opening Rack")} {rackCode}{uiText("... Please wait.")}</Alert>
          )}

          {step === 'confirm' && (
            <Alert severity="success">{uiText("Ready to pick")} {quantity}x {itemName}</Alert>
          )}

          {isProcessing && <LinearProgress />}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{uiText("Cancel")}</Button>
        <Button onClick={handleNext} variant="contained" disabled={isProcessing}>
          {step === 'confirm' && <Check sx={{ mr: 1 }} />}
          {step === 'select' && uiText('Next')}
          {step === 'open' && uiText('Opening...')}
          {step === 'confirm' && uiText('Confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
