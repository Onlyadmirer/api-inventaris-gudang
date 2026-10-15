import { Elysia } from 'elysia'
import { authPlugin } from '../../plugins/auth'
import { clientIp, logActivity } from '../../plugins/audit'
import {
  createItemBody,
  itemCodeParams,
  itemIdParams,
  listItemsQuery,
  minStockBody,
  qrBatchBody,
  updateItemBody,
} from './model'
import {
  createItem,
  deleteItem,
  getItemByCode,
  getItemById,
  getItemQr,
  getItemsQrBatch,
  listItems,
  updateItem,
  updateMinStock,
} from './service'

export const itemRoutes = new Elysia({ prefix: '/items' })
  .use(authPlugin)
  .get(
    '/',
    async ({ query }) => {
      return listItems({
        q: query.q,
        kategori_id: query.kategori_id,
        lokasi_id: query.lokasi_id,
        page: query.page ?? 1,
        limit: query.limit ?? 20,
      })
    },
    {
      query: listItemsQuery,
      requireAuth: true,
      detail: {
        summary: 'Daftar & pencarian barang (UC-08)',
        tags: ['Semua'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .get(
    '/by-code/:kode',
    async ({ params }) => getItemByCode(params.kode),
    {
      params: itemCodeParams,
      requireAuth: true,
      detail: {
        summary: 'Detail barang berdasarkan kode/SKU (UC-09)',
        tags: ['Semua'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .get(
    '/:id/qr',
    async ({ params, authUser, server, request }) => {
      const result = await getItemQr(params.id)
      await logActivity({
        user_id: authUser!.id_user,
        aksi: 'item.qr_generate',
        entitas_terkait: 'items',
        entitas_id: params.id,
        ip_address: clientIp(server, request),
      })
      return result
    },
    {
      params: itemIdParams,
      requireRole: ['ADMIN'],
      detail: {
        summary: 'Generate QR code barang (UC-05)',
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .post(
    '/qr/batch',
    async ({ body, authUser, server, request }) => {
      const result = await getItemsQrBatch(body.id_barang)
      await logActivity({
        user_id: authUser!.id_user,
        aksi: 'item.qr_batch',
        entitas_terkait: 'items',
        ip_address: clientIp(server, request),
      })
      return result
    },
    {
      body: qrBatchBody,
      requireRole: ['ADMIN'],
      detail: {
        summary: 'Generate QR code massal (UC-05)',
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .get(
    '/:id',
    async ({ params }) => getItemById(params.id),
    {
      params: itemIdParams,
      requireAuth: true,
      detail: {
        summary: 'Detail barang (UC-08)',
        tags: ['Semua'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .post(
    '/',
    async ({ body, authUser, server, request, set }) => {
      const created = await createItem(body)
      await logActivity({
        user_id: authUser!.id_user,
        aksi: 'item.create',
        entitas_terkait: 'items',
        entitas_id: created.id_barang,
        ip_address: clientIp(server, request),
      })
      set.status = 201
      return created
    },
    {
      body: createItemBody,
      requireRole: ['ADMIN'],
      detail: {
        summary: 'Tambah barang (UC-03)',
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .patch(
    '/:id/min-stock',
    async ({ params, body, authUser, server, request }) => {
      const updated = await updateMinStock(params.id, body.batas_stok_minimum)
      await logActivity({
        user_id: authUser!.id_user,
        aksi: 'item.min_stock_update',
        entitas_terkait: 'items',
        entitas_id: updated.id_barang,
        ip_address: clientIp(server, request),
      })
      return updated
    },
    {
      params: itemIdParams,
      body: minStockBody,
      requireRole: ['ADMIN'],
      detail: {
        summary: 'Atur batas stok minimum (UC-04)',
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .patch(
    '/:id',
    async ({ params, body, authUser, server, request }) => {
      const updated = await updateItem(params.id, body)
      await logActivity({
        user_id: authUser!.id_user,
        aksi: 'item.update',
        entitas_terkait: 'items',
        entitas_id: updated.id_barang,
        ip_address: clientIp(server, request),
      })
      return updated
    },
    {
      params: itemIdParams,
      body: updateItemBody,
      requireRole: ['ADMIN'],
      detail: {
        summary: 'Ubah barang (UC-03)',
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .delete(
    '/:id',
    async ({ params, authUser, server, request }) => {
      const deleted = await deleteItem(params.id)
      await logActivity({
        user_id: authUser!.id_user,
        aksi: 'item.delete',
        entitas_terkait: 'items',
        entitas_id: deleted.id_barang,
        ip_address: clientIp(server, request),
      })
      return { message: 'Barang dihapus' }
    },
    {
      params: itemIdParams,
      requireRole: ['ADMIN'],
      detail: {
        summary: 'Hapus barang (UC-03)',
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
