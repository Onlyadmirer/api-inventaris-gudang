import { AppError } from '../plugins/error'

export type DateRange = {
  from: Date | null
  to: Date | null
}

function parseDate(value: string, endOfDay: boolean): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number)
    if (endOfDay) return new Date(year!, month! - 1, day!, 23, 59, 59, 999)
    return new Date(year!, month! - 1, day!, 0, 0, 0, 0)
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new AppError(400, 'Format tanggal tidak valid')
  return parsed
}

export function parseDateRange(dari?: string, sampai?: string): DateRange {
  const from = dari ? parseDate(dari, false) : null
  const to = sampai ? parseDate(sampai, true) : null
  if (from && to && from.getTime() > to.getTime()) {
    throw new AppError(400, 'Rentang tanggal tidak valid')
  }
  return { from, to }
}
