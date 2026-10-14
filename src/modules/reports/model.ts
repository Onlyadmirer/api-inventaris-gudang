import { t } from 'elysia'

export const reportJenisParams = t.Object({
  jenis: t.Union([t.Literal('stok'), t.Literal('transaksi'), t.Literal('opname')]),
})

export const reportQuery = t.Object({
  dari: t.Optional(t.String()),
  sampai: t.Optional(t.String()),
  kategori_id: t.Optional(t.Numeric({ minimum: 1 })),
})

export const reportExportQuery = t.Object({
  format: t.Union([t.Literal('pdf'), t.Literal('xlsx')]),
  dari: t.Optional(t.String()),
  sampai: t.Optional(t.String()),
  kategori_id: t.Optional(t.Numeric({ minimum: 1 })),
})
