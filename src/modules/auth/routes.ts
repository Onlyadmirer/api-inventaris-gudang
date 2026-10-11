import { Elysia } from 'elysia'
import { authPlugin } from '../../plugins/auth'
import { clientIp, logActivity } from '../../plugins/audit'
import { AppError } from '../../plugins/error'
import { findUserById, toUserResponse } from '../users/service'
import { loginBody } from './model'
import { authenticate } from './service'

export const authRoutes = new Elysia({ prefix: '/auth' })
  .use(authPlugin)
  .post(
    '/login',
    async ({ body, jwt, server, request }) => {
      const { user, role } = await authenticate(body.email, body.password)
      const token = await jwt.sign({ id_user: user.id_user, role })

      await logActivity({
        user_id: user.id_user,
        aksi: 'login',
        entitas_terkait: 'users',
        entitas_id: user.id_user,
        ip_address: clientIp(server, request),
      })

      return { token, user }
    },
    {
      body: loginBody,
      detail: { summary: 'Login email + password (UC-01)', tags: ['Auth'] },
    },
  )
  .get(
    '/me',
    async ({ authUser }) => {
      const found = await findUserById(authUser!.id_user)
      if (!found || !found.user.status_aktif) throw new AppError(401, 'Unauthorized')
      return toUserResponse(found.user, found.role)
    },
    {
      requireAuth: true,
      detail: {
        summary: 'Profil user yang sedang login (UC-01)',
        tags: ['Auth'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
