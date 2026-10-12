import { t } from 'elysia'

export const itemIdParams = t.Object({
  id: t.Numeric({ minimum: 1 }),
})

export const itemCodeParams = t.Object({
  kode: t.String({ minLength: 1, maxLength: 50 }),
})

export const listItemsQuery = t.Object({
  q: t.Optional(t.String()),
  kategori_id: t.Optional(t.Numeric({ minimum: 1 })),
  lokasi_id: t.Optional(t.Numeric({ minimum: 1 })),
  page: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
})

// stok_saat_ini & batas_stok_minimum diterima agar tidak error, tetapi diabaikan service (UC-03)
export const createItemBody = t.Object({
  kategori_id: t.Numeric({ minimum: 1 }),
  lokasi_id: t.Optional(t.Union([t.Numeric({ minimum: 1 }), t.Null()])),
  kode_barang: t.String({ minLength: 1, maxLength: 50 }),
  nama_barang: t.String({ minLength: 1, maxLength: 200 }),
  stok_saat_ini: t.Optional(t.Integer()),
  batas_stok_minimum: t.Optional(t.Integer()),
})

export const updateItemBody = t.Object({
  kategori_id: t.Optional(t.Numeric({ minimum: 1 })),
  lokasi_id: t.Optional(t.Union([t.Numeric({ minimum: 1 }), t.Null()])),
  kode_barang: t.Optional(t.String({ minLength: 1, maxLength: 50 })),
  nama_barang: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
  stok_saat_ini: t.Optional(t.Integer()),
  batas_stok_minimum: t.Optional(t.Integer()),
})

export const minStockBody = t.Object({
  batas_stok_minimum: t.Integer({ minimum: 0 }),
})

export const qrBatchBody = t.Object({
  id_barang: t.Array(t.Integer({ minimum: 1 }), { minItems: 1 }),
})
