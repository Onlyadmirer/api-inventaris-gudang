import { afterAll, describe, expect, it } from 'bun:test'
import { inArray } from 'drizzle-orm'
import { app } from './index'
import { db } from './db'
import { activity_logs, users } from './db/schema'

const BASE = 'http://localhost/api'
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

async function tokenFor(email: string, password = PASSWORD): Promise<string> {
  const res = await request('POST', '/auth/login', { body: { email, password } })
  const json = (await res.json()) as { token: string }
  return json.token
}

describe('UC-02 Akses endpoint /users', () => {
  it('tanpa token -> 401 Unauthorized', async () => {
    const res = await request('GET', '/users')
    expect(res.status).toBe(401)
    expect((await res.json()) as Record<string, any>).toEqual({ message: 'Unauthorized' })
  })

  it('role STAF_GUDANG -> 403 Forbidden', async () => {
    const token = await tokenFor('staf@inventaris.test')
    const res = await request('GET', '/users', { token })
    expect(res.status).toBe(403)
    expect((await res.json()) as Record<string, any>).toEqual({ message: 'Forbidden' })
  })

  it('ADMIN -> daftar user terpaginasi tanpa password_hash', async () => {
    const token = await tokenFor('admin@inventaris.test')
    const res = await request('GET', '/users?page=1&limit=5', { token })
    expect(res.status).toBe(200)

    const json = (await res.json()) as Record<string, any>
    expect(Array.isArray(json.data)).toBe(true)
    expect(json.meta).toMatchObject({ page: 1, limit: 5 })
    expect(typeof json.meta.total).toBe('number')
    for (const user of json.data) {
      expect(user.password_hash).toBeUndefined()
    }
  })
})

describe('UC-02 Tambah akun', () => {
  it('ADMIN bisa menambah akun baru (201, tanpa password_hash)', async () => {
    const token = await tokenFor('admin@inventaris.test')
    const res = await request('POST', '/users', {
      token,
      body: {
        nama_lengkap: 'Staf Baru',
        email: 'staf.baru@inventaris.test',
        password: PASSWORD,
        no_hp: '08123456789',
        role: 'STAF_GUDANG',
      },
    })
    expect(res.status).toBe(201)

    const json = (await res.json()) as Record<string, any>
    createdUserIds.push(json.id_user)
    expect(json.email).toBe('staf.baru@inventaris.test')
    expect(json.role).toBe('STAF_GUDANG')
    expect(json.password_hash).toBeUndefined()
  })

  it('email duplikat -> 409 "Email sudah digunakan"', async () => {
    const token = await tokenFor('admin@inventaris.test')
    const res = await request('POST', '/users', {
      token,
      body: {
        nama_lengkap: 'Duplikat',
        email: 'admin@inventaris.test',
        password: PASSWORD,
        role: 'ADMIN',
      },
    })
    expect(res.status).toBe(409)
    expect((await res.json()) as Record<string, any>).toEqual({
      message: 'Email sudah digunakan',
    })
  })

  it('email tidak valid -> 400', async () => {
    const token = await tokenFor('admin@inventaris.test')
    const res = await request('POST', '/users', {
      token,
      body: { nama_lengkap: 'Salah', email: 'bukan-email', password: PASSWORD, role: 'ADMIN' },
    })
    expect(res.status).toBe(400)
  })
})

describe('UC-02 Ubah & status akun', () => {
  it('ADMIN bisa ubah data + reset password, password baru bisa dipakai login', async () => {
    const token = await tokenFor('admin@inventaris.test')
    const targetId = createdUserIds[0]
    expect(targetId).toBeDefined()

    const res = await request('PATCH', `/users/${targetId}`, {
      token,
      body: { nama_lengkap: 'Staf Diubah', no_hp: null, password: 'rahasia123' },
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as Record<string, any>).nama_lengkap).toBe('Staf Diubah')

    const loginRes = await request('POST', '/auth/login', {
      body: { email: 'staf.baru@inventaris.test', password: 'rahasia123' },
    })
    expect(loginRes.status).toBe(200)
  })

  it('ADMIN tidak boleh menonaktifkan akun sendiri -> 400', async () => {
    const token = await tokenFor('admin@inventaris.test')
    const res = await request('PATCH', '/users/1/status', {
      token,
      body: { status_aktif: false },
    })
    expect(res.status).toBe(400)
    expect((await res.json()) as Record<string, any>).toEqual({
      message: 'Tidak dapat menonaktifkan akun sendiri',
    })
  })

  it('menonaktifkan user lain membuat login-nya gagal (soft delete)', async () => {
    const token = await tokenFor('admin@inventaris.test')
    const targetId = createdUserIds[0]

    const res = await request('PATCH', `/users/${targetId}/status`, {
      token,
      body: { status_aktif: false },
    })
    expect(res.status).toBe(200)

    const loginRes = await request('POST', '/auth/login', {
      body: { email: 'staf.baru@inventaris.test', password: 'rahasia123' },
    })
    expect(loginRes.status).toBe(401)
  })
})

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(activity_logs).where(inArray(activity_logs.user_id, createdUserIds))
    await db.delete(users).where(inArray(users.id_user, createdUserIds))
  }
})
