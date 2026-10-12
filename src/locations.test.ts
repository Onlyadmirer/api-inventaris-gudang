import { afterAll, describe, expect, it } from 'bun:test'
import { and, eq, inArray } from 'drizzle-orm'
import { app } from './index'
import { db } from './db'
import { activity_logs, categories, items, locations } from './db/schema'

const BASE = 'http://localhost/api'
const PASSWORD = 'password123'
const suffix = Date.now().toString(36)

const createdLocationIds: number[] = []
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

describe('UC-03 Lokasi', () => {
  it('STAF boleh melihat daftar lokasi (GET = semua role)', async () => {
    const token = await tokenFor('staf@inventaris.test')
    const res = await request('GET', '/locations', { token })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { data: unknown[] }
    expect(Array.isArray(json.data)).toBe(true)
  })

  it('STAF tidak boleh menambah lokasi -> 403', async () => {
    const token = await tokenFor('staf@inventaris.test')
    const res = await request('POST', '/locations', {
      token,
      body: { nama_rak: `Rak Terlarang ${suffix}` },
    })
    expect(res.status).toBe(403)
  })

  it('KEPALA_GUDANG menambah lokasi -> 201 + tercatat', async () => {
    const token = await tokenFor('kepala@inventaris.test')
    const res = await request('POST', '/locations', {
      token,
      body: { nama_rak: `Rak Uji ${suffix}`, keterangan: 'uji' },
    })
    expect(res.status).toBe(201)

    const json = (await res.json()) as Record<string, any>
    createdLocationIds.push(json.id_lokasi)
    expect(json.nama_rak).toBe(`Rak Uji ${suffix}`)

    const logs = await db
      .select()
      .from(activity_logs)
      .where(and(eq(activity_logs.aksi, 'location.create'), eq(activity_logs.entitas_id, json.id_lokasi)))
    expect(logs.length).toBeGreaterThan(0)
  })

  it('update lokasi -> 200', async () => {
    const token = await tokenFor('admin@inventaris.test')
    const id = createdLocationIds[0]
    const res = await request('PATCH', `/locations/${id}`, {
      token,
      body: { keterangan: 'lokasi diubah' },
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as Record<string, any>).keterangan).toBe('lokasi diubah')
  })

  it('hapus lokasi yang masih dipakai barang -> 409', async () => {
    const token = await tokenFor('admin@inventaris.test')
    const id = createdLocationIds[0]

    const [kategori] = await db.select().from(categories).limit(1)

    const [item] = await db
      .insert(items)
      .values({
        kategori_id: kategori.id_kategori,
        lokasi_id: id,
        kode_barang: `LOKREF-${suffix}`,
        nama_barang: 'Barang referensi lokasi',
      })
      .returning()
    createdItemIds.push(item.id_barang)

    const res = await request('DELETE', `/locations/${id}`, { token })
    expect(res.status).toBe(409)
    expect((await res.json()) as Record<string, any>).toEqual({
      message: 'Lokasi masih digunakan',
    })
  })

  it('hapus lokasi yang tidak terpakai -> 200', async () => {
    const token = await tokenFor('admin@inventaris.test')
    const createRes = await request('POST', '/locations', {
      token,
      body: { nama_rak: `Rak Hapus ${suffix}` },
    })
    const created = (await createRes.json()) as Record<string, any>
    createdLocationIds.push(created.id_lokasi)

    const res = await request('DELETE', `/locations/${created.id_lokasi}`, { token })
    expect(res.status).toBe(200)
    expect((await res.json()) as Record<string, any>).toEqual({ message: 'Lokasi dihapus' })
  })
})

afterAll(async () => {
  if (createdItemIds.length > 0) {
    await db.delete(items).where(inArray(items.id_barang, createdItemIds))
  }
  if (createdLocationIds.length > 0) {
    await db
      .delete(activity_logs)
      .where(
        and(
          eq(activity_logs.entitas_terkait, 'locations'),
          inArray(activity_logs.entitas_id, createdLocationIds),
        ),
      )
    await db.delete(locations).where(inArray(locations.id_lokasi, createdLocationIds))
  }
})
