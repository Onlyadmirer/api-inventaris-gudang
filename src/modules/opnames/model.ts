import { t } from 'elysia'

export const opnameIdParams = t.Object({
  id: t.Numeric({ minimum: 1 }),
})

export const listOpnamesQuery = t.Object({
  status: t.Optional(t.Union([t.Literal('draft'), t.Literal('selesai')])),
  page: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
})

export const createOpnameBody = t.Object({
  keterangan: t.Optional(t.String({ maxLength: 1000 })),
})

export const opnameDetailBody = t.Object({
  barang_id: t.Numeric({ minimum: 1 }),
  stok_fisik: t.Integer({ minimum: 0 }),
  keterangan: t.Optional(t.String({ maxLength: 1000 })),
})

export const finalizeBody = t.Object({
  sinkronkan: t.Boolean(),
})
