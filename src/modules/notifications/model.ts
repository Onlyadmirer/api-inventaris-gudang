import { t } from 'elysia'

export const kanalPreferensi = t.Union([
  t.Literal('email'),
  t.Literal('whatsapp'),
  t.Literal('push'),
])

export const preferenceItem = t.Object({
  kanal_notifikasi: kanalPreferensi,
  tujuan: t.Optional(t.Union([t.String({ maxLength: 150 }), t.Null()])),
  status_aktif: t.Boolean(),
})

export const updatePreferencesBody = t.Object({
  preferences: t.Array(preferenceItem, { minItems: 1 }),
})

export const notificationIdParams = t.Object({
  id: t.Numeric({ minimum: 1 }),
})

export const listNotificationsQuery = t.Object({
  unread: t.Optional(t.Boolean()),
  page: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
})
