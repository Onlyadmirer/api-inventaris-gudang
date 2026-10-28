import { Elysia } from 'elysia'
import { openapi } from '@elysiajs/openapi'
import { sql } from 'drizzle-orm'
import { db } from './db'
import { errorPlugin } from './plugins/error'
import { authRoutes } from './modules/auth/routes'
import { userRoutes } from './modules/users/routes'
import { categoryRoutes } from './modules/categories/routes'
import { locationRoutes } from './modules/locations/routes'
import { itemRoutes } from './modules/items/routes'
import { transactionRoutes } from './modules/transactions/routes'
import { opnameRoutes } from './modules/opnames/routes'
import { dashboardRoutes } from './modules/dashboard/routes'
import { reportRoutes } from './modules/reports/routes'
import { auditRoutes } from './modules/audit/routes'
import { preferenceRoutes, notificationRoutes } from './modules/notifications/routes'
import { scheduleRoutes } from './modules/schedules/routes'
import { loadActiveSchedules } from './modules/schedules/scheduler'

const port = Number(process.env.PORT ?? 3000)

export const app = new Elysia({ prefix: '/api' })
  .use(errorPlugin)
  .use(authRoutes)
  .use(userRoutes)
  .use(categoryRoutes)
  .use(locationRoutes)
  .use(itemRoutes)
  .use(transactionRoutes)
  .use(opnameRoutes)
  .use(dashboardRoutes)
  .use(reportRoutes)
  .use(auditRoutes)
  .use(preferenceRoutes)
  .use(notificationRoutes)
  .use(scheduleRoutes)
  .use(
    openapi({
      path: '/openapi',
      documentation: {
        info: {
          title: 'Sistem Kelola Gudang API',
          version: '0.1.0',
          description:
            'Backend inventaris gudang: auth & user, master data, QR, transaksi stok, opname, dashboard, laporan, notifikasi, dan penjadwalan laporan.',
        },
        tags: [
          { name: 'Publik', description: 'Endpoint tanpa autentikasi' },
          { name: 'Semua', description: 'Endpoint untuk semua role terautentikasi' },
          { name: 'Admin', description: 'ADMIN' },
          { name: 'Kepala Gudang', description: 'KEPALA_GUDANG' },
          { name: 'Staf Gudang', description: 'STAF_GUDANG' },
        ],
        components: {
          securitySchemes: {
            bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          },
        },
      },
    }),
  )
  .get(
    '/health',
    async () => {
      await db.execute(sql`select 1`)
      return { status: 'ok' }
    },
    { detail: { summary: 'Health check', tags: ['Publik'] } },
  )
  .get("/cronjob", () => {
    return {
      status: "ok"
    }
  })
  .get(
    '/',
    () => ({ status: 'ok', service: 'inventaris-gudang-api' }),
    { detail: { summary: 'Status API (tanpa database)', tags: ['Publik'] } },
  )

// Vercel Functions tidak mendukung app.listen(). Guard ini mencegah server
// dijalankan (dan query jadwal saat cold start) ketika berjalan di Vercel.
const isServerless = Boolean(process.env.VERCEL)

if (import.meta.main && !isServerless) {
  await loadActiveSchedules()
  app.listen(port)
  console.log(`Backend berjalan di http://localhost:${port}`)
}

export default app
export type App = typeof app
