import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('DATABASE_URL wajib diisi di .env')
}

export const queryClient = postgres(connectionString)

export const db = drizzle(queryClient, { schema })

export type DB = typeof db
