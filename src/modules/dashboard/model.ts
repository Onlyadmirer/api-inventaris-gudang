import { t } from 'elysia'

export const dashboardQuery = t.Object({
  hari: t.Optional(t.Numeric({ minimum: 1, maximum: 90, default: 7 })),
})
