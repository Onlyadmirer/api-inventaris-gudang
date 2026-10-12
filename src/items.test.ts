import { afterAll, describe, expect, it } from 'bun:test'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { app } from './index'
import { db } from './db'
import {
  activity_logs,
  categories,
  items,
  locations,
  transaction_details,
  transactions,
  users,
} from './db/schema'

const BASE = 'http://localhost/api'
const PASSWORD = 'password123'
const suffix = Date.now().toString(36)

const createdItemIds: number[] = []
const createdTrxIds: number[] = []

const [seedCategory] = await db
  .select()
  .from(categories)
  .orderBy(asc(categories.id_kategori))
  .limit(1)
const [seedLocation] = await db
  .select()
  .from(locations)
  .orderBy(asc(locations.id_lokasi))
  .limit(1)
const [adminUser] = await db
  .select()
  .from(users)
  .where(eq(users.email, 'admin@inventaris.test'))
  .limit(1)

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

describe('UC-08 pencarian & daftar barang', () => {
  it('tanpa token -> 401', async () => {
    const res = await request('GET', '/items')
    expect(res.status).toBe(401)
  })

  it('STAF melihat daftar terpaginasi + join kategori/lokasi', async () => {
    const token = await tokenFor('staf@inventaris.test')
    const res = await request('GET', '/items?page=1&limit=5', { token })
    expect(res.status).toBe(200)

    const json = (await res.json()) as Record<string, any>
    expect(Array.isArray(json.data)).toBe(true)
    expect(json.data.length).toBeLessThanOrEqual(5)
    expect(json.meta).toMatchObject({ page: 1, limit: 5 })
    expect(typeof json.meta.total).toBe('number')

    const first = json.data[0]
    expect(first.kategori).toBeDefined()
    expect(typeof first.kategori.nama_kategori).toBe('string')
    expect(typeof first.stok_saat_ini).toBe('number')
  })

  it('q cocok ke nama_barang maupun kode_barang', async () => {
    const token = await tokenFor('staf@inventaris.test')

    const byCode = await request('GET', '/items?q=ELK-001', { token })
    const codeJson = (await byCode.json()) as Record<string, any>
    expect(codeJson.data.some((i: any) => i.kode_barang === 'ELK-001')).toBe(true)

    const byName = await request('GET', '/items?q=laptop', { token })
    const nameJson = (await byName.json()) as Record<string, any>
    expect(nameJson.data.some((i: any) => i.nama_barang.includes('Laptop'))).toBe(true)
  })

  it('hasil kosong -> 200 dengan data kosong', async () => {
    const token = await tokenFor('staf@inventaris.test')
    const res = await request('GET', `/items?q=tidakada-${suffix}`, { token })
    expect(res.status).toBe(200)
    const json = (await res.json()) as Record<string, any>
    expect(json.data).toEqual([])
    expect(json.meta.total).toBe(0)
  })

  it('filter kategori_id', async () => {
    const token = await tokenFor('staf@inventaris.test')
    const res = await request('GET', `/items?kategori_id=${seedCategory.id_kategori}`, { token })
    expect(res.status).toBe(200)
    const json = (await res.json()) as Record<string, any>
    for (const item of json.data) {
      expect(item.kategori_id).toBe(seedCategory.id_kategori)
    }
  })
})

describe('UC-09 by-code & detail', () => {
  it('kode ada -> detail + stok', async () => {
    const token = await tokenFor('staf@inventaris.test')
    const res = await request('GET', '/items/by-code/ELK-001', { token })
    expect(res.status).toBe(200)
    const json = (await res.json()) as Record<string, any>
    expect(json.kode_barang).toBe('ELK-001')
    expect(typeof json.stok_saat_ini).toBe('number')
  })

  it('kode tidak ada -> 404 "Barang tidak ditemukan"', async () => {
    const token = await tokenFor('staf@inventaris.test')
    const res = await request('GET', `/items/by-code/NOPE-${suffix}`, { token })
    expect(res.status).toBe(404)
    expect((await res.json()) as Record<string, any>).toEqual({
      message: 'Barang tidak ditemukan',
    })
  })

  it('id tidak ada -> 404', async () => {
    const token = await tokenFor('staf@inventaris.test')
    const res = await request('GET', '/items/999999', { token })
    expect(res.status).toBe(404)
  })
})

