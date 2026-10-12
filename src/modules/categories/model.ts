import { t } from 'elysia'

export const categoryIdParams = t.Object({
  id: t.Numeric({ minimum: 1 }),
})

export const createCategoryBody = t.Object({
  nama_kategori: t.String({ minLength: 1, maxLength: 100 }),
  deskripsi: t.Optional(t.String()),
})

export const updateCategoryBody = t.Object({
  nama_kategori: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
  deskripsi: t.Optional(t.Union([t.String(), t.Null()])),
})
