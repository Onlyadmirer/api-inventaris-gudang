import { Elysia } from 'elysia'
import { authPlugin } from '../../plugins/auth'
import { clientIp, logActivity } from '../../plugins/audit'
import {
  createUserBody,
  listUsersQuery,
  setUserStatusBody,
  updateUserBody,
  userIdParams,
} from './model'
import { createUser, listUsers, setUserStatus, updateUser } from './service'

export const userRoutes = new Elysia({ prefix: '/users' })
  .use(authPlugin)
  .get(
    '/',
    async ({ query }) => {
      const page = query.page ?? 1
      const limit = query.limit ?? 20
      return listUsers(page, limit)
    },
    {
      query: listUsersQuery,
      requireRole: ['ADMIN'],
      detail: {
        summary: 'Daftar akun pengguna (UC-02)',
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .post(
    '/',
    async ({ body, authUser, server, request, set }) => {
      const created = await createUser(body)
      await logActivity({
        user_id: authUser!.id_user,
        aksi: 'user.create',
        entitas_terkait: 'users',
        entitas_id: created.id_user,
        ip_address: clientIp(server, request),
      })
      set.status = 201
      return created
    },
    {
      body: createUserBody,
      requireRole: ['ADMIN'],
      detail: {
        summary: 'Tambah akun pengguna (UC-02)',
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .patch(
    '/:id',
    async ({ params, body, authUser, server, request }) => {
      const updated = await updateUser(params.id, body)
      await logActivity({
        user_id: authUser!.id_user,
        aksi: 'user.update',
        entitas_terkait: 'users',
        entitas_id: updated.id_user,
        ip_address: clientIp(server, request),
      })
      if (body.password !== undefined) {
        await logActivity({
          user_id: authUser!.id_user,
          aksi: 'user.reset_password',
          entitas_terkait: 'users',
          entitas_id: updated.id_user,
          ip_address: clientIp(server, request),
        })
      }
      return updated
    },
    {
      params: userIdParams,
      body: updateUserBody,
      requireRole: ['ADMIN'],
      detail: {
        summary: 'Ubah akun pengguna (UC-02)',
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .patch(
    '/:id/status',
    async ({ params, body, authUser, server, request }) => {
      const updated = await setUserStatus(authUser!.id_user, params.id, body.status_aktif)
      await logActivity({
        user_id: authUser!.id_user,
        aksi: body.status_aktif ? 'user.activate' : 'user.deactivate',
        entitas_terkait: 'users',
        entitas_id: updated.id_user,
        ip_address: clientIp(server, request),
      })
      return updated
    },
    {
      params: userIdParams,
      body: setUserStatusBody,
      requireRole: ['ADMIN'],
      detail: {
        summary: 'Aktifkan/nonaktifkan akun (UC-02)',
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
