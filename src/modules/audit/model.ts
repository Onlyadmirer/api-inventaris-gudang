import { t } from 'elysia'

export const listAuditLogsQuery = t.Object({
  dari: t.Optional(t.String()),
  sampai: t.Optional(t.String()),
  user_id: t.Optional(t.Numeric({ minimum: 1 })),
  aksi: t.Optional(t.String()),
  page: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
})

export const listNotificationLogsQuery = t.Object({
  dari: t.Optional(t.String()),
  sampai: t.Optional(t.String()),
  user_id: t.Optional(t.Numeric({ minimum: 1 })),
  barang_id: t.Optional(t.Numeric({ minimum: 1 })),
  kanal: t.Optional(t.Union([t.Literal('email'), t.Literal('whatsapp'), t.Literal('push')])),
  status_kirim: t.Optional(
    t.Union([t.Literal('pending'), t.Literal('terkirim'), t.Literal('gagal')]),
  ),
  sudah_dibaca: t.Optional(t.Boolean()),
  page: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
})
