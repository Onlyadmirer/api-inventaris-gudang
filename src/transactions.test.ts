import { afterAll, describe, expect, it } from 'bun:test'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
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

async function stockOf(id: number): Promise<number> {
  const [row] = await db
    .select({ stok: items.stok_saat_ini })
    .from(items)
    .where(eq(items.id_barang, id))
    .limit(1)
  return row!.stok
}

function track(json: Record<string, any>): void {
  if (typeof json.id_transaksi === 'number') createdTrxIds.push(json.id_transaksi)
}

describe('B4 transaksi - akses & validasi', () => {
  it('tanpa token -> 401', async () => {
    const res = await request('POST', '/transactions/masuk', {
      body: { items: [{ barang_id: 1, jumlah: 1 }] },
    })
    expect(res.status).toBe(401)
  })

  it('ADMIN dilarang -> 403 (hanya Staf)', async () => {
    const token = await tokenFor('admin@inventaris.test')
    const res = await request('POST', '/transactions/masuk', {
      token,
      body: { items: [{ barang_id: 1, jumlah: 1 }] },
    })
    expect(res.status).toBe(403)
  })

  it('KEPALA_GUDANG dilarang -> 403', async () => {
    const token = await tokenFor('kepala@inventaris.test')
    const res = await request('POST', '/transactions/keluar', {
      token,
      body: { items: [{ barang_id: 1, jumlah: 1 }] },
    })
    expect(res.status).toBe(403)
  })

  it('items kosong -> 400', async () => {
    const token = await tokenFor('staf@inventaris.test')
    const res = await request('POST', '/transactions/masuk', { token, body: { items: [] } })
    expect(res.status).toBe(400)
  })

  it('jumlah 0 / negatif -> 400', async () => {
    const token = await tokenFor('staf@inventaris.test')
    const id = await createItem(`TRX-ZERO-${suffix}`, 5)
    const res = await request('POST', '/transactions/masuk', {
      token,
      body: { items: [{ barang_id: id, jumlah: 0 }] },
    })
    expect(res.status).toBe(400)
  })

  it('barang tidak ditemukan -> 404', async () => {
    const token = await tokenFor('staf@inventaris.test')
    const res = await request('POST', '/transactions/masuk', {
      token,
      body: { items: [{ kode_barang: `TIDAKADA-${suffix}`, jumlah: 1 }] },
    })
    expect(res.status).toBe(404)
    expect((await res.json()) as Record<string, any>).toEqual({ message: 'Barang tidak ditemukan' })
  })
})

