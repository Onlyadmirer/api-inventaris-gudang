import { t } from 'elysia'
import { ROLES } from '../../plugins/auth'

const roleSchema = t.UnionEnum(ROLES)

export const listUsersQuery = t.Object({
  page: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
})

export const userIdParams = t.Object({
  id: t.Numeric({ minimum: 1 }),
})

export const createUserBody = t.Object({
  nama_lengkap: t.String({ minLength: 1, maxLength: 150 }),
  email: t.String({ format: 'email', maxLength: 150 }),
  password: t.String({ minLength: 6 }),
  no_hp: t.Optional(t.String({ maxLength: 20 })),
  role: roleSchema,
})

export const updateUserBody = t.Object({
  nama_lengkap: t.Optional(t.String({ minLength: 1, maxLength: 150 })),
  no_hp: t.Optional(t.Union([t.String({ maxLength: 20 }), t.Null()])),
  role: t.Optional(roleSchema),
  password: t.Optional(t.String({ minLength: 6 })),
})

export const setUserStatusBody = t.Object({
  status_aktif: t.Boolean(),
})
