import { t } from 'elysia'

const itemInput = t.Union([
  t.Object({
    barang_id: t.Numeric({ minimum: 1 }),
    jumlah: t.Integer({ minimum: 1 }),
  }),
  t.Object({
    kode_barang: t.String({ minLength: 1, maxLength: 50 }),
    jumlah: t.Integer({ minimum: 1 }),
  }),
])

export const createTransactionBody = t.Object({
  items: t.Array(itemInput, { minItems: 1 }),
  keterangan: t.Optional(t.String({ maxLength: 1000 })),
  sumber: t.Optional(t.Union([t.Literal('scan'), t.Literal('manual')])),
})

export type CreateTransactionBody = typeof createTransactionBody.static

export const listTransactionsQuery = t.Object({
  dari: t.Optional(t.String()),
  sampai: t.Optional(t.String()),
  jenis: t.Optional(t.Union([t.Literal('masuk'), t.Literal('keluar')])),
  page: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
})
