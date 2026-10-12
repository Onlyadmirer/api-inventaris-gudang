import { and, asc, eq, ne, sql } from 'drizzle-orm'
import { db } from '../../db'
import { categories, items } from '../../db/schema'
import { AppError } from '../../plugins/error'

type CategoryRow = typeof categories.$inferSelect

export type CategoryResponse = {
  id_kategori: number
  nama_kategori: string
  deskripsi: string | null
}

export function toCategoryResponse(category: CategoryRow): CategoryResponse {
  return {
    id_kategori: category.id_kategori,
    nama_kategori: category.nama_kategori,
    deskripsi: category.deskripsi,
  }
}

async function assertNameAvailable(nama_kategori: string, excludeId?: number): Promise<void> {
  const conditions = [eq(categories.nama_kategori, nama_kategori)]
  if (excludeId !== undefined) conditions.push(ne(categories.id_kategori, excludeId))

  const rows = await db
    .select({ id_kategori: categories.id_kategori })
    .from(categories)
    .where(and(...conditions))
    .limit(1)

  if (rows.length > 0) throw new AppError(409, 'Nama kategori sudah digunakan')
}

export async function listCategories() {
  const rows = await db.select().from(categories).orderBy(asc(categories.id_kategori))
  return { data: rows.map(toCategoryResponse) }
}

export async function findCategoryById(id: number): Promise<CategoryRow> {
  const rows = await db.select().from(categories).where(eq(categories.id_kategori, id)).limit(1)
  const row = rows[0]
  if (!row) throw new AppError(404, 'Kategori tidak ditemukan')
  return row
}

export type CreateCategoryInput = {
  nama_kategori: string
  deskripsi?: string
}

export async function createCategory(input: CreateCategoryInput): Promise<CategoryResponse> {
  await assertNameAvailable(input.nama_kategori)

  try {
    const [created] = await db
      .insert(categories)
      .values({ nama_kategori: input.nama_kategori, deskripsi: input.deskripsi ?? null })
      .returning()
    return toCategoryResponse(created)
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new AppError(409, 'Nama kategori sudah digunakan')
    }
    throw error
  }
}

export type UpdateCategoryInput = {
  nama_kategori?: string
  deskripsi?: string | null
}

export async function updateCategory(id: number, input: UpdateCategoryInput): Promise<CategoryResponse> {
  await findCategoryById(id)

  if (input.nama_kategori !== undefined) {
    await assertNameAvailable(input.nama_kategori, id)
  }

  const patch: Partial<typeof categories.$inferInsert> = {}
  if (input.nama_kategori !== undefined) patch.nama_kategori = input.nama_kategori
  if (input.deskripsi !== undefined) patch.deskripsi = input.deskripsi

  if (Object.keys(patch).length === 0) throw new AppError(400, 'Tidak ada data yang diubah')

  try {
    const [updated] = await db
      .update(categories)
      .set(patch)
      .where(eq(categories.id_kategori, id))
      .returning()
    return toCategoryResponse(updated)
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new AppError(409, 'Nama kategori sudah digunakan')
    }
    throw error
  }
}

export async function deleteCategory(id: number): Promise<CategoryResponse> {
  const current = await findCategoryById(id)

  const used = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(items)
    .where(eq(items.kategori_id, id))

  if ((used[0]?.total ?? 0) > 0) throw new AppError(409, 'Kategori masih digunakan')

  await db.delete(categories).where(eq(categories.id_kategori, id))
  return toCategoryResponse(current)
}
