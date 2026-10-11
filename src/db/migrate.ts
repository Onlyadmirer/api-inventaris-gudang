import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('DATABASE_URL wajib diisi di .env')
}

const migrationClient = postgres(connectionString, { max: 1 })

await migrate(drizzle(migrationClient), { migrationsFolder: './drizzle' })

await migrationClient.end()
console.log('Migrasi selesai.')
process.exit(0)
