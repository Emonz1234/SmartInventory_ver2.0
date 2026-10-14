const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh'

const dateTimeFormatter = new Intl.DateTimeFormat('vi-VN', {
  timeZone: VIETNAM_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
})

const timeFormatter = new Intl.DateTimeFormat('vi-VN', {
  timeZone: VIETNAM_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit'
})

const isVietnamFormattedDate = (value: string): boolean => {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
}

export const parseVietnamDate = (value?: string | number | null): Date | null => {
  if (!value) return null

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    const date = new Date(Math.abs(value) < 1e12 ? value * 1000 : value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  const trimmed = value.trim()
  if (isVietnamFormattedDate(trimmed)) {
    const date = new Date(trimmed.replace(' ', 'T') + '+07:00')
    return Number.isNaN(date.getTime()) ? null : date
  }

  const date = new Date(trimmed)
  return Number.isNaN(date.getTime()) ? null : date
}

export const formatDateTime = (value?: string | number | null): string => {
  if (!value) return '--'
  if (typeof value === 'number') {
    const date = parseVietnamDate(value)
    return date ? dateTimeFormatter.format(date) : '--'
  }
  const trimmed = value.trim()

  if (isVietnamFormattedDate(trimmed)) {
    return trimmed
  }

  const date = parseVietnamDate(trimmed)
  return date ? dateTimeFormatter.format(date) : trimmed
}

export const formatTimeShort = (value?: string | number | null): string => {
  if (!value) return '--'

  const date = parseVietnamDate(value)
  if (!date) return '--'

  return timeFormatter.format(date)
}
