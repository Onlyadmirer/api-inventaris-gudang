import { afterAll, describe, expect, it, mock } from 'bun:test'
import { and, eq, inArray, isNull, like } from 'drizzle-orm'
import { db } from './db'
import { activity_logs, notification_logs, report_schedules, users } from './db/schema'

const sentEmails: Array<{
  to: string
  subject: string
  text: string
  attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>
}> = []
let mailFails = false

mock.module('./lib/mailer', () => ({
  sendEmail: async (message: {
    to: string
    subject: string
    text: string
    attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>
  }) => {
    if (mailFails) throw new Error('SMTP gagal')
    sentEmails.push(message)
  },
}))

const { app } = await import('./index')
const { runScheduleNow, stopAll, hasActiveJob, buildCronPattern } = await import(
  './modules/schedules/scheduler'
)

const BASE = 'http://localhost/api'
const PASSWORD = 'password123'
const suffix = Date.now().toString(36)

const createdScheduleIds: number[] = []
const createdEmails: string[] = []

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

async function createSchedule(
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<{ status: number; json: any }> {
  const email = `jadwal.${suffix}.${createdScheduleIds.length}@inventaris.test`
  const res = await request('POST', '/schedules', {
    token,
    body: {
      jenis_laporan: 'stok',
      frekuensi: 'harian',
      waktu_eksekusi: '08:30',
      email_penerima: email,
      ...overrides,
    },
  })
  const json = (await res.json()) as any
  if (typeof json.id_jadwal === 'number') {
    createdScheduleIds.push(json.id_jadwal)
    createdEmails.push(email)
  }
  return { status: res.status, json }
}

describe('B8 cron pattern', () => {
  it('memetakan frekuensi ke pola cron', () => {
    expect(buildCronPattern('harian', '08:30')).toBe('30 8 * * *')
    expect(buildCronPattern('mingguan', '07:05')).toBe('5 7 * * 1')
    expect(buildCronPattern('bulanan', '00:00')).toBe('0 0 1 * *')
  })
})

describe('B8 akses & validasi', () => {
  it('tanpa token -> 401', async () => {
    expect((await request('GET', '/schedules')).status).toBe(401)
  })

  it('ADMIN & STAF dilarang -> 403', async () => {
    const admin = await tokenFor('admin@inventaris.test')
    const staf = await tokenFor('staf@inventaris.test')
    expect((await request('GET', '/schedules', { token: admin })).status).toBe(403)
    const validBody = {
      jenis_laporan: 'stok',
      frekuensi: 'harian',
      waktu_eksekusi: '08:30',
      email_penerima: `staf.${suffix}@inventaris.test`,
    }
    expect((await request('POST', '/schedules', { token: staf, body: validBody })).status).toBe(403)
    expect((await request('POST', '/schedules', { token: admin, body: validBody })).status).toBe(403)
  })

  it('validasi waktu & email -> 400', async () => {
    const kepala = await tokenFor('kepala@inventaris.test')
    expect((await createSchedule(kepala, { waktu_eksekusi: '25:00' })).status).toBe(400)
    expect((await createSchedule(kepala, { waktu_eksekusi: '8:30' })).status).toBe(400)
    expect((await createSchedule(kepala, { email_penerima: 'bukan-email' })).status).toBe(400)
    expect((await createSchedule(kepala, { frekuensi: 'tahunan' })).status).toBe(400)
  })
})

describe('B8 CRUD jadwal', () => {
  it('create -> 201, tersimpan, job terdaftar, ada next_run', async () => {
    const kepala = await tokenFor('kepala@inventaris.test')
    const { status, json } = await createSchedule(kepala)

    expect(status).toBe(201)
    expect(json.id_jadwal).toBeGreaterThan(0)
    expect(json.user_id).toBe(kepalaUser!.id_user)
    expect(json.status_aktif).toBe(true)
    expect(json.next_run).not.toBeNull()
    expect(hasActiveJob(json.id_jadwal)).toBe(true)
  })

  it('create nonaktif -> tidak ada job', async () => {
    const kepala = await tokenFor('kepala@inventaris.test')
    const { json } = await createSchedule(kepala, { status_aktif: false })
    expect(json.status_aktif).toBe(false)
    expect(json.next_run).toBeNull()
    expect(hasActiveJob(json.id_jadwal)).toBe(false)
  })

  it('list memuat jadwal yang dibuat', async () => {
    const kepala = await tokenFor('kepala@inventaris.test')
    const res = await request('GET', '/schedules?limit=100', { token: kepala })
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json.meta.total).toBeGreaterThanOrEqual(1)
    expect(json.data.some((row: any) => createdScheduleIds.includes(row.id_jadwal))).toBe(true)
  })

  it('update kosong -> 400, update menghidup/matikan job', async () => {
    const kepala = await tokenFor('kepala@inventaris.test')
    const { json } = await createSchedule(kepala)
    const id = json.id_jadwal

    const empty = await request('PATCH', `/schedules/${id}`, { token: kepala, body: {} })
    expect(empty.status).toBe(400)

    const off = await request('PATCH', `/schedules/${id}`, {
      token: kepala,
      body: { status_aktif: false },
    })
    expect(off.status).toBe(200)
    expect(hasActiveJob(id)).toBe(false)

    const on = await request('PATCH', `/schedules/${id}`, {
      token: kepala,
      body: { status_aktif: true, waktu_eksekusi: '09:15' },
    })
    expect(on.status).toBe(200)
    expect(((await on.json()) as any).waktu_eksekusi).toBe('09:15')
    expect(hasActiveJob(id)).toBe(true)
  })

  it('update id tidak ada -> 404', async () => {
    const kepala = await tokenFor('kepala@inventaris.test')
    const res = await request('PATCH', '/schedules/99999999', {
      token: kepala,
      body: { status_aktif: false },
    })
    expect(res.status).toBe(404)
  })

  it('delete menghapus baris & menghentikan job', async () => {
    const kepala = await tokenFor('kepala@inventaris.test')
    const { json } = await createSchedule(kepala)
    const id = json.id_jadwal
    expect(hasActiveJob(id)).toBe(true)

    const res = await request('DELETE', `/schedules/${id}`, { token: kepala })
    expect(res.status).toBe(200)
    expect(hasActiveJob(id)).toBe(false)

    const rows = await db
      .select()
      .from(report_schedules)
      .where(eq(report_schedules.id_jadwal, id))
    expect(rows.length).toBe(0)

    const again = await request('DELETE', `/schedules/${id}`, { token: kepala })
    expect(again.status).toBe(404)
  })
})

