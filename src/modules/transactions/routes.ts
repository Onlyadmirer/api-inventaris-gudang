import { Elysia } from 'elysia'
import { authPlugin } from '../../plugins/auth'
import { clientIp, logActivity } from '../../plugins/audit'
import { createTransactionBody, listTransactionsQuery } from './model'
import { createTransaction, listTransactions } from './service'

export const transactionRoutes = new Elysia({ prefix: '/transactions' })
  .use(authPlugin)
  .get(
    '/',
    async ({ query, authUser }) =>
      listTransactions({
        dari: query.dari,
        sampai: query.sampai,
        jenis: query.jenis,
        ownerId: authUser!.role === 'STAF_GUDANG' ? authUser!.id_user : undefined,
        page: query.page ?? 1,
        limit: query.limit ?? 20,
      }),
    {
      query: listTransactionsQuery,
      requireRole: ['ADMIN', 'KEPALA_GUDANG', 'STAF_GUDANG'],
      detail: {
        summary: 'Daftar transaksi stok (filter tanggal/jenis, staf hanya miliknya)',
        tags: ['Semua'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .post(
    '/masuk',
    async ({ body, authUser, server, request, set }) => {
      const result = await createTransaction({
        user_id: authUser!.id_user,
        jenis: 'masuk',
        items: body.items,
        keterangan: body.keterangan,
        sumber: body.sumber,
      })

      await logActivity({
        user_id: authUser!.id_user,
        aksi: 'transaction.masuk',
        entitas_terkait: 'transactions',
        entitas_id: result.id_transaksi,
        ip_address: clientIp(server, request),
      })

      set.status = 201
      return result
    },
    {
      body: createTransactionBody,
      requireRole: ['STAF_GUDANG'],
      detail: {
        summary: 'Barang masuk (UC-10, UC-12)',
        tags: ['Staf Gudang'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .post(
    '/keluar',
    async ({ body, authUser, server, request, set }) => {
      const result = await createTransaction({
        user_id: authUser!.id_user,
        jenis: 'keluar',
        items: body.items,
        keterangan: body.keterangan,
        sumber: body.sumber,
      })

      await logActivity({
        user_id: authUser!.id_user,
        aksi: 'transaction.keluar',
        entitas_terkait: 'transactions',
        entitas_id: result.id_transaksi,
        ip_address: clientIp(server, request),
      })

      set.status = 201
      return result
    },
    {
      body: createTransactionBody,
      requireRole: ['STAF_GUDANG'],
      detail: {
        summary: 'Barang keluar (UC-11, UC-12)',
        tags: ['Staf Gudang'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
