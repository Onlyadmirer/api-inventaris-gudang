import { Elysia } from 'elysia'
import { jwt } from '@elysiajs/jwt'
import { AppError } from './error'

export const ROLES = ['ADMIN', 'KEPALA_GUDANG', 'STAF_GUDANG'] as const
export type Role = (typeof ROLES)[number]

export type AuthUser = {
  id_user: number
  role: Role
}

const JWT_SECRET = process.env.JWT_SECRET ?? ''
const JWT_EXPIRES = process.env.JWT_EXPIRES ?? '1d'

export const authPlugin = new Elysia({ name: 'auth' })
  .use(jwt({ name: 'jwt', secret: JWT_SECRET, exp: JWT_EXPIRES }))
  .derive({ as: 'global' }, async ({ jwt, headers }) => {
    let authUser: AuthUser | null = null
    const authorization = headers.authorization

    if (authorization?.startsWith('Bearer ')) {
      const payload = await jwt.verify(authorization.slice('Bearer '.length))
      if (
        payload &&
        payload.id_user != null &&
        typeof payload.role === 'string' &&
        (ROLES as readonly string[]).includes(payload.role)
      ) {
        authUser = { id_user: Number(payload.id_user), role: payload.role as Role }
      }
    }

    return { authUser }
  })
  .macro({
    requireAuth: () => ({
      beforeHandle({ authUser }) {
        if (!authUser) throw new AppError(401, 'Unauthorized')
      },
    }),
    requireRole: (roles: Role[]) => ({
      beforeHandle({ authUser }) {
        if (!authUser) throw new AppError(401, 'Unauthorized')
        if (!roles.includes(authUser.role)) throw new AppError(403, 'Forbidden')
      },
    }),
  })
