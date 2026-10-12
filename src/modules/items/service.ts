import { and, asc, eq, ilike, ne, or, sql, type SQL } from 'drizzle-orm'
import { db } from '../../db'
import {
  categories,
  items,
  locations,
  notification_logs,
  stock_movements,
  stock_opname_details,
  transaction_details,
} from '../../db/schema'
import { AppError } from '../../plugins/error'

type ItemRow = typeof items.$inferSelect
type CategoryRow = typeof categories.$inferSelect
type LocationRow = typeof locations.$inferSelect

export type ItemResponse = {
  id_barang: number
  kategori_id: number
  lokasi_id: number | null
  kode_barang: string
  nama_barang: string
  stok_saat_ini: number
  batas_stok_minimum: number
  qr_code: string | null
  created_at: Date
  kategori: { id_kategori: number; nama_kategori: string }
  lokasi: { id_lokasi: number; nama_rak: string } | null
}

function toItemResponse(item: ItemRow, kategori: CategoryRow, lokasi: LocationRow | null): ItemResponse {
  return {
    id_barang: item.id_barang,
    kategori_id: item.kategori_id,
    lokasi_id: item.lokasi_id,
    kode_barang: item.kode_barang,
    nama_barang: item.nama_barang,
    stok_saat_ini: item.stok_saat_ini,
    batas_stok_minimum: item.batas_stok_minimum,
    qr_code: item.qr_code,
    created_at: item.created_at,
    kategori: { id_kategori: kategori.id_kategori, nama_kategori: kategori.nama_kategori },
    lokasi: lokasi ? { id_lokasi: lokasi.id_lokasi, nama_rak: lokasi.nama_rak } : null,
  }
}

function joinedItems() {
  return db
    .select({ item: items, kategori: categories, lokasi: locations })
    .from(items)
    .innerJoin(categories, eq(items.kategori_id, categories.id_kategori))
    .leftJoin(locations, eq(items.lokasi_id, locations.id_lokasi))
}

async function findItemRow(id: number): Promise<ItemRow> {
  const rows = await db.select().from(items).where(eq(items.id_barang, id)).limit(1)
  const row = rows[0]
  if (!row) throw new AppError(404, 'Barang tidak ditemukan')
  return row
}

async function assertCategoryExists(id: number): Promise<void> {
  const rows = await db
    .select({ id_kategori: categories.id_kategori })
    .from(categories)
    .where(eq(categories.id_kategori, id))
    .limit(1)
  if (rows.length === 0) throw new AppError(400, 'Kategori tidak ditemukan')
}

async function assertLocationExists(id: number): Promise<void> {
  const rows = await db
    .select({ id_lokasi: locations.id_lokasi })
    .from(locations)
    .where(eq(locations.id_lokasi, id))
    .limit(1)
  if (rows.length === 0) throw new AppError(400, 'Lokasi tidak ditemukan')
}

async function assertKodeAvailable(kode_barang: string, excludeId?: number): Promise<void> {
  const conditions = [eq(items.kode_barang, kode_barang)]
  if (excludeId !== undefined) conditions.push(ne(items.id_barang, excludeId))

  const rows = await db
    .select({ id_barang: items.id_barang })
    .from(items)
    .where(and(...conditions))
    .limit(1)

  if (rows.length > 0) throw new AppError(409, 'Kode barang sudah digunakan')
}

export type ListItemsFilter = {
  q?: string
  kategori_id?: number
  lokasi_id?: number
  page: number
  limit: number
}

export async function listItems(filter: ListItemsFilter) {
  const conditions: SQL[] = []
  if (filter.q) {
    const pattern = `%${filter.q}%`
    conditions.push(
      or(ilike(items.nama_barang, pattern), ilike(items.kode_barang, pattern))!,
    )
  }
  if (filter.kategori_id !== undefined) conditions.push(eq(items.kategori_id, filter.kategori_id))
  if (filter.lokasi_id !== undefined) conditions.push(eq(items.lokasi_id, filter.lokasi_id))

  const where = conditions.length > 0 ? and(...conditions) : undefined
  const offset = (filter.page - 1) * filter.limit

  const [rows, countResult] = await Promise.all([
    joinedItems()
      .where(where)
      .orderBy(asc(items.id_barang))
      .limit(filter.limit)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(items).where(where),
  ])

  return {
    data: rows.map((r) => toItemResponse(r.item, r.kategori, r.lokasi)),
    meta: { page: filter.page, limit: filter.limit, total: countResult[0]?.total ?? 0 },
  }
}

