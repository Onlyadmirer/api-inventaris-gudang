import { t } from 'elysia'

export const locationIdParams = t.Object({
  id: t.Numeric({ minimum: 1 }),
})

export const createLocationBody = t.Object({
  nama_rak: t.String({ minLength: 1, maxLength: 100 }),
  keterangan: t.Optional(t.String()),
})

export const updateLocationBody = t.Object({
  nama_rak: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
  keterangan: t.Optional(t.Union([t.String(), t.Null()])),
})
