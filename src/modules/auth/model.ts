import { t } from 'elysia'

export const loginBody = t.Object({
  email: t.String({ format: 'email' }),
  password: t.String({ minLength: 1 }),
})