export async function getItemById(id: number): Promise<ItemResponse> {
  const rows = await joinedItems().where(eq(items.id_barang, id)).limit(1)
  const row = rows[0]
  if (!row) throw new AppError(404, 'Barang tidak ditemukan')
  return toItemResponse(row.item, row.kategori, row.lokasi)
}

export async function getItemByCode(kode: string): Promise<ItemResponse> {
  const rows = await joinedItems().where(eq(items.kode_barang, kode)).limit(1)
  const row = rows[0]
  if (!row) throw new AppError(404, 'Barang tidak ditemukan')
  return toItemResponse(row.item, row.kategori, row.lokasi)
}

export type CreateItemInput = {
  kategori_id: number
  lokasi_id?: number | null
  kode_barang: string
  nama_barang: string
}

export async function createItem(input: CreateItemInput): Promise<ItemResponse> {
  await assertCategoryExists(input.kategori_id)
  if (input.lokasi_id != null) await assertLocationExists(input.lokasi_id)
  await assertKodeAvailable(input.kode_barang)

  try {
    const [created] = await db
      .insert(items)
      .values({
        kategori_id: input.kategori_id,
        lokasi_id: input.lokasi_id ?? null,
        kode_barang: input.kode_barang,
        nama_barang: input.nama_barang,
      })
      .returning()
    return getItemById(created.id_barang)
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new AppError(409, 'Kode barang sudah digunakan')
    }
    throw error
  }
}

export type UpdateItemInput = {
  kategori_id?: number
  lokasi_id?: number | null
  kode_barang?: string
  nama_barang?: string
}

export async function updateItem(id: number, input: UpdateItemInput): Promise<ItemResponse> {
  await findItemRow(id)

  const patch: Partial<typeof items.$inferInsert> = {}
  if (input.kategori_id !== undefined) {
    await assertCategoryExists(input.kategori_id)
    patch.kategori_id = input.kategori_id
  }
  if (input.lokasi_id !== undefined) {
    if (input.lokasi_id != null) await assertLocationExists(input.lokasi_id)
    patch.lokasi_id = input.lokasi_id
  }
  if (input.kode_barang !== undefined) {
    await assertKodeAvailable(input.kode_barang, id)
    patch.kode_barang = input.kode_barang
  }
  if (input.nama_barang !== undefined) patch.nama_barang = input.nama_barang

  if (Object.keys(patch).length === 0) throw new AppError(400, 'Tidak ada data yang diubah')

  try {
    await db.update(items).set(patch).where(eq(items.id_barang, id))
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new AppError(409, 'Kode barang sudah digunakan')
    }
    throw error
  }

  return getItemById(id)
}

export async function updateMinStock(id: number, batas_stok_minimum: number): Promise<ItemResponse> {
  await findItemRow(id)
  await db.update(items).set({ batas_stok_minimum }).where(eq(items.id_barang, id))
  return getItemById(id)
}

export async function deleteItem(id: number): Promise<ItemResponse> {
  const existing = await getItemById(id)

  const [details, opnameDetails, movements, notifications] = await Promise.all([
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(transaction_details)
      .where(eq(transaction_details.barang_id, id)),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(stock_opname_details)
      .where(eq(stock_opname_details.barang_id, id)),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(stock_movements)
      .where(eq(stock_movements.barang_id, id)),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(notification_logs)
      .where(eq(notification_logs.barang_id, id)),
  ])

  const total =
    (details[0]?.total ?? 0) +
    (opnameDetails[0]?.total ?? 0) +
    (movements[0]?.total ?? 0) +
    (notifications[0]?.total ?? 0)

  if (total > 0) throw new AppError(409, 'Barang masih digunakan')

  await db.delete(items).where(eq(items.id_barang, id))
  return existing
}
