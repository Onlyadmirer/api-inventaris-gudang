import { Elysia } from 'elysia'
import { authPlugin } from '../../plugins/auth'
import { clientIp, logActivity } from '../../plugins/audit'
import { createLocationBody, locationIdParams, updateLocationBody } from './model'
import {
  createLocation,
  deleteLocation,
  listLocations,
  updateLocation,
} from './service'

export const locationRoutes = new Elysia({ prefix: '/locations' })
  .use(authPlugin)
  .get(
    '/',
    async () => listLocations(),
    {
      requireAuth: true,
      detail: {
        summary: 'Daftar lokasi (UC-03)',
        tags: ['Locations'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .post(
    '/',
    async ({ body, authUser, server, request, set }) => {
      const created = await createLocation(body)
      await logActivity({
        user_id: authUser!.id_user,
        aksi: 'location.create',
        entitas_terkait: 'locations',
        entitas_id: created.id_lokasi,
        ip_address: clientIp(server, request),
      })
      set.status = 201
      return created
    },
    {
      body: createLocationBody,
      requireRole: ['ADMIN', 'KEPALA_GUDANG'],
      detail: {
        summary: 'Tambah lokasi (UC-03)',
        tags: ['Locations'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .patch(
    '/:id',
    async ({ params, body, authUser, server, request }) => {
      const updated = await updateLocation(params.id, body)
      await logActivity({
        user_id: authUser!.id_user,
        aksi: 'location.update',
        entitas_terkait: 'locations',
        entitas_id: updated.id_lokasi,
        ip_address: clientIp(server, request),
      })
      return updated
    },
    {
      params: locationIdParams,
      body: updateLocationBody,
      requireRole: ['ADMIN', 'KEPALA_GUDANG'],
      detail: {
        summary: 'Ubah lokasi (UC-03)',
        tags: ['Locations'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .delete(
    '/:id',
    async ({ params, authUser, server, request }) => {
      const deleted = await deleteLocation(params.id)
      await logActivity({
        user_id: authUser!.id_user,
        aksi: 'location.delete',
        entitas_terkait: 'locations',
        entitas_id: deleted.id_lokasi,
        ip_address: clientIp(server, request),
      })
      return { message: 'Lokasi dihapus' }
    },
    {
      params: locationIdParams,
      requireRole: ['ADMIN', 'KEPALA_GUDANG'],
      detail: {
        summary: 'Hapus lokasi (UC-03)',
        tags: ['Locations'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