describe('B4 transaksi - UC-10 barang masuk', () => {
  it('masuk menambah stok + catat transaksi/detail/movement', async () => {
    const token = await tokenFor('staf@inventaris.test')
    const id = await createItem(`TRX-MASUK-${suffix}`, 10)

    const res = await request('POST', '/transactions/masuk', {
      token,
      body: { items: [{ barang_id: id, jumlah: 5 }], keterangan: 'Terima kiriman' },
    })
    expect(res.status).toBe(201)

    const json = (await res.json()) as Record<string, any>
    track(json)
    expect(json.jenis_transaksi).toBe('masuk')
    expect(json.keterangan).toBe('Terima kiriman')
    expect(json.items[0]).toMatchObject({ barang_id: id, jumlah: 5, stok_sebelum: 10, stok_sesudah: 15 })

    expect(await stockOf(id)).toBe(15)

    const details = await db
      .select()
      .from(transaction_details)
      .where(eq(transaction_details.transaksi_id, json.id_transaksi))
    expect(details.length).toBe(1)
    expect(details[0]!.jumlah).toBe(5)

    const movements = await db
      .select()
      .from(stock_movements)
      .where(eq(stock_movements.transaksi_id, json.id_transaksi))
    expect(movements.length).toBe(1)
    expect(movements[0]).toMatchObject({
      jenis_pergerakan: 'masuk',
      jumlah: 5,
      stok_sebelum: 10,
      stok_sesudah: 15,
    })

    const logs = await db
      .select()
      .from(activity_logs)
      .where(
        and(
          eq(activity_logs.aksi, 'transaction.masuk'),
          eq(activity_logs.entitas_id, json.id_transaksi),
        ),
      )
    expect(logs.length).toBe(1)
  })

  it('masuk via kode_barang & sumber tersimpan di keterangan', async () => {
    const token = await tokenFor('staf@inventaris.test')
    const kode = `TRX-KODE-${suffix}`
    await createItem(kode, 0)

    const res = await request('POST', '/transactions/masuk', {
      token,
      body: { items: [{ kode_barang: kode, jumlah: 3 }], sumber: 'manual', keterangan: 'Input manual' },
    })
    expect(res.status).toBe(201)

    const json = (await res.json()) as Record<string, any>
    track(json)
    expect(json.keterangan).toBe('[manual] Input manual')
    expect(json.items[0].kode_barang).toBe(kode)
    expect(json.items[0].stok_sesudah).toBe(3)
  })

  it('item duplikat di payload diagregasi jadi satu movement', async () => {
    const token = await tokenFor('staf@inventaris.test')
    const id = await createItem(`TRX-AGG-${suffix}`, 0)

    const res = await request('POST', '/transactions/masuk', {
      token,
      body: { items: [{ barang_id: id, jumlah: 2 }, { barang_id: id, jumlah: 3 }] },
    })
    expect(res.status).toBe(201)

    const json = (await res.json()) as Record<string, any>
    track(json)
    expect(json.items.length).toBe(1)
    expect(json.items[0]).toMatchObject({ jumlah: 5, stok_sebelum: 0, stok_sesudah: 5 })
    expect(await stockOf(id)).toBe(5)

    const movements = await db
      .select()
      .from(stock_movements)
      .where(eq(stock_movements.transaksi_id, json.id_transaksi))
    expect(movements.length).toBe(1)
  })
})

describe('B4 transaksi - UC-11 barang keluar', () => {
  it('keluar mengurangi stok', async () => {
    const token = await tokenFor('staf@inventaris.test')
    const id = await createItem(`TRX-KELUAR-${suffix}`, 20)

    const res = await request('POST', '/transactions/keluar', {
      token,
      body: { items: [{ barang_id: id, jumlah: 7 }] },
    })
    expect(res.status).toBe(201)

    const json = (await res.json()) as Record<string, any>
    track(json)
    expect(json.jenis_transaksi).toBe('keluar')
    expect(json.items[0]).toMatchObject({ stok_sebelum: 20, stok_sesudah: 13 })
    expect(await stockOf(id)).toBe(13)

    const movements = await db
      .select()
      .from(stock_movements)
      .where(eq(stock_movements.transaksi_id, json.id_transaksi))
    expect(movements[0]).toMatchObject({ jenis_pergerakan: 'keluar', stok_sebelum: 20, stok_sesudah: 13 })
  })

  it('keluar persis sampai 0 berhasil', async () => {
    const token = await tokenFor('staf@inventaris.test')
    const id = await createItem(`TRX-HABIS-${suffix}`, 4)

    const res = await request('POST', '/transactions/keluar', {
      token,
      body: { items: [{ barang_id: id, jumlah: 4 }] },
    })
    expect(res.status).toBe(201)

    const json = (await res.json()) as Record<string, any>
    track(json)
    expect(json.items[0]).toMatchObject({ stok_sebelum: 4, stok_sesudah: 0 })
    expect(await stockOf(id)).toBe(0)
  })

  it('stok tidak cukup -> 400 + rollback total (tidak ada perubahan)', async () => {
    const token = await tokenFor('staf@inventaris.test')
    const cukup = await createItem(`TRX-ROLL-A-${suffix}`, 10)
    const kurang = await createItem(`TRX-ROLL-B-${suffix}`, 1)

    const res = await request('POST', '/transactions/keluar', {
      token,
      body: { items: [{ barang_id: cukup, jumlah: 5 }, { barang_id: kurang, jumlah: 5 }] },
    })
    expect(res.status).toBe(400)

    const json = (await res.json()) as Record<string, any>
    expect(json.message).toContain('Stok tidak mencukupi')
    expect(json.message).toContain(`Barang TRX-ROLL-B-${suffix}`)

    expect(await stockOf(cukup)).toBe(10)
    expect(await stockOf(kurang)).toBe(1)

    const movements = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(stock_movements)
      .where(inArray(stock_movements.barang_id, [cukup, kurang]))
    expect(movements[0]!.total).toBe(0)

    const details = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(transaction_details)
      .where(inArray(transaction_details.barang_id, [cukup, kurang]))
    expect(details[0]!.total).toBe(0)
  })

  it('dua keluar bersamaan stok penuh -> tepat satu sukses, stok akhir 0', async () => {
    const token = await tokenFor('staf@inventaris.test')
    const id = await createItem(`TRX-RACE-${suffix}`, 10)

    const body = { items: [{ barang_id: id, jumlah: 10 }] }
    const [resA, resB] = await Promise.all([
      request('POST', '/transactions/keluar', { token, body }),
      request('POST', '/transactions/keluar', { token, body }),
    ])

    const statuses = [resA.status, resB.status].sort((a, b) => a - b)
    expect(statuses).toEqual([201, 400])

    expect(await stockOf(id)).toBe(0)

    const winner = resA.status === 201 ? resA : resB
    track((await winner.json()) as Record<string, any>)

    const movements = await db
      .select()
      .from(stock_movements)
      .where(eq(stock_movements.barang_id, id))
    expect(movements.length).toBe(1)
    expect(movements[0]!.stok_sesudah).toBe(0)
  })
})

