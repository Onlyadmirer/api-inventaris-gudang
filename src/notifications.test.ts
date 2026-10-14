import { afterAll, describe, expect, it, mock } from 'bun:test'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from './db'
import {
  activity_logs,
  categories,
  items,
  notification_logs,
  stock_movements,
  transaction_details,
  transactions,
  user_preferences,
  users,
} from './db/schema'

const sentEmails: Array<{ to: string; subject: string; text: string }> = []
let mailFails = false

mock.module('./lib/mailer', () => ({
  sendEmail: async (message: { to: string; subject: string; text: string }) => {
    if (mailFails) throw new Error('SMTP gagal')
    sentEmails.push(message)
  },
}))

const { app } = await import('./index')

const BASE = 'http://localhost/api'
const PASSWORD = 'password123'
const suffix = Date.now().toString(36)
const emailTujuan = `kepala.notif.${suffix}@inventaris.test`

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

async function setPreference(
  token: string,
  kanal: 'email' | 'whatsapp',
  tujuan: string,
  status_aktif = true,
) {
  return request('PUT', '/preferences', {
    token,
    body: { preferences: [{ kanal_notifikasi: kanal, tujuan, status_aktif }] },
  })
}

async function triggerLowStock(token: string, kode: string, from: number, keluar: number, batas: number) {
  const itemId = await createItem(kode, from, batas)
  const res = await request('POST', '/transactions/keluar', {
    token,
    body: { items: [{ barang_id: itemId, jumlah: keluar }] },
  })
  const json = (await res.json()) as Record<string, any>
  if (typeof json.id_transaksi === 'number') createdTrxIds.push(json.id_transaksi)
  return { itemId, status: res.status }
}

describe('B7 preferensi (UC-16)', () => {
  it('ADMIN & STAF dilarang -> 403', async () => {
    const admin = await tokenFor('admin@inventaris.test')
    const staf = await tokenFor('staf@inventaris.test')
    expect((await request('GET', '/preferences', { token: admin })).status).toBe(403)
    expect((await request('GET', '/preferences', { token: staf })).status).toBe(403)
  })

  it('KEPALA melihat daftar preferensi', async () => {
    const token = await tokenFor('kepala@inventaris.test')
    const res = await request('GET', '/preferences', { token })
    expect(res.status).toBe(200)
    expect(Array.isArray(((await res.json()) as Record<string, any>).data)).toBe(true)
  })

  it('validasi email', async () => {
    const token = await tokenFor('kepala@inventaris.test')

    const invalid = await setPreference(token, 'email', 'bukan-email')
    expect(invalid.status).toBe(400)

    const missing = await request('PUT', '/preferences', {
      token,
      body: { preferences: [{ kanal_notifikasi: 'email', status_aktif: true }] },
    })
    expect(missing.status).toBe(400)

    const valid = await setPreference(token, 'email', emailTujuan)
    expect(valid.status).toBe(200)
  })

  it('validasi nomor WhatsApp', async () => {
    const token = await tokenFor('kepala@inventaris.test')
    expect((await setPreference(token, 'whatsapp', 'abc')).status).toBe(400)
    expect((await setPreference(token, 'whatsapp', '081234567890', false)).status).toBe(200)
  })

  it('upsert idempoten per (user, kanal)', async () => {
    const token = await tokenFor('kepala@inventaris.test')
    await setPreference(token, 'email', emailTujuan)

    const res = await request('GET', '/preferences', { token })
    const json = (await res.json()) as Record<string, any>
    const emails = json.data.filter((p: any) => p.kanal_notifikasi === 'email')
    expect(emails.length).toBe(1)
    expect(emails[0].tujuan).toBe(emailTujuan)
  })
})

describe('B7 inbox notifikasi (UC-17) - akses', () => {
  it('tanpa token -> 401', async () => {
    expect((await request('GET', '/notifications')).status).toBe(401)
  })

  it('STAF dilarang -> 403', async () => {
    const staf = await tokenFor('staf@inventaris.test')
    expect((await request('GET', '/notifications', { token: staf })).status).toBe(403)
  })
})

