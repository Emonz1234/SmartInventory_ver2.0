import { useState } from 'react'
import {
  Box,
  Card,
  CardContent,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  TextField,
  InputAdornment,
  Button,
  Stack,
  Chip,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Divider,
  Skeleton
  , Alert
} from '@mui/material'
import { Search, ReceiptLong, TrendingDown, TrendingUp, Tune } from '@mui/icons-material'
import { useQuery } from '@tanstack/react-query'
import { transactionsAPI } from '@api/transactions'
import { InventoryTransaction } from '../types'
import { formatDateTime } from '@utils/date'
import { Link as RouterLink } from 'react-router-dom'

export const Transactions = () => {
  const [filterItem, setFilterItem] = useState('')
  const [filterType, setFilterType] = useState('ALL')

  const q = useQuery({
    queryKey: ['transactions', filterItem, filterType],
    queryFn: async () => {
      const trimmed = filterItem.trim()
      const itemId = trimmed === '' ? undefined : Number(trimmed)
      const resp = await transactionsAPI.list(trimmed === '' || Number.isNaN(itemId) ? undefined : itemId)
      return resp.data
    }
  })

  const transactions: InventoryTransaction[] = q.data ?? []
  const filteredTransactions = transactions.filter((tx) =>
    filterType === 'ALL' ? true : tx.transaction_type === filterType
  )

  const transactionCount = filteredTransactions.length
  const typeLabel = filterType === 'ALL' ? 'All Types' : filterType
  const pickCount = filteredTransactions.filter((tx) => tx.transaction_type === 'PICK').length
  const putCount = filteredTransactions.filter((tx) => tx.transaction_type === 'PUT').length

  return (
    <Box>
      <Alert severity="info" sx={{ mb: 2 }}>Lịch sử lưu trữ từ hệ thống trước. Xem các thao tác mới và xác nhận tồn kho tại <Button component={RouterLink} to="/operation">Operation</Button>.</Alert>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'center' }} spacing={1} sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold', letterSpacing: '-0.02em' }}>Transaction Log</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>Review inventory movements and adjustment history.</Typography>
        </Box>
        <Chip icon={<ReceiptLong />} label={`${transactionCount} visible records`} color="primary" variant="outlined" />
      </Stack>

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} sm={4}><Card sx={{ borderTop: '3px solid', borderColor: 'primary.main' }}><CardContent><Typography variant="body2" color="text.secondary">All transactions</Typography><Typography variant="h4" sx={{ fontWeight: 'bold', mt: 0.5 }}>{transactions.length}</Typography><Typography variant="caption" color="text.secondary">Loaded from inventory history</Typography></CardContent></Card></Grid>
        <Grid item xs={12} sm={4}><Card sx={{ borderTop: '3px solid', borderColor: 'warning.main' }}><CardContent><Stack direction="row" justifyContent="space-between"><Box><Typography variant="body2" color="text.secondary">Pick operations</Typography><Typography variant="h4" sx={{ fontWeight: 'bold', mt: 0.5 }}>{pickCount}</Typography></Box><TrendingDown color="warning" sx={{ fontSize: 34 }} /></Stack></CardContent></Card></Grid>
        <Grid item xs={12} sm={4}><Card sx={{ borderTop: '3px solid', borderColor: 'success.main' }}><CardContent><Stack direction="row" justifyContent="space-between"><Box><Typography variant="body2" color="text.secondary">Put operations</Typography><Typography variant="h4" sx={{ fontWeight: 'bold', mt: 0.5 }}>{putCount}</Typography></Box><TrendingUp color="success" sx={{ fontSize: 34 }} /></Stack></CardContent></Card></Grid>
      </Grid>

      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ p: { xs: 2, md: 2.5 } }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}><Tune color="action" /><Box><Typography variant="h6" sx={{ fontWeight: 'bold' }}>Filter history</Typography><Typography variant="body2" color="text.secondary">Narrow records by item or operation type.</Typography></Box></Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
            <TextField
              label="Filter by Item ID or Code"
              value={filterItem}
              onChange={(e) => setFilterItem(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Search />
                  </InputAdornment>
                )
              }}
              size="small"
            />
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel>Transaction Type</InputLabel>
              <Select
                value={filterType}
                label="Transaction Type"
                onChange={(e) => setFilterType(e.target.value)}
              >
                <MenuItem value="ALL">All</MenuItem>
                <MenuItem value="PICK">Pick</MenuItem>
                <MenuItem value="PUT">Put</MenuItem>
                <MenuItem value="ADJUST">Adjust</MenuItem>
                <MenuItem value="INITIAL">Initial</MenuItem>
              </Select>
            </FormControl>
            <Button variant="outlined" onClick={() => { setFilterItem(''); setFilterType('ALL') }}>
              Clear
            </Button>
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 2 }}>
            <Chip label={`Transactions: ${transactionCount}`} variant="outlined" />
            <Chip label={`Type: ${typeLabel}`} variant="outlined" />
          </Stack>
        </CardContent>
      </Card>

      <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 620 }}>
        <Table stickyHeader size="small">
          <TableHead>
            <TableRow>
              <TableCell>ID</TableCell>
              <TableCell>Item</TableCell>
              <TableCell>Type</TableCell>
              <TableCell align="right">Quantity</TableCell>
              <TableCell>Reference</TableCell>
              <TableCell>User</TableCell>
              <TableCell>Created At</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {q.isLoading ? (
              Array.from({ length: 6 }).map((_, index) => <TableRow key={index}><TableCell colSpan={7}><Skeleton /></TableCell></TableRow>)
            ) : filteredTransactions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  No transactions found.
                </TableCell>
              </TableRow>
            ) : (
              filteredTransactions.map((tx) => (
                <TableRow key={tx.id} hover>
                  <TableCell>{tx.id}</TableCell>
                  <TableCell>
                    {tx.item_code ? `${tx.item_code} - ${tx.item_name}` : tx.item_id}
                  </TableCell>
                  <TableCell><Chip label={tx.transaction_type} size="small" color={tx.transaction_type === 'PICK' ? 'warning' : tx.transaction_type === 'PUT' ? 'success' : 'default'} /></TableCell>
                  <TableCell align="right">{tx.quantity}</TableCell>
                  <TableCell>{tx.reference_no ?? '--'}</TableCell>
                  <TableCell>{tx.user_id ?? '--'}</TableCell>
                  <TableCell>{formatDateTime(tx.created_at)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  )
}