describe('B9 GET /transactions', () => {
  it('tanpa token -> 401', async () => {
    expect((await request('GET', '/transactions')).status).toBe(401)
  })

  it('STAF hanya melihat transaksi miliknya, ADMIN melihat semua', async () => {
    const staf = await tokenFor('staf@inventaris.test')
    const admin = await tokenFor('admin@inventaris.test')
    const id = await createItem(`TRX-LIST-${suffix}`, 50)

    const masukRes = await request('POST', '/transactions/masuk', {
      token: staf,
      body: { items: [{ barang_id: id, jumlah: 5 }] },
    })
    const masuk = (await masukRes.json()) as Record<string, any>
    track(masuk)

    const stafList = (await (
      await request('GET', '/transactions?limit=100', { token: staf })
    ).json()) as Record<string, any>
    expect(stafList.data.every((row: any) => row.user_id === masuk.user_id)).toBe(true)
    expect(stafList.data.some((row: any) => row.id_transaksi === masuk.id_transaksi)).toBe(true)

    const adminList = (await (
      await request('GET', '/transactions?limit=100', { token: admin })
    ).json()) as Record<string, any>
    expect(adminList.data.some((row: any) => row.id_transaksi === masuk.id_transaksi)).toBe(true)
  })

  it('memuat detail items, filter jenis, dan meta paginasi', async () => {
    const staf = await tokenFor('staf@inventaris.test')
    const id = await createItem(`TRX-LIST2-${suffix}`, 30)

    const res = await request('POST', '/transactions/masuk', {
      token: staf,
      body: { items: [{ barang_id: id, jumlah: 3 }], keterangan: 'cek list' },
    })
    const json = (await res.json()) as Record<string, any>
    track(json)

    const filtered = (await (
      await request('GET', `/transactions?jenis=masuk&limit=100`, { token: staf })
    ).json()) as Record<string, any>
    const entry = filtered.data.find((row: any) => row.id_transaksi === json.id_transaksi)
    expect(entry).toBeDefined()
    expect(entry.items[0]).toMatchObject({
      barang_id: id,
      kode_barang: `TRX-LIST2-${suffix}`,
      jumlah: 3,
    })

    const keluarOnly = (await (
      await request('GET', `/transactions?jenis=keluar&limit=100`, { token: staf })
    ).json()) as Record<string, any>
    expect(keluarOnly.data.some((row: any) => row.id_transaksi === json.id_transaksi)).toBe(false)

    expect(filtered.meta).toMatchObject({ page: 1, limit: 100 })
    expect(typeof filtered.meta.total).toBe('number')

    const badDate = await request('GET', '/transactions?dari=bukan-tanggal', { token: staf })
    expect(badDate.status).toBe(400)
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
