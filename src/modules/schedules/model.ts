import { t } from 'elysia'

export const jenisLaporanSchema = t.Union([
  t.Literal('stok'),
  t.Literal('transaksi'),
  t.Literal('opname'),
])

export const frekuensiSchema = t.Union([
  t.Literal('harian'),
  t.Literal('mingguan'),
  t.Literal('bulanan'),
])

const WAKTU_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/

export const listSchedulesQuery = t.Object({
  page: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
})

export const scheduleIdParams = t.Object({
  id: t.Numeric({ minimum: 1 }),
})

export const createScheduleBody = t.Object({
  jenis_laporan: jenisLaporanSchema,
  frekuensi: frekuensiSchema,
  waktu_eksekusi: t.String({ pattern: WAKTU_REGEX.source }),
  email_penerima: t.String({ format: 'email', maxLength: 150 }),
  status_aktif: t.Optional(t.Boolean({ default: true })),
})

export const updateScheduleBody = t.Object({
  jenis_laporan: t.Optional(jenisLaporanSchema),
  frekuensi: t.Optional(frekuensiSchema),
  waktu_eksekusi: t.Optional(t.String({ pattern: WAKTU_REGEX.source })),
  email_penerima: t.Optional(t.String({ format: 'email', maxLength: 150 })),
  status_aktif: t.Optional(t.Boolean()),
})
