import { afterAll, describe, expect, it } from 'bun:test'
import { and, eq, inArray } from 'drizzle-orm'
import { app } from './index'
import { db } from './db'
import { activity_logs, categories, items } from './db/schema'

const BASE = 'http://localhost/api'
const PASSWORD = 'password123'
const suffix = Date.now().toString(36)

const createdCategoryIds: number[] = []
const createdItemIds: number[] = []

function request(
  method: string,
  path: string,
  options: { body?: unknown; token?: string } = {},
) {
  return app.handle(
    new Request(`${BASE}${path}`, {
      method,
      headers: {
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    }),
  )
}

async function tokenFor(email: string): Promise<string> {
  const res = await request('POST', '/auth/login', { body: { email, password: PASSWORD } })
  const json = (await res.json()) as { token: string }
  return json.token
}

describe('UC-03 Kategori', () => {
  it('STAF boleh melihat daftar kategori (GET = semua role)', async () => {
    const token = await tokenFor('staf@inventaris.test')
    const res = await request('GET', '/categories', { token })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { data: unknown[] }
    expect(Array.isArray(json.data)).toBe(true)
  })

  it('tanpa token -> 401', async () => {
    const res = await request('GET', '/categories')
    expect(res.status).toBe(401)
  })

  it('STAF tidak boleh menambah kategori -> 403', async () => {
    const token = await tokenFor('staf@inventaris.test')
    const res = await request('POST', '/categories', {
      token,
      body: { nama_kategori: `Terlarang ${suffix}` },
    })
    expect(res.status).toBe(403)
  })

  it('ADMIN menambah kategori -> 201 + tercatat di activity_logs', async () => {
    const token = await tokenFor('admin@inventaris.test')
    const res = await request('POST', '/categories', {
      token,
      body: { nama_kategori: `Kategori Uji ${suffix}`, deskripsi: 'uji' },
    })
    expect(res.status).toBe(201)

    const json = (await res.json()) as Record<string, any>
    createdCategoryIds.push(json.id_kategori)
    expect(json.nama_kategori).toBe(`Kategori Uji ${suffix}`)

    const logs = await db
      .select()
      .from(activity_logs)
      .where(and(eq(activity_logs.aksi, 'category.create'), eq(activity_logs.entitas_id, json.id_kategori)))
    expect(logs.length).toBeGreaterThan(0)
  })

  it('nama kategori duplikat -> 409', async () => {
    const token = await tokenFor('admin@inventaris.test')
    const res = await request('POST', '/categories', {
      token,
      body: { nama_kategori: `Kategori Uji ${suffix}` },
    })
    expect(res.status).toBe(409)
    expect((await res.json()) as Record<string, any>).toEqual({
      message: 'Nama kategori sudah digunakan',
    })
  })

  it('KEPALA_GUDANG bisa mengubah kategori -> 200', async () => {
    const token = await tokenFor('kepala@inventaris.test')
    const id = createdCategoryIds[0]
    const res = await request('PATCH', `/categories/${id}`, {
      token,
      body: { deskripsi: 'diubah' },
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as Record<string, any>).deskripsi).toBe('diubah')
  })

  it('hapus kategori yang masih dipakai barang -> 409', async () => {
    const token = await tokenFor('admin@inventaris.test')
    const id = createdCategoryIds[0]

    const [item] = await db
      .insert(items)
      .values({
        kategori_id: id,
        kode_barang: `CATREF-${suffix}`,
        nama_barang: 'Barang referensi kategori',
      })
      .returning()
    createdItemIds.push(item.id_barang)

    const res = await request('DELETE', `/categories/${id}`, { token })
    expect(res.status).toBe(409)
    expect((await res.json()) as Record<string, any>).toEqual({
      message: 'Kategori masih digunakan',
    })
  })

  it('hapus kategori yang tidak terpakai -> 200', async () => {
    const token = await tokenFor('admin@inventaris.test')
    const createRes = await request('POST', '/categories', {
      token,
      body: { nama_kategori: `Kategori Hapus ${suffix}` },
    })
    const created = (await createRes.json()) as Record<string, any>
    createdCategoryIds.push(created.id_kategori)

    const res = await request('DELETE', `/categories/${created.id_kategori}`, { token })
    expect(res.status).toBe(200)
    expect((await res.json()) as Record<string, any>).toEqual({ message: 'Kategori dihapus' })
  })

  it('ubah kategori tidak ada -> 404', async () => {
    const token = await tokenFor('admin@inventaris.test')
    const res = await request('PATCH', '/categories/999999', { token, body: { deskripsi: 'x' } })
    expect(res.status).toBe(404)
  })
})

afterAll(async () => {
  if (createdItemIds.length > 0) {
    await db.delete(items).where(inArray(items.id_barang, createdItemIds))
  }
  if (createdCategoryIds.length > 0) {
    await db
      .delete(activity_logs)
      .where(
        and(
          eq(activity_logs.entitas_terkait, 'categories'),
          inArray(activity_logs.entitas_id, createdCategoryIds),
        ),
      )
    await db.delete(categories).where(inArray(categories.id_kategori, createdCategoryIds))
  }
})
