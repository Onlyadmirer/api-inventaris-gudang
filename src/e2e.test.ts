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
const [adminUser] = await db
  .select()
  .from(users)
  .where(eq(users.email, 'admin@inventaris.test'))
  .limit(1)
const [kepalaUser] = await db
  .select()
  .from(users)
  .where(eq(users.email, 'kepala@inventaris.test'))
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

function track(json: Record<string, any>): void {
  if (typeof json.id_transaksi === 'number') createdTrxIds.push(json.id_transaksi)
}

describe('E2E: login staf -> keluar barang -> stok <= minimum -> notifikasi', () => {
  it('menjalankan skenario penuh end-to-end', async () => {
    const kode = `E2E-${suffix}`
    const admin = await tokenFor('admin@inventaris.test')
    const staf = await tokenFor('staf@inventaris.test')

    const createRes = await request('POST', '/items', {
      token: admin,
      body: { kategori_id: seedCategory!.id_kategori, kode_barang: kode, nama_barang: `Barang ${kode}` },
    })
    expect(createRes.status).toBe(201)
    const item = (await createRes.json()) as Record<string, any>
    createdItemIds.push(item.id_barang)
    expect(item.stok_saat_ini).toBe(0)

    const minRes = await request('PATCH', `/items/${item.id_barang}/min-stock`, {
      token: admin,
      body: { batas_stok_minimum: 5 },
    })
    expect(minRes.status).toBe(200)

    const masukRes = await request('POST', '/transactions/masuk', {
      token: staf,
      body: { items: [{ barang_id: item.id_barang, jumlah: 10 }], sumber: 'scan' },
    })
    expect(masukRes.status).toBe(201)
    track((await masukRes.json()) as Record<string, any>)

    const keluarRes = await request('POST', '/transactions/keluar', {
      token: staf,
      body: { items: [{ kode_barang: kode, jumlah: 6 }], sumber: 'manual' },
    })
    expect(keluarRes.status).toBe(201)
    const keluar = (await keluarRes.json()) as Record<string, any>
    track(keluar)
    expect(keluar.items[0]).toMatchObject({ stok_sebelum: 10, stok_sesudah: 4 })

    const notifs = await db
      .select()
      .from(notification_logs)
      .where(eq(notification_logs.barang_id, item.id_barang))
    const pushRows = notifs.filter((row) => row.kanal === 'push')
    const recipients = pushRows.map((row) => row.user_id)
    expect(recipients).toContain(adminUser!.id_user)
    expect(recipients).toContain(kepalaUser!.id_user)
    expect(pushRows.every((row) => row.status_kirim === 'terkirim' && !row.sudah_dibaca)).toBe(true)

    const byCodeRes = await request('GET', `/items/by-code/${kode}`, { token: staf })
    expect(byCodeRes.status).toBe(200)
    const byCode = (await byCodeRes.json()) as Record<string, any>
    expect(byCode.stok_saat_ini).toBe(4)

    const listRes = await request('GET', `/transactions?jenis=keluar&limit=100`, { token: staf })
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as Record<string, any>
    expect(list.data.some((row: any) => row.id_transaksi === keluar.id_transaksi)).toBe(true)

    const logs = await db
      .select()
      .from(activity_logs)
      .where(eq(activity_logs.aksi, 'transaction.keluar'))
    expect(logs.some((row) => row.entitas_id === keluar.id_transaksi)).toBe(true)
  })
})

afterAll(async () => {
  if (createdItemIds.length > 0) {
    await db.delete(notification_logs).where(inArray(notification_logs.barang_id, createdItemIds))
    await db.delete(stock_movements).where(inArray(stock_movements.barang_id, createdItemIds))
    await db
      .delete(transaction_details)
      .where(inArray(transaction_details.barang_id, createdItemIds))
    await db
      .delete(activity_logs)
      .where(
        and(
          eq(activity_logs.entitas_terkait, 'items'),
          inArray(activity_logs.entitas_id, createdItemIds),
        ),
      )
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
