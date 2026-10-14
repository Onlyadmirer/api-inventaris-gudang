import { Elysia } from 'elysia'
import { authPlugin } from '../../plugins/auth'
import { dashboardQuery } from './model'
import { getDashboard } from './service'

export const dashboardRoutes = new Elysia({ prefix: '/dashboard' })
  .use(authPlugin)
  .get(
    '/',
    async ({ query }) => getDashboard(query.hari ?? 7),
    {
      query: dashboardQuery,
      requireRole: ['ADMIN', 'KEPALA_GUDANG'],
      detail: {
        summary: 'Ringkasan dashboard (UC-13)',
        tags: ['Dashboard'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
