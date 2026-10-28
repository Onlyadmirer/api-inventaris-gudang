import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error(
    'DATABASE_URL belum diset. Di Vercel: Project -> Settings -> Environment Variables ' +
      '(Production & Preview), lalu redeploy. Untuk lokal: isi .env.',
  )
}

// Opsi aman untuk lingkungan serverless (Vercel Functions):
// - max: 1            -> satu koneksi per instance, hindari menghabiskan kuota pooler
// - prepare: false    -> kompatibel dengan PgBouncer/Neon pooler (transaction mode)
// - idle_timeout      -> tutup koneksi idle sebelum instance di-freeze
export const queryClient = postgres(connectionString, {
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
})

export const db = drizzle(queryClient, { schema })

export type DB = typeof db
