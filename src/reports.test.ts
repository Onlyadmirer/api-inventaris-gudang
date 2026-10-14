import { afterAll, describe, expect, it } from 'bun:test'
import { asc, inArray, sql } from 'drizzle-orm'
import { app } from './index'
import { db } from './db'
import {
  activity_logs,
  categories,
  items,
  notification_logs,
  stock_movements,
  transaction_details,
  transactions,
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

async function seedTransaksi(token: string): Promise<number> {
  const itemId = await createItem(`REP-${suffix}`, 0)
  const res = await request('POST', '/transactions/masuk', {
    token,
    body: { items: [{ barang_id: itemId, jumlah: 6 }] },
  })
  const json = (await res.json()) as Record<string, any>
  createdTrxIds.push(json.id_transaksi)
  return json.id_transaksi
}

describe('B6 laporan - akses & validasi', () => {
  it('tanpa token -> 401', async () => {
    expect((await request('GET', '/reports/stok')).status).toBe(401)
  })

  it('STAF dilarang -> 403', async () => {
    const token = await tokenFor('staf@inventaris.test')
    expect((await request('GET', '/reports/stok', { token })).status).toBe(403)
  })

  it('jenis tidak dikenal -> 400', async () => {
    const token = await tokenFor('admin@inventaris.test')
    expect((await request('GET', '/reports/xyz', { token })).status).toBe(400)
  })

  it('format tanggal tidak valid -> 400', async () => {
    const token = await tokenFor('admin@inventaris.test')
    const res = await request('GET', '/reports/transaksi?dari=bukan-tanggal', { token })
    expect(res.status).toBe(400)
  })

  it('format ekspor tidak valid -> 400', async () => {
    const token = await tokenFor('admin@inventaris.test')
    const res = await request('GET', '/reports/stok/export?format=csv', { token })
    expect(res.status).toBe(400)
  })
})

describe('B6 laporan - data', () => {
  it('laporan stok + ringkasan', async () => {
    const token = await tokenFor('admin@inventaris.test')
    const res = await request('GET', '/reports/stok', { token })
    expect(res.status).toBe(200)

    const json = (await res.json()) as Record<string, any>
    expect(json.jenis).toBe('stok')
    expect(Array.isArray(json.data)).toBe(true)
    expect(json.ringkasan.total_item).toBe(json.data.length)
    expect(typeof json.ringkasan.total_stok).toBe('number')
    for (const row of json.data) {
      expect(['kritis', 'aman']).toContain(row.status)
    }
  })

  it('laporan transaksi nested + filter rentang', async () => {
    const staf = await tokenFor('staf@inventaris.test')
    const admin = await tokenFor('admin@inventaris.test')
    const trxId = await seedTransaksi(staf)

    const inRange = await request('GET', '/reports/transaksi?dari=2000-01-01&sampai=2100-01-01', {
      token: admin,
    })
    const inJson = (await inRange.json()) as Record<string, any>
    const found = inJson.data.find((t: any) => t.id_transaksi === trxId)
    expect(found).toBeDefined()
    expect(found.items.length).toBe(1)
    expect(found.items[0].jumlah).toBe(6)

    const outRange = await request('GET', '/reports/transaksi?sampai=2000-01-01', { token: admin })
    const outJson = (await outRange.json()) as Record<string, any>
    expect(outJson.data.length).toBe(0)
  })

  it('laporan opname', async () => {
    const token = await tokenFor('admin@inventaris.test')
    const res = await request('GET', '/reports/opname?dari=2000-01-01', { token })
    expect(res.status).toBe(200)
    const json = (await res.json()) as Record<string, any>
    expect(json.jenis).toBe('opname')
    expect(Array.isArray(json.data)).toBe(true)
  })
})

describe('B6 laporan - ekspor', () => {
  it('ekspor xlsx -> content-type & magic bytes PK', async () => {
    const token = await tokenFor('admin@inventaris.test')
    const res = await request('GET', '/reports/stok/export?format=xlsx', { token })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('spreadsheetml.sheet')
    expect(res.headers.get('content-disposition')).toContain('laporan-stok')

    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)
  })

  it('ekspor pdf -> content-type & magic bytes %PDF', async () => {
    const token = await tokenFor('admin@inventaris.test')
    const res = await request('GET', '/reports/stok/export?format=pdf', { token })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')

    const bytes = new Uint8Array(await res.arrayBuffer())
    const header = String.fromCharCode(...bytes.slice(0, 4))
    expect(header).toBe('%PDF')
  })

  it('mencatat report.view & report.export ke activity_logs', async () => {
    const logs = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(activity_logs)
      .where(inArray(activity_logs.aksi, ['report.view', 'report.export']))
    expect(logs[0]!.total).toBeGreaterThan(0)
  })
})

afterAll(async () => {
  if (createdItemIds.length > 0) {
    await db.delete(notification_logs).where(inArray(notification_logs.barang_id, createdItemIds))
    await db.delete(stock_movements).where(inArray(stock_movements.barang_id, createdItemIds))
    await db
      .delete(transaction_details)
      .where(inArray(transaction_details.barang_id, createdItemIds))
  }
  if (createdTrxIds.length > 0) {
    await db.delete(transactions).where(inArray(transactions.id_transaksi, createdTrxIds))
  }
  if (createdItemIds.length > 0) {
    await db.delete(items).where(inArray(items.id_barang, createdItemIds))
  }
})
