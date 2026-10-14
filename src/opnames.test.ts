import { afterAll, describe, expect, it } from 'bun:test'
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm'
import { app } from './index'
import { db } from './db'
import {
  activity_logs,
  categories,
  items,
  notification_logs,
  stock_movements,
  stock_opname_details,
  stock_opnames,
} from './db/schema'

const BASE = 'http://localhost/api'
const PASSWORD = 'password123'
const suffix = Date.now().toString(36)

const createdItemIds: number[] = []
const createdOpnameIds: number[] = []

const [seedCategory] = await db
  .select()
  .from(categories)
  .orderBy(asc(categories.id_kategori))
  .limit(1)

function request(method: string, path: string, options: { body?: unknown; token?: string } = {}) {
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

async function createItem(kode: string, stok: number): Promise<number> {
  const [row] = await db
    .insert(items)
    .values({
      kategori_id: seedCategory.id_kategori,
      kode_barang: kode,
      nama_barang: `Barang ${kode}`,
      stok_saat_ini: stok,
      batas_stok_minimum: 0,
    })
    .returning()
  createdItemIds.push(row.id_barang)
  return row.id_barang
}

async function stockOf(id: number): Promise<number> {
  const [row] = await db
    .select({ stok: items.stok_saat_ini })
    .from(items)
    .where(eq(items.id_barang, id))
    .limit(1)
  return row!.stok
}

async function createOpname(token: string, keterangan = 'Opname uji'): Promise<number> {
  const res = await request('POST', '/opnames', { token, body: { keterangan } })
  const json = (await res.json()) as Record<string, any>
  createdOpnameIds.push(json.id_opname)
  return json.id_opname
}

describe('B5 opname - akses', () => {
  it('ADMIN dilarang -> 403', async () => {
    const token = await tokenFor('admin@inventaris.test')
    const res = await request('POST', '/opnames', { token, body: {} })
    expect(res.status).toBe(403)
  })

  it('STAF membuat sesi draft -> 201', async () => {
    const token = await tokenFor('staf@inventaris.test')
    const res = await request('POST', '/opnames', { token, body: { keterangan: 'Sesi pagi' } })
    expect(res.status).toBe(201)

    const json = (await res.json()) as Record<string, any>
    createdOpnameIds.push(json.id_opname)
    expect(json.status).toBe('draft')
    expect(json.keterangan).toBe('Sesi pagi')
    expect(typeof json.nama_user).toBe('string')
  })
})

describe('B5 opname - list', () => {
  it('paginasi + data', async () => {
    const token = await tokenFor('staf@inventaris.test')
    const res = await request('GET', '/opnames?page=1&limit=5', { token })
    expect(res.status).toBe(200)

    const json = (await res.json()) as Record<string, any>
    expect(Array.isArray(json.data)).toBe(true)
    expect(json.meta).toMatchObject({ page: 1, limit: 5 })
    expect(typeof json.meta.total).toBe('number')
    if (json.data.length > 0) {
      expect(typeof json.data[0].jumlah_item).toBe('number')
      expect(typeof json.data[0].jumlah_selisih).toBe('number')
    }
  })

  it('filter status=draft', async () => {
    const token = await tokenFor('staf@inventaris.test')
    const res = await request('GET', '/opnames?status=draft', { token })
    expect(res.status).toBe(200)
    const json = (await res.json()) as Record<string, any>
    for (const row of json.data) expect(row.status).toBe('draft')
  })
})

describe('B5 opname - input detail', () => {
  it('barang tidak ada -> 404', async () => {
    const token = await tokenFor('staf@inventaris.test')
    const opnameId = await createOpname(token, `Detail404-${suffix}`)
    const res = await request('POST', `/opnames/${opnameId}/details`, {
      token,
      body: { barang_id: 999999, stok_fisik: 1 },
    })
    expect(res.status).toBe(404)
    expect((await res.json()) as Record<string, any>).toEqual({ message: 'Barang tidak ditemukan' })
  })

  it('menghitung selisih = fisik - sistem', async () => {
    const token = await tokenFor('staf@inventaris.test')
    const itemId = await createItem(`OPN-DET-${suffix}`, 10)
    const opnameId = await createOpname(token, `Detail-${suffix}`)

    const res = await request('POST', `/opnames/${opnameId}/details`, {
      token,
      body: { barang_id: itemId, stok_fisik: 7 },
    })
    expect(res.status).toBe(201)

    const json = (await res.json()) as Record<string, any>
    expect(json).toMatchObject({
      barang_id: itemId,
      stok_sistem: 10,
      stok_fisik: 7,
      selisih: -3,
    })
    expect(json.kode_barang).toBe(`OPN-DET-${suffix}`)
  })
})

describe('B5 opname - finalize', () => {
  it('STAF finalize -> 403 (hanya Kepala)', async () => {
    const token = await tokenFor('staf@inventaris.test')
    const opnameId = await createOpname(token, `Final403-${suffix}`)
    const res = await request('POST', `/opnames/${opnameId}/finalize`, {
      token,
      body: { sinkronkan: true },
    })
    expect(res.status).toBe(403)
  })

  it('finalize tanpa detail -> 400', async () => {
    const kepalas = await tokenFor('kepala@inventaris.test')
    const opnameId = await createOpname(kepalas, `Kosong-${suffix}`)
    const res = await request('POST', `/opnames/${opnameId}/finalize`, {
      token: kepalas,
      body: { sinkronkan: true },
    })
    expect(res.status).toBe(400)
    expect((await res.json()) as Record<string, any>).toEqual({
      message: 'Opname belum memiliki detail',
    })
  })

  it('sinkronkan=true menyetel stok, movement penyesuaian, status selesai', async () => {
    const stafs = await tokenFor('staf@inventaris.test')
    const kepalas = await tokenFor('kepala@inventaris.test')
    const itemId = await createItem(`OPN-SYNC-${suffix}`, 10)
    const opnameId = await createOpname(stafs, `Sync-${suffix}`)

    await request('POST', `/opnames/${opnameId}/details`, {
      token: stafs,
      body: { barang_id: itemId, stok_fisik: 5 },
    })

    const res = await request('POST', `/opnames/${opnameId}/finalize`, {
      token: kepalas,
      body: { sinkronkan: true },
    })
    expect(res.status).toBe(200)

    const json = (await res.json()) as Record<string, any>
    expect(json.status).toBe('selesai')

    expect(await stockOf(itemId)).toBe(5)

    const movements = await db
      .select()
      .from(stock_movements)
      .where(eq(stock_movements.opname_id, opnameId))
    expect(movements.length).toBe(1)
    expect(movements[0]).toMatchObject({
      barang_id: itemId,
      jenis_pergerakan: 'penyesuaian',
      jumlah: -5,
      stok_sebelum: 10,
      stok_sesudah: 5,
      transaksi_id: null,
    })
  })

  it('sinkronkan=false -> selesai tanpa mengubah stok/movement', async () => {
    const stafs = await tokenFor('staf@inventaris.test')
    const kepalas = await tokenFor('kepala@inventaris.test')
    const itemId = await createItem(`OPN-NOSYNC-${suffix}`, 20)
    const opnameId = await createOpname(stafs, `NoSync-${suffix}`)

    await request('POST', `/opnames/${opnameId}/details`, {
      token: stafs,
      body: { barang_id: itemId, stok_fisik: 15 },
    })

    const res = await request('POST', `/opnames/${opnameId}/finalize`, {
      token: kepalas,
      body: { sinkronkan: false },
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as Record<string, any>).status).toBe('selesai')

    expect(await stockOf(itemId)).toBe(20)

    const movements = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(stock_movements)
      .where(eq(stock_movements.opname_id, opnameId))
    expect(movements[0]!.total).toBe(0)
  })

  it('finalize opname yang sudah selesai -> 409', async () => {
    const kepalas = await tokenFor('kepala@inventaris.test')
    const stafs = await tokenFor('staf@inventaris.test')
    const itemId = await createItem(`OPN-TWICE-${suffix}`, 4)
    const opnameId = await createOpname(stafs, `Twice-${suffix}`)

    await request('POST', `/opnames/${opnameId}/details`, {
      token: stafs,
      body: { barang_id: itemId, stok_fisik: 4 },
    })

    const first = await request('POST', `/opnames/${opnameId}/finalize`, {
      token: kepalas,
      body: { sinkronkan: true },
    })
    expect(first.status).toBe(200)

    const second = await request('POST', `/opnames/${opnameId}/finalize`, {
      token: kepalas,
      body: { sinkronkan: true },
    })
    expect(second.status).toBe(409)

    const detailRes = await request('POST', `/opnames/${opnameId}/details`, {
      token: stafs,
      body: { barang_id: itemId, stok_fisik: 1 },
    })
    expect(detailRes.status).toBe(409)
  })
})

describe('B5 opname - upsert & ringkasan', () => {
  it('input ulang barang sama -> satu detail dengan nilai terbaru', async () => {
    const token = await tokenFor('staf@inventaris.test')
    const itemId = await createItem(`OPN-UPSERT-${suffix}`, 30)
    const opnameId = await createOpname(token, `Upsert-${suffix}`)

    await request('POST', `/opnames/${opnameId}/details`, {
      token,
      body: { barang_id: itemId, stok_fisik: 25 },
    })
    const res = await request('POST', `/opnames/${opnameId}/details`, {
      token,
      body: { barang_id: itemId, stok_fisik: 28, keterangan: 'Hitung ulang' },
    })
    expect(res.status).toBe(201)
    expect(((await res.json()) as Record<string, any>).selisih).toBe(-2)

    const rows = await db
      .select()
      .from(stock_opname_details)
      .where(eq(stock_opname_details.opname_id, opnameId))
    expect(rows.length).toBe(1)
    expect(rows[0]!.stok_fisik).toBe(28)
    expect(rows[0]!.selisih).toBe(-2)
  })

  it('ringkasan sesuai/selisih', async () => {
    const token = await tokenFor('staf@inventaris.test')
    const itemA = await createItem(`OPN-RING-A-${suffix}`, 5)
    const itemB = await createItem(`OPN-RING-B-${suffix}`, 5)
    const opnameId = await createOpname(token, `Ringkasan-${suffix}`)

    await request('POST', `/opnames/${opnameId}/details`, {
      token,
      body: { barang_id: itemA, stok_fisik: 5 },
    })
    await request('POST', `/opnames/${opnameId}/details`, {
      token,
      body: { barang_id: itemB, stok_fisik: 3 },
    })

    const res = await request('GET', `/opnames/${opnameId}`, { token })
    expect(res.status).toBe(200)

    const json = (await res.json()) as Record<string, any>
    expect(json.ringkasan).toEqual({ total_item: 2, jumlah_sesuai: 1, jumlah_selisih: 1 })
    expect(json.details.length).toBe(2)
  })
})

afterAll(async () => {
  if (createdOpnameIds.length > 0) {
    await db
      .delete(stock_movements)
      .where(
        or(
          inArray(stock_movements.opname_id, createdOpnameIds),
          createdItemIds.length > 0 ? inArray(stock_movements.barang_id, createdItemIds) : undefined,
        ),
      )
    await db
      .delete(stock_opname_details)
      .where(inArray(stock_opname_details.opname_id, createdOpnameIds))
    await db
      .delete(activity_logs)
      .where(
        and(
          eq(activity_logs.entitas_terkait, 'stock_opnames'),
          inArray(activity_logs.entitas_id, createdOpnameIds),
        ),
      )
    await db.delete(stock_opnames).where(inArray(stock_opnames.id_opname, createdOpnameIds))
  }
  if (createdItemIds.length > 0) {
    await db.delete(notification_logs).where(inArray(notification_logs.barang_id, createdItemIds))
    await db.delete(items).where(inArray(items.id_barang, createdItemIds))
  }
})
