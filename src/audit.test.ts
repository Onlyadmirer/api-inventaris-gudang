import { afterAll, describe, expect, it } from 'bun:test'
import { asc, eq, inArray } from 'drizzle-orm'
import { app } from './index'
import { db } from './db'
import { activity_logs, items, notification_logs, users } from './db/schema'

const BASE = 'http://localhost/api'
const PASSWORD = 'password123'
const suffix = Date.now().toString(36)

const createdLogIds: number[] = []
const createdNotifIds: number[] = []

const [adminUser] = await db
  .select()
  .from(users)
  .where(eq(users.email, 'admin@inventaris.test'))
  .limit(1)
const [seedItem] = await db.select().from(items).orderBy(asc(items.id_barang)).limit(1)

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

const AKSI = `test.audit.${suffix}`

async function seedLogs() {
  const rows = await db
    .insert(activity_logs)
    .values([
      { user_id: adminUser!.id_user, aksi: AKSI, entitas_terkait: 'items', entitas_id: seedItem!.id_barang },
      { user_id: adminUser!.id_user, aksi: 'login', entitas_terkait: 'users' },
    ])
    .returning()
  for (const row of rows) createdLogIds.push(row.id_log)
}

async function seedNotifs() {
  const rows = await db
    .insert(notification_logs)
    .values([
      {
        user_id: adminUser!.id_user,
        barang_id: seedItem!.id_barang,
        kanal: 'push',
        pesan: `stok kritis ${suffix}`,
        status_kirim: 'terkirim',
        sudah_dibaca: false,
      },
      {
        user_id: adminUser!.id_user,
        barang_id: seedItem!.id_barang,
        kanal: 'email',
        pesan: `stok kritis ${suffix}`,
        status_kirim: 'gagal',
        sudah_dibaca: true,
      },
    ])
    .returning()
  for (const row of rows) createdNotifIds.push(row.id_notif)
}

describe('B6 audit - akses', () => {
  it('tanpa token -> 401', async () => {
    expect((await request('GET', '/audit-logs')).status).toBe(401)
  })

  it('KEPALA_GUDANG -> 403 (hanya Admin)', async () => {
    const token = await tokenFor('kepala@inventaris.test')
    expect((await request('GET', '/audit-logs', { token })).status).toBe(403)
  })

  it('STAF -> 403', async () => {
    const token = await tokenFor('staf@inventaris.test')
    expect((await request('GET', '/notification-logs', { token })).status).toBe(403)
  })
})

describe('B6 audit - activity logs', () => {
  it('list + filter aksi + paginasi', async () => {
    await seedLogs()
    const token = await tokenFor('admin@inventaris.test')

    const res = await request('GET', `/audit-logs?aksi=audit.${suffix}&page=1&limit=5`, { token })
    expect(res.status).toBe(200)

    const json = (await res.json()) as Record<string, any>
    expect(json.meta).toMatchObject({ page: 1, limit: 5 })
    expect(json.data.length).toBe(1)
    expect(json.data[0].aksi).toBe(AKSI)
    expect(json.data[0].nama_user).toBe(adminUser!.nama_lengkap)
  })

  it('filter rentang mengecualikan data lama', async () => {
    const token = await tokenFor('admin@inventaris.test')
    const res = await request('GET', `/audit-logs?aksi=audit.${suffix}&sampai=2000-01-01`, { token })
    const json = (await res.json()) as Record<string, any>
    expect(json.data.length).toBe(0)
  })

  it('tanggal tidak valid -> 400', async () => {
    const token = await tokenFor('admin@inventaris.test')
    expect((await request('GET', '/audit-logs?dari=xx', { token })).status).toBe(400)
  })
})

describe('B6 audit - notification logs', () => {
  it('list + filter kanal & status', async () => {
    await seedNotifs()
    const token = await tokenFor('admin@inventaris.test')

    const res = await request(
      'GET',
      `/notification-logs?barang_id=${seedItem!.id_barang}&kanal=push&status_kirim=terkirim`,
      { token },
    )
    expect(res.status).toBe(200)

    const json = (await res.json()) as Record<string, any>
    expect(json.data.length).toBeGreaterThan(0)
    for (const row of json.data) {
      expect(row.kanal).toBe('push')
      expect(row.status_kirim).toBe('terkirim')
      expect(row.kode_barang).toBe(seedItem!.kode_barang)
    }
  })

  it('filter sudah_dibaca=false', async () => {
    const token = await tokenFor('admin@inventaris.test')
    const res = await request(
      'GET',
      `/notification-logs?barang_id=${seedItem!.id_barang}&sudah_dibaca=false`,
      { token },
    )
    const json = (await res.json()) as Record<string, any>
    expect(json.data.length).toBeGreaterThan(0)
    for (const row of json.data) expect(row.sudah_dibaca).toBe(false)
  })
})

afterAll(async () => {
  if (createdLogIds.length > 0) {
    await db.delete(activity_logs).where(inArray(activity_logs.id_log, createdLogIds))
  }
  if (createdNotifIds.length > 0) {
    await db.delete(notification_logs).where(inArray(notification_logs.id_notif, createdNotifIds))
  }
})
