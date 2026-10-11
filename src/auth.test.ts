import { afterAll, describe, expect, it } from 'bun:test'
import { and, eq, inArray } from 'drizzle-orm'
import { app } from './index'
import { db } from './db'
import { activity_logs, roles, users } from './db/schema'

const BASE = 'http://localhost/api'
const ADMIN_EMAIL = 'admin@inventaris.test'
const PASSWORD = 'password123'

const createdUserIds: number[] = []

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

async function login(email: string, password: string) {
  const res = await request('POST', '/auth/login', { body: { email, password } })
  return res
}

describe('UC-01 Login', () => {
  it('login sukses mengembalikan token + user tanpa password_hash', async () => {
    const res = await login(ADMIN_EMAIL, PASSWORD)
    expect(res.status).toBe(200)

    const json = (await res.json()) as Record<string, any>
    expect(typeof json.token).toBe('string')
    expect(json.user.email).toBe(ADMIN_EMAIL)
    expect(json.user.role).toBe('ADMIN')
    expect(json.user.password_hash).toBeUndefined()
  })

  it('password salah -> 401 dengan pesan yang sama', async () => {
    const res = await login(ADMIN_EMAIL, 'password-salah')
    expect(res.status).toBe(401)
    expect((await res.json()) as Record<string, any>).toEqual({
      message: 'Email atau password salah',
    })
  })

  it('email tidak terdaftar -> 401 dengan pesan yang sama', async () => {
    const res = await login('tidak-ada@inventaris.test', PASSWORD)
    expect(res.status).toBe(401)
    expect((await res.json()) as Record<string, any>).toEqual({
      message: 'Email atau password salah',
    })
  })

  it('user nonaktif tidak bisa login -> 401', async () => {
    const [stafRole] = await db
      .select()
      .from(roles)
      .where(eq(roles.nama_role, 'STAF_GUDANG'))
    const [inactive] = await db
      .insert(users)
      .values({
        role_id: stafRole.id_role,
        nama_lengkap: 'User Nonaktif',
        email: 'nonaktif@inventaris.test',
        password_hash: await Bun.password.hash(PASSWORD),
        status_aktif: false,
      })
      .returning()
    createdUserIds.push(inactive.id_user)

    const res = await login('nonaktif@inventaris.test', PASSWORD)
    expect(res.status).toBe(401)
    expect((await res.json()) as Record<string, any>).toEqual({
      message: 'Email atau password salah',
    })
  })

  it('mencatat aktivitas login ke activity_logs', async () => {
    const res = await login(ADMIN_EMAIL, PASSWORD)
    expect(res.status).toBe(200)

    const logs = await db
      .select()
      .from(activity_logs)
      .where(and(eq(activity_logs.aksi, 'login'), eq(activity_logs.user_id, 1)))
    expect(logs.length).toBeGreaterThan(0)
  })
})

describe('UC-01 GET /auth/me', () => {
  it('tanpa token -> 401 Unauthorized', async () => {
    const res = await request('GET', '/auth/me')
    expect(res.status).toBe(401)
    expect((await res.json()) as Record<string, any>).toEqual({ message: 'Unauthorized' })
  })

  it('dengan token -> mengembalikan data user yang login', async () => {
    const loginRes = await login(ADMIN_EMAIL, PASSWORD)
    const { token } = (await loginRes.json()) as { token: string }

    const res = await request('GET', '/auth/me', { token })
    expect(res.status).toBe(200)

    const json = (await res.json()) as Record<string, any>
    expect(json.email).toBe(ADMIN_EMAIL)
    expect(json.role).toBe('ADMIN')
    expect(json.password_hash).toBeUndefined()
  })

  it('token tidak valid -> 401', async () => {
    const res = await request('GET', '/auth/me', { token: 'token-palsu' })
    expect(res.status).toBe(401)
  })
})

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(activity_logs).where(inArray(activity_logs.user_id, createdUserIds))
    await db.delete(users).where(inArray(users.id_user, createdUserIds))
  }
})
