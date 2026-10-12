import { asc, eq, sql } from 'drizzle-orm'
import { db } from '../../db'
import { items, locations } from '../../db/schema'
import { AppError } from '../../plugins/error'

type LocationRow = typeof locations.$inferSelect

export type LocationResponse = {
  id_lokasi: number
  nama_rak: string
  keterangan: string | null
}

export function toLocationResponse(location: LocationRow): LocationResponse {
  return {
    id_lokasi: location.id_lokasi,
    nama_rak: location.nama_rak,
    keterangan: location.keterangan,
  }
}

export async function listLocations() {
  const rows = await db.select().from(locations).orderBy(asc(locations.id_lokasi))
  return { data: rows.map(toLocationResponse) }
}

export async function findLocationById(id: number): Promise<LocationRow> {
  const rows = await db.select().from(locations).where(eq(locations.id_lokasi, id)).limit(1)
  const row = rows[0]
  if (!row) throw new AppError(404, 'Lokasi tidak ditemukan')
  return row
}

export type CreateLocationInput = {
  nama_rak: string
  keterangan?: string
}

export async function createLocation(input: CreateLocationInput): Promise<LocationResponse> {
  const [created] = await db
    .insert(locations)
    .values({ nama_rak: input.nama_rak, keterangan: input.keterangan ?? null })
    .returning()
  return toLocationResponse(created)
}

export type UpdateLocationInput = {
  nama_rak?: string
  keterangan?: string | null
}

export async function updateLocation(id: number, input: UpdateLocationInput): Promise<LocationResponse> {
  await findLocationById(id)

  const patch: Partial<typeof locations.$inferInsert> = {}
  if (input.nama_rak !== undefined) patch.nama_rak = input.nama_rak
  if (input.keterangan !== undefined) patch.keterangan = input.keterangan

  if (Object.keys(patch).length === 0) throw new AppError(400, 'Tidak ada data yang diubah')

  const [updated] = await db
    .update(locations)
    .set(patch)
    .where(eq(locations.id_lokasi, id))
    .returning()
  return toLocationResponse(updated)
}

export async function deleteLocation(id: number): Promise<LocationResponse> {
  const current = await findLocationById(id)

  const used = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(items)
    .where(eq(items.lokasi_id, id))

  if ((used[0]?.total ?? 0) > 0) throw new AppError(409, 'Lokasi masih digunakan')

  await db.delete(locations).where(eq(locations.id_lokasi, id))
  return toLocationResponse(current)
}
