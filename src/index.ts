import { Elysia } from 'elysia'
import { openapi } from '@elysiajs/openapi'
import { sql } from 'drizzle-orm'
import { db } from './db'
import { errorPlugin } from './plugins/error'

const port = Number(process.env.PORT ?? 3000)

export const app = new Elysia({ prefix: '/api' })
  .use(errorPlugin)
  .use(
    openapi({
      path: '/openapi',
      documentation: {
        info: { title: 'Sistem Kelola Gudang API', version: '0.1.0' },
      },
    }),
  )
  .get(
    '/health',
    async () => {
      await db.execute(sql`select 1`)
      return { status: 'ok' }
    },
    { detail: { summary: 'Health check', tags: ['System'] } },
  )

if (import.meta.main) {
  app.listen(port)
  console.log(`Backend berjalan di http://localhost:${port}`)
}

export type App = typeof app
