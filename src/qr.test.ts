import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { app } from './index'
import { db } from './db'
import { activity_logs, categories, items } from './db/schema'

const BASE = 'http://localhost/api'
const PASSWORD = 'password123'
const suffix = Date.now().toString(36)

const createdItemIds: number[] = []
let itemA: typeof items.$inferSelect
let itemB: typeof items.$inferSelect

beforeAll(async () => {
  const [kategori] = await db
    .select()
    .from(categories)
    .orderBy(asc(categories.id_kategori))
    .limit(1)

  const rows = await db
    .insert(items)
    .values([
      { kategori_id: kategori.id_kategori, kode_barang: `QR-A-${suffix}`, nama_barang: 'QR Barang A' },
      { kategori_id: kategori.id_kategori, kode_barang: `QR-B-${suffix}`, nama_barang: 'QR Barang B' },
    ])
    .returning()

  itemA = rows[0]
  itemB = rows[1]
  createdItemIds.push(itemA.id_barang, itemB.id_barang)
})

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

describe('UC-05 QR code tunggal', () => {
  it('tanpa token -> 401', async () => {
    const res = await request('GET', `/items/${itemA.id_barang}/qr`)
    expect(res.status).toBe(401)
  })

  it('STAF -> 403', async () => {
    const token = await tokenFor('staf@inventaris.test')
    const res = await request('GET', `/items/${itemA.id_barang}/qr`, { token })
    expect(res.status).toBe(403)
  })

  it('ADMIN -> 200 data URL PNG + info barang', async () => {
    const token = await tokenFor('admin@inventaris.test')
    const res = await request('GET', `/items/${itemA.id_barang}/qr`, { token })
    expect(res.status).toBe(200)

    const json = (await res.json()) as Record<string, any>
    expect(json.data_url.startsWith('data:image/png;base64,')).toBe(true)
    expect(json.barang.id_barang).toBe(itemA.id_barang)
    expect(json.barang.kode_barang).toBe(itemA.kode_barang)

    const [saved] = await db.select().from(items).where(eq(items.id_barang, itemA.id_barang))
    expect(saved.qr_code).toBe(itemA.kode_barang)

    const logs = await db
      .select()
      .from(activity_logs)
      .where(and(eq(activity_logs.aksi, 'item.qr_generate'), eq(activity_logs.entitas_id, itemA.id_barang)))
    expect(logs.length).toBeGreaterThan(0)
  })

  it('id tidak ada -> 404 "Barang tidak ditemukan"', async () => {
    const token = await tokenFor('admin@inventaris.test')
    const res = await request('GET', '/items/999999/qr', { token })
    expect(res.status).toBe(404)
    expect((await res.json()) as Record<string, any>).toEqual({
      message: 'Barang tidak ditemukan',
    })
  })
})

describe('UC-05 QR massal', () => {
  it('STAF -> 403', async () => {
    const token = await tokenFor('staf@inventaris.test')
    const res = await request('POST', '/items/qr/batch', {
      token,
      body: { id_barang: [itemA.id_barang] },
    })
    expect(res.status).toBe(403)
  })

  it('KEPALA_GUDANG -> 403', async () => {
    const token = await tokenFor('kepala@inventaris.test')
    const res = await request('POST', '/items/qr/batch', {
      token,
      body: { id_barang: [itemA.id_barang] },
    })
    expect(res.status).toBe(403)
  })

  it('ADMIN -> 200 untuk banyak barang + tersimpan', async () => {
    const token = await tokenFor('admin@inventaris.test')
    const res = await request('POST', '/items/qr/batch', {
      token,
      body: { id_barang: [itemA.id_barang, itemB.id_barang] },
    })
    expect(res.status).toBe(200)

    const json = (await res.json()) as Record<string, any>
    expect(Array.isArray(json.data)).toBe(true)
    expect(json.data.length).toBe(2)
    for (const entry of json.data) {
      expect(entry.data_url.startsWith('data:image/png;base64,')).toBe(true)
    }

    const [savedB] = await db.select().from(items).where(eq(items.id_barang, itemB.id_barang))
    expect(savedB.qr_code).toBe(itemB.kode_barang)
  })

  it('sebagian id tidak ada -> 404', async () => {
    const token = await tokenFor('admin@inventaris.test')
    const res = await request('POST', '/items/qr/batch', {
      token,
      body: { id_barang: [itemA.id_barang, 999999] },
    })
    expect(res.status).toBe(404)
    expect((await res.json()) as Record<string, any>).toEqual({
      message: 'Barang tidak ditemukan',
    })
  })

  it('array kosong -> 400', async () => {
    const token = await tokenFor('admin@inventaris.test')
    const res = await request('POST', '/items/qr/batch', {
      token,
      body: { id_barang: [] },
    })
    expect(res.status).toBe(400)
  })
})

afterAll(async () => {
  await db.delete(activity_logs).where(eq(activity_logs.aksi, 'item.qr_batch'))
  if (createdItemIds.length > 0) {
    await db
      .delete(activity_logs)
      .where(
        and(
          eq(activity_logs.aksi, 'item.qr_generate'),
          inArray(activity_logs.entitas_id, createdItemIds),
        ),
      )
    await db.delete(items).where(inArray(items.id_barang, createdItemIds))
  }
})
