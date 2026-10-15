import { Elysia } from 'elysia'
import { authPlugin } from '../../plugins/auth'
import { clientIp, logActivity } from '../../plugins/audit'
import {
  createOpnameBody,
  finalizeBody,
  listOpnamesQuery,
  opnameDetailBody,
  opnameIdParams,
} from './model'
import { addOpnameDetail, createOpname, finalizeOpname, getOpname, listOpnames } from './service'

const ROLES_OPNAME = ['KEPALA_GUDANG', 'STAF_GUDANG'] as const

export const opnameRoutes = new Elysia({ prefix: '/opnames' })
  .use(authPlugin)
  .get(
    '/',
    async ({ query }) => {
      return listOpnames({
        status: query.status,
        page: query.page ?? 1,
        limit: query.limit ?? 20,
      })
    },
    {
      query: listOpnamesQuery,
      requireRole: [...ROLES_OPNAME],
      detail: {
        summary: 'Daftar sesi stok opname (UC-15)',
        tags: ['Kepala Gudang', 'Staf Gudang'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .post(
    '/',
    async ({ body, authUser, server, request, set }) => {
      const created = await createOpname(authUser!.id_user, body.keterangan)

      await logActivity({
        user_id: authUser!.id_user,
        aksi: 'opname.create',
        entitas_terkait: 'stock_opnames',
        entitas_id: created.id_opname,
        ip_address: clientIp(server, request),
      })

      set.status = 201
      return created
    },
    {
      body: createOpnameBody,
      requireRole: [...ROLES_OPNAME],
      detail: {
        summary: 'Buat sesi stok opname draft (UC-15)',
        tags: ['Kepala Gudang', 'Staf Gudang'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .post(
    '/:id/details',
    async ({ params, body, authUser, server, request, set }) => {
      const detail = await addOpnameDetail(params.id, body)

      await logActivity({
        user_id: authUser!.id_user,
        aksi: 'opname.detail',
        entitas_terkait: 'stock_opnames',
        entitas_id: params.id,
        ip_address: clientIp(server, request),
      })

      set.status = 201
      return detail
    },
    {
      params: opnameIdParams,
      body: opnameDetailBody,
      requireRole: [...ROLES_OPNAME],
      detail: {
        summary: 'Input hitungan fisik barang (UC-15)',
        tags: ['Kepala Gudang', 'Staf Gudang'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .post(
    '/:id/finalize',
    async ({ params, body, authUser, server, request }) => {
      const result = await finalizeOpname(params.id, body.sinkronkan, authUser!.id_user)

      await logActivity({
        user_id: authUser!.id_user,
        aksi: 'opname.finalize',
        entitas_terkait: 'stock_opnames',
        entitas_id: params.id,
        ip_address: clientIp(server, request),
      })

      return result
    },
    {
      params: opnameIdParams,
      body: finalizeBody,
      requireRole: ['KEPALA_GUDANG'],
      detail: {
        summary: 'Finalisasi & sinkronisasi stok opname (UC-15, hanya Kepala)',
        tags: ['Kepala Gudang'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .get(
    '/:id',
    async ({ params }) => getOpname(params.id),
    {
      params: opnameIdParams,
      requireRole: [...ROLES_OPNAME],
      detail: {
        summary: 'Ringkasan sesi stok opname (UC-15)',
        tags: ['Kepala Gudang', 'Staf Gudang'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