describe('B8 runScheduleNow', () => {
  it('sukses -> kirim email berlampiran + catat notification_logs & activity_logs', async () => {
    const kepala = await tokenFor('kepala@inventaris.test')
    const { json } = await createSchedule(kepala, { jenis_laporan: 'stok', frekuensi: 'harian' })
    const id = json.id_jadwal
    const email = createdEmails[createdEmails.length - 1]!

    const result = await runScheduleNow(id)
    expect(result.status).toBe('terkirim')
    expect(result.periode.dari).toBe(result.periode.sampai)

    const sent = sentEmails.find((m) => m.to === email)
    expect(sent).toBeDefined()
    expect(sent!.attachments?.length).toBe(1)
    expect(sent!.attachments![0]!.filename.endsWith('.xlsx')).toBe(true)

    const notif = await db
      .select()
      .from(notification_logs)
      .where(
        and(
          eq(notification_logs.user_id, kepalaUser!.id_user),
          isNull(notification_logs.barang_id),
          like(notification_logs.pesan, 'Laporan stok%'),
        ),
      )
    expect(notif.length).toBeGreaterThanOrEqual(1)
    expect(notif.some((row) => row.status_kirim === 'terkirim' && row.kanal === 'email')).toBe(true)

    const logs = await db
      .select()
      .from(activity_logs)
      .where(
        and(
          eq(activity_logs.aksi, 'schedule.run'),
          eq(activity_logs.entitas_terkait, 'report_schedules'),
          eq(activity_logs.entitas_id, id),
        ),
      )
    expect(logs.length).toBe(1)
  })

  it('email gagal -> status gagal + notification_logs gagal, tidak melempar', async () => {
    const kepala = await tokenFor('kepala@inventaris.test')
    const { json } = await createSchedule(kepala, { jenis_laporan: 'transaksi' })
    const id = json.id_jadwal

    mailFails = true
    const result = await runScheduleNow(id)
    mailFails = false

    expect(result.status).toBe('gagal')
    expect(result.error).toContain('SMTP')

    const notif = await db
      .select()
      .from(notification_logs)
      .where(
        and(
          eq(notification_logs.user_id, kepalaUser!.id_user),
          isNull(notification_logs.barang_id),
          like(notification_logs.pesan, 'Laporan transaksi%'),
        ),
      )
    expect(notif.some((row) => row.status_kirim === 'gagal')).toBe(true)
  })

  it('id tidak ada -> melempar error', async () => {
    await expect(runScheduleNow(99999999)).rejects.toThrow('Jadwal tidak ditemukan')
  })
})

afterAll(async () => {
  stopAll()
  if (createdScheduleIds.length > 0) {
    await db
      .delete(activity_logs)
      .where(
        and(
          eq(activity_logs.entitas_terkait, 'report_schedules'),
          inArray(activity_logs.entitas_id, createdScheduleIds),
        ),
      )
    await db
      .delete(report_schedules)
      .where(inArray(report_schedules.id_jadwal, createdScheduleIds))
  }
  if (kepalaUser) {
    await db
      .delete(notification_logs)
      .where(
        and(
          eq(notification_logs.user_id, kepalaUser.id_user),
          isNull(notification_logs.barang_id),
          like(notification_logs.pesan, 'Laporan %'),
        ),
      )
  }
})
