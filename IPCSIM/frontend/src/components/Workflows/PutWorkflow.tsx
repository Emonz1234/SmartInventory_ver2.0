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

interface PutWorkflowProps {
  open: boolean
  itemCode: string
  itemName: string
  rackCode: string
  onClose: () => void
  onConfirm: (qty: number, binCode: string) => void
}

export const PutWorkflow = ({ open, itemCode, itemName, rackCode, onClose, onConfirm }: PutWorkflowProps) => {
  useLanguage();
  const [step, setStep] = useState<'select' | 'bin' | 'open' | 'confirm'>('select')
  const [quantity, setQuantity] = useState(1)
  const [binCode, setBinCode] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)

  const handleNext = async () => {
    if (step === 'select') {
      setStep('bin')
    } else if (step === 'bin') {
      setStep('open')
    } else if (step === 'open') {
      setStep('confirm')
    } else {
      setIsProcessing(true)
      await new Promise((resolve) => setTimeout(resolve, 1000))
      onConfirm(quantity, binCode)
      setIsProcessing(false)
      setStep('select')
      setQuantity(1)
      setBinCode('')
      onClose()
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{uiText("Put Item")}</DialogTitle>
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

          {step === 'select' && (
            <TextField
              label={uiText("Put Quantity")}
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value)))}
              fullWidth
            />
          )}

          {(step === 'bin' || step === 'open' || step === 'confirm') && (
            <TextField
              label={uiText("Target Bin Code")}
              value={binCode}
              onChange={(e) => setBinCode(e.target.value)}
              placeholder="e.g., A-R01-S01-B01"
              fullWidth
            />
          )}

          {step === 'open' && (
            <Alert severity="info">{uiText("Opening Rack")} {rackCode}{uiText("... Please wait.")}</Alert>
          )}

          {step === 'confirm' && (
            <Alert severity="success">{uiText("Ready to put")} {quantity}x {itemName} {uiText("into")} {binCode}</Alert>
          )}

          {isProcessing && <LinearProgress />}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{uiText("Cancel")}</Button>
        <Button onClick={handleNext} variant="contained" disabled={isProcessing}>
          {step === 'confirm' && <Check sx={{ mr: 1 }} />}
          {step === 'select' && uiText('Next')}
          {step === 'bin' && uiText('Next')}
          {step === 'open' && uiText('Opening...')}
          {step === 'confirm' && uiText('Confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