describe('B7 trigger afterStockChange', () => {
  it('stok <= batas -> in-app (admin & kepala) + email terkirim', async () => {
    const staf = await tokenFor('staf@inventaris.test')
    const kepala = await tokenFor('kepala@inventaris.test')
    await setPreference(kepala, 'email', emailTujuan)

    const { itemId, status } = await triggerLowStock(staf, `NOTIF-OK-${suffix}`, 10, 7, 5)
    expect(status).toBe(201)

    const rows = await db
      .select()
      .from(notification_logs)
      .where(eq(notification_logs.barang_id, itemId))

    const pushRows = rows.filter((r) => r.kanal === 'push')
    const recipients = pushRows.map((r) => r.user_id)
    expect(recipients).toContain(adminUser!.id_user)
    expect(recipients).toContain(kepalaUser!.id_user)
    for (const row of pushRows) {
      expect(row.status_kirim).toBe('terkirim')
      expect(row.sudah_dibaca).toBe(false)
    }

    const emailRow = rows.find((r) => r.kanal === 'email')
    expect(emailRow).toBeDefined()
    expect(emailRow!.user_id).toBe(kepalaUser!.id_user)
    expect(emailRow!.status_kirim).toBe('terkirim')
    expect(sentEmails.some((m) => m.to === emailTujuan)).toBe(true)
  })

  it('email gagal -> dicatat gagal, transaksi tetap 201', async () => {
    const staf = await tokenFor('staf@inventaris.test')
    mailFails = true
    const { itemId, status } = await triggerLowStock(staf, `NOTIF-FAIL-${suffix}`, 10, 7, 5)
    mailFails = false

    expect(status).toBe(201)

    const emailRow = (
      await db.select().from(notification_logs).where(eq(notification_logs.barang_id, itemId))
    ).find((r) => r.kanal === 'email')
    expect(emailRow).toBeDefined()
    expect(emailRow!.status_kirim).toBe('gagal')
  })

  it('whatsapp stub -> dicatat pending', async () => {
    const staf = await tokenFor('staf@inventaris.test')
    const kepala = await tokenFor('kepala@inventaris.test')
    await setPreference(kepala, 'whatsapp', '081234567890')

    const { itemId } = await triggerLowStock(staf, `NOTIF-WA-${suffix}`, 10, 7, 5)

    const waRow = (
      await db.select().from(notification_logs).where(eq(notification_logs.barang_id, itemId))
    ).find((r) => r.kanal === 'whatsapp')
    expect(waRow).toBeDefined()
    expect(waRow!.status_kirim).toBe('pending')
  })

  it('stok masih aman -> tidak ada notifikasi', async () => {
    const staf = await tokenFor('staf@inventaris.test')
    const itemId = await createItem(`NOTIF-SAFE-${suffix}`, 100, 5)
    const res = await request('POST', '/transactions/keluar', {
      token: staf,
      body: { items: [{ barang_id: itemId, jumlah: 1 }] },
    })
    expect(res.status).toBe(201)
    createdTrxIds.push(((await res.json()) as Record<string, any>).id_transaksi)

    const rows = await db
      .select()
      .from(notification_logs)
      .where(eq(notification_logs.barang_id, itemId))
    expect(rows.length).toBe(0)
  })
})

describe('B7 inbox - baca & read-all', () => {
  it('daftar unread, mark read, read-all', async () => {
    const admin = await tokenFor('admin@inventaris.test')

    const listRes = await request('GET', '/notifications?unread=true', { token: admin })
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as Record<string, any>
    expect(Array.isArray(list.data)).toBe(true)
    for (const row of list.data) expect(row.sudah_dibaca).toBe(false)

    const target = list.data.find((row: any) => createdItemIds.includes(row.barang_id))
    expect(target).toBeDefined()

    const readRes = await request('PATCH', `/notifications/${target.id_notif}/read`, { token: admin })
    expect(readRes.status).toBe(200)
    expect(((await readRes.json()) as Record<string, any>).sudah_dibaca).toBe(true)

    const after = (await (await request('GET', '/notifications?unread=true', {
      token: admin,
    })).json()) as Record<string, any>
    expect(after.data.some((row: any) => row.id_notif === target.id_notif)).toBe(false)

    const allRes = await request('PATCH', '/notifications/read-all', { token: admin })
    expect(allRes.status).toBe(200)
    expect(typeof ((await allRes.json()) as Record<string, any>).updated).toBe('number')
  })

  it('menandai notifikasi milik user lain -> 404', async () => {
    const kepala = await tokenFor('kepala@inventaris.test')
    const [adminNotif] = await db
      .select()
      .from(notification_logs)
      .where(eq(notification_logs.user_id, adminUser!.id_user))
      .limit(1)

    const res = await request('PATCH', `/notifications/${adminNotif!.id_notif}/read`, {
      token: kepala,
    })
    expect(res.status).toBe(404)
  })
})

afterAll(async () => {
  await db.delete(user_preferences).where(eq(user_preferences.user_id, kepalaUser!.id_user))
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
