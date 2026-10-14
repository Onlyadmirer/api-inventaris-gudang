import { afterAll, describe, expect, it } from 'bun:test'
import { and, asc, eq, inArray } from 'drizzle-orm'
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

async function createItem(kode: string, stok: number, batas: number): Promise<number> {
  const [row] = await db
    .insert(items)
    .values({
      kategori_id: seedCategory.id_kategori,
      kode_barang: kode,
      nama_barang: `Barang ${kode}`,
      stok_saat_ini: stok,
      batas_stok_minimum: batas,
    })
    .returning()
  createdItemIds.push(row.id_barang)
  return row.id_barang
}

describe('B6 dashboard - akses', () => {
  it('tanpa token -> 401', async () => {
    const res = await request('GET', '/dashboard')
    expect(res.status).toBe(401)
  })

  it('STAF dilarang -> 403', async () => {
    const token = await tokenFor('staf@inventaris.test')
    const res = await request('GET', '/dashboard', { token })
    expect(res.status).toBe(403)
  })
})

describe('B6 dashboard - isi', () => {
  it('ADMIN mendapat ringkasan lengkap', async () => {
    const token = await tokenFor('admin@inventaris.test')
    const res = await request('GET', '/dashboard', { token })
    expect(res.status).toBe(200)

    const json = (await res.json()) as Record<string, any>
    expect(typeof json.total_barang).toBe('number')
    expect(typeof json.total_stok).toBe('number')
    expect(typeof json.transaksi_masuk_hari_ini).toBe('number')
    expect(typeof json.transaksi_keluar_hari_ini).toBe('number')
    expect(typeof json.jumlah_barang_kritis).toBe('number')
    expect(Array.isArray(json.barang_kritis)).toBe(true)
    expect(Array.isArray(json.pergerakan_terakhir)).toBe(true)
    expect(Array.isArray(json.grafik_transaksi)).toBe(true)
    expect(json.grafik_transaksi.length).toBe(7)
  })

  it('?hari=3 mengembalikan 3 titik grafik', async () => {
    const token = await tokenFor('admin@inventaris.test')
    const res = await request('GET', '/dashboard?hari=3', { token })
    const json = (await res.json()) as Record<string, any>
    expect(json.grafik_transaksi.length).toBe(3)
  })

  it('barang kritis & grafik mencerminkan transaksi', async () => {
    const staf = await tokenFor('staf@inventaris.test')
    const admin = await tokenFor('admin@inventaris.test')
    const itemId = await createItem(`DASH-${suffix}`, 0, 5)

    const trxRes = await request('POST', '/transactions/masuk', {
      token: staf,
      body: { items: [{ barang_id: itemId, jumlah: 4 }] },
    })
    const trx = (await trxRes.json()) as Record<string, any>
    createdTrxIds.push(trx.id_transaksi)

    const res = await request('GET', '/dashboard?hari=1', { token: admin })
    const json = (await res.json()) as Record<string, any>

    const kritis = json.barang_kritis.find((i: any) => i.id_barang === itemId)
    expect(kritis).toBeDefined()
    expect(kritis.stok_saat_ini).toBe(4)
    expect(kritis.kekurangan).toBe(1)

    expect(json.grafik_transaksi[0].total_masuk).toBeGreaterThanOrEqual(4)
    expect(json.pergerakan_terakhir.length).toBeGreaterThan(0)
    expect(typeof json.pergerakan_terakhir[0].nama_user).toBe('string')
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
    await db
      .delete(activity_logs)
      .where(
        and(
          eq(activity_logs.entitas_terkait, 'transactions'),
          inArray(activity_logs.entitas_id, createdTrxIds),
        ),
      )
  }
  if (createdItemIds.length > 0) {
    await db.delete(items).where(inArray(items.id_barang, createdItemIds))
  }
})
