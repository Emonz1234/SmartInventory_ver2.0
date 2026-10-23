import { useEffect, useState } from 'react'
import { TablePagination, TablePaginationProps } from '@mui/material'
import { t, useLanguage } from '../i18n'

type PageMenuProps = Pick<TablePaginationProps, 'count' | 'page' | 'rowsPerPage' | 'onPageChange' | 'onRowsPerPageChange' | 'rowsPerPageOptions' | 'labelRowsPerPage'>

// Bound rendering without changing the dataset used by summaries or operations.
export function useTablePage(count: number, resetKey: string, initialRowsPerPage = 5) {
  const [requestedPage, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(initialRowsPerPage)
  useEffect(() => { setPage(0) }, [resetKey])
  const page = Math.min(requestedPage, Math.max(0, Math.ceil(count / rowsPerPage) - 1))
  const start = page * rowsPerPage
  return {
    slice: <T,>(rows: T[]) => rows.slice(start, start + rowsPerPage),
    controls: {
      count, page, rowsPerPage,
      onPageChange: (_: unknown, value: number) => setPage(value),
      onRowsPerPageChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setRowsPerPage(Number(event.target.value)); setPage(0)
      },
    },
  }
}

export function TablePageMenu(props: PageMenuProps) {
  useLanguage()
  return <TablePagination component="div" {...props} rowsPerPageOptions={props.rowsPerPageOptions ?? [5, 10, 25, 50]}
    labelRowsPerPage={props.labelRowsPerPage ?? t('Rows per page:')}
    labelDisplayedRows={({ from, to, count }) => `${from}–${to} / ${count}`}
    sx={{ '& .MuiTablePagination-toolbar': { flexWrap:'wrap', gap:0.5, px:1.5, py:0.5 },
      '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': { fontSize:14 } }} />
}