describe('UC-03 CRUD barang', () => {
  it('STAF dilarang menambah -> 403', async () => {
    const token = await tokenFor('staf@inventaris.test')
    const res = await request('POST', '/items', {
      token,
      body: {
        kategori_id: seedCategory.id_kategori,
        kode_barang: `DENY-${suffix}`,
        nama_barang: 'Barang terlarang',
      },
    })
    expect(res.status).toBe(403)
  })

  it('ADMIN menambah -> 201, stok & batas diabaikan', async () => {
    const token = await tokenFor('admin@inventaris.test')
    const res = await request('POST', '/items', {
      token,
      body: {
        kategori_id: seedCategory.id_kategori,
        lokasi_id: seedLocation.id_lokasi,
        kode_barang: `ITEMMST-${suffix}`,
        nama_barang: 'Barang Uji Master',
        stok_saat_ini: 999,
        batas_stok_minimum: 999,
      },
    })
    expect(res.status).toBe(201)

    const json = (await res.json()) as Record<string, any>
    createdItemIds.push(json.id_barang)
    expect(json.kode_barang).toBe(`ITEMMST-${suffix}`)
    expect(json.stok_saat_ini).toBe(0)
    expect(json.batas_stok_minimum).toBe(0)
    expect(json.kategori.id_kategori).toBe(seedCategory.id_kategori)
    expect(json.lokasi.id_lokasi).toBe(seedLocation.id_lokasi)

    const logs = await db
      .select()
      .from(activity_logs)
      .where(and(eq(activity_logs.aksi, 'item.create'), eq(activity_logs.entitas_id, json.id_barang)))
    expect(logs.length).toBeGreaterThan(0)
  })

  it('kode_barang duplikat -> 409', async () => {
    const token = await tokenFor('admin@inventaris.test')
    const res = await request('POST', '/items', {
      token,
      body: {
        kategori_id: seedCategory.id_kategori,
        kode_barang: `ITEMMST-${suffix}`,
        nama_barang: 'Duplikat',
      },
    })
    expect(res.status).toBe(409)
    expect((await res.json()) as Record<string, any>).toEqual({
      message: 'Kode barang sudah digunakan',
    })
  })

  it('kategori tidak ada -> 400', async () => {
    const token = await tokenFor('admin@inventaris.test')
    const res = await request('POST', '/items', {
      token,
      body: {
        kategori_id: 999999,
        kode_barang: `NOKAT-${suffix}`,
        nama_barang: 'Tanpa kategori',
      },
    })
    expect(res.status).toBe(400)
  })

  it('update tidak mengubah stok & batas minimum', async () => {
    const token = await tokenFor('admin@inventaris.test')
    const id = createdItemIds[0]
    const res = await request('PATCH', `/items/${id}`, {
      token,
      body: { nama_barang: 'Barang Diubah', stok_saat_ini: 500, batas_stok_minimum: 500 },
    })
    expect(res.status).toBe(200)

    const json = (await res.json()) as Record<string, any>
    expect(json.nama_barang).toBe('Barang Diubah')
    expect(json.stok_saat_ini).toBe(0)
    expect(json.batas_stok_minimum).toBe(0)
  })

  it('hapus barang yang dipakai transaksi -> 409', async () => {
    const token = await tokenFor('admin@inventaris.test')

    const createRes = await request('POST', '/items', {
      token,
      body: {
        kategori_id: seedCategory.id_kategori,
        kode_barang: `ITEMREF-${suffix}`,
        nama_barang: 'Barang Referensi Transaksi',
      },
    })
    const created = (await createRes.json()) as Record<string, any>
    createdItemIds.push(created.id_barang)

    const [trx] = await db
      .insert(transactions)
      .values({ user_id: adminUser.id_user, jenis_transaksi: 'masuk' })
      .returning()
    createdTrxIds.push(trx.id_transaksi)
    await db.insert(transaction_details).values({
      transaksi_id: trx.id_transaksi,
      barang_id: created.id_barang,
      jumlah: 1,
    })

    const res = await request('DELETE', `/items/${created.id_barang}`, { token })
    expect(res.status).toBe(409)
    expect((await res.json()) as Record<string, any>).toEqual({
      message: 'Barang masih digunakan',
    })
  })

  it('hapus barang yang tidak terpakai -> 200', async () => {
    const token = await tokenFor('admin@inventaris.test')
    const createRes = await request('POST', '/items', {
      token,
      body: {
        kategori_id: seedCategory.id_kategori,
        kode_barang: `ITEMDEL-${suffix}`,
        nama_barang: 'Barang Hapus',
      },
    })
    const created = (await createRes.json()) as Record<string, any>
    createdItemIds.push(created.id_barang)

    const res = await request('DELETE', `/items/${created.id_barang}`, { token })
    expect(res.status).toBe(200)
    expect((await res.json()) as Record<string, any>).toEqual({ message: 'Barang dihapus' })
  })
})

describe('UC-04 batas stok minimum', () => {
  it('STAF -> 403', async () => {
    const token = await tokenFor('staf@inventaris.test')
    const res = await request('PATCH', `/items/${createdItemIds[0]}/min-stock`, {
      token,
      body: { batas_stok_minimum: 5 },
    })
    expect(res.status).toBe(403)
  })

  it('KEPALA_GUDANG -> 403 (hanya Admin)', async () => {
    const token = await tokenFor('kepala@inventaris.test')
    const res = await request('PATCH', `/items/${createdItemIds[0]}/min-stock`, {
      token,
      body: { batas_stok_minimum: 5 },
    })
    expect(res.status).toBe(403)
  })

  it('nilai negatif -> 400', async () => {
    const token = await tokenFor('admin@inventaris.test')
    const res = await request('PATCH', `/items/${createdItemIds[0]}/min-stock`, {
      token,
      body: { batas_stok_minimum: -1 },
    })
    expect(res.status).toBe(400)
  })

  it('ADMIN mengubah -> 200 + tercatat', async () => {
    const token = await tokenFor('admin@inventaris.test')
    const id = createdItemIds[0]
    const res = await request('PATCH', `/items/${id}/min-stock`, {
      token,
      body: { batas_stok_minimum: 7 },
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as Record<string, any>).batas_stok_minimum).toBe(7)

    const logs = await db
      .select()
      .from(activity_logs)
      .where(
        and(eq(activity_logs.aksi, 'item.min_stock_update'), eq(activity_logs.entitas_id, id)),
      )
    expect(logs.length).toBeGreaterThan(0)
  })
})

afterAll(async () => {
  if (createdTrxIds.length > 0) {
    await db.delete(transaction_details).where(inArray(transaction_details.transaksi_id, createdTrxIds))
    await db.delete(transactions).where(inArray(transactions.id_transaksi, createdTrxIds))
  }
  if (createdItemIds.length > 0) {
    await db
      .delete(activity_logs)
      .where(
        and(
          eq(activity_logs.entitas_terkait, 'items'),
          inArray(activity_logs.entitas_id, createdItemIds),
        ),
      )
    await db.delete(items).where(inArray(items.id_barang, createdItemIds))
  }
})
