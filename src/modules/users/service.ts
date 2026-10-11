import { asc, eq, sql } from 'drizzle-orm'
import { db } from '../../db'
import { roles, users } from '../../db/schema'
import { AppError } from '../../plugins/error'
import type { Role } from '../../plugins/auth'

type UserRow = typeof users.$inferSelect

export type UserResponse = {
  id_user: number
  nama_lengkap: string
  email: string
  no_hp: string | null
  role: Role
  status_aktif: boolean
  created_at: Date
}

export function toUserResponse(user: UserRow, role: Role): UserResponse {
  return {
    id_user: user.id_user,
    nama_lengkap: user.nama_lengkap,
    email: user.email,
    no_hp: user.no_hp,
    role,
    status_aktif: user.status_aktif,
    created_at: user.created_at,
  }
}

async function getRoleId(nama_role: Role): Promise<number> {
  const rows = await db
    .select({ id_role: roles.id_role })
    .from(roles)
    .where(eq(roles.nama_role, nama_role))
    .limit(1)
  const row = rows[0]
  if (!row) throw new AppError(400, `Role ${nama_role} tidak ditemukan`)
  return row.id_role
}

export async function findUserByEmail(email: string) {
  const rows = await db
    .select({ user: users, role: roles.nama_role })
    .from(users)
    .innerJoin(roles, eq(users.role_id, roles.id_role))
    .where(eq(users.email, email))
    .limit(1)

  const row = rows[0]
  if (!row) return null
  return { user: row.user, role: row.role as Role }
}

export async function findUserById(id: number) {
  const rows = await db
    .select({ user: users, role: roles.nama_role })
    .from(users)
    .innerJoin(roles, eq(users.role_id, roles.id_role))
    .where(eq(users.id_user, id))
    .limit(1)

  const row = rows[0]
  if (!row) return null
  return { user: row.user, role: row.role as Role }
}

export async function listUsers(page: number, limit: number) {
  const offset = (page - 1) * limit

  const [rows, countResult] = await Promise.all([
    db
      .select({ user: users, role: roles.nama_role })
      .from(users)
      .innerJoin(roles, eq(users.role_id, roles.id_role))
      .orderBy(asc(users.id_user))
      .limit(limit)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(users),
  ])

  return {
    data: rows.map((r) => toUserResponse(r.user, r.role as Role)),
    meta: { page, limit, total: countResult[0]?.total ?? 0 },
  }
}

export type CreateUserInput = {
  nama_lengkap: string
  email: string
  password: string
  no_hp?: string
  role: Role
}

export async function createUser(input: CreateUserInput): Promise<UserResponse> {
  const existing = await db
    .select({ id_user: users.id_user })
    .from(users)
    .where(eq(users.email, input.email))
    .limit(1)
  if (existing.length > 0) throw new AppError(409, 'Email sudah digunakan')

  const roleId = await getRoleId(input.role)
  const passwordHash = await Bun.password.hash(input.password)

  try {
    const [created] = await db
      .insert(users)
      .values({
        role_id: roleId,
        nama_lengkap: input.nama_lengkap,
        email: input.email,
        password_hash: passwordHash,
        no_hp: input.no_hp ?? null,
      })
      .returning()

    return toUserResponse(created, input.role)
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new AppError(409, 'Email sudah digunakan')
    }
    throw error
  }
}

export type UpdateUserInput = {
  nama_lengkap?: string
  no_hp?: string | null
  role?: Role
  password?: string
}

export async function updateUser(id: number, input: UpdateUserInput): Promise<UserResponse> {
  const current = await findUserById(id)
  if (!current) throw new AppError(404, 'User tidak ditemukan')

  const patch: Partial<typeof users.$inferInsert> = {}
  if (input.nama_lengkap !== undefined) patch.nama_lengkap = input.nama_lengkap
  if (input.no_hp !== undefined) patch.no_hp = input.no_hp
  if (input.role !== undefined) patch.role_id = await getRoleId(input.role)
  if (input.password !== undefined) patch.password_hash = await Bun.password.hash(input.password)

  if (Object.keys(patch).length === 0) throw new AppError(400, 'Tidak ada data yang diubah')

  const [updated] = await db.update(users).set(patch).where(eq(users.id_user, id)).returning()

  return toUserResponse(updated, input.role ?? current.role)
}

export async function setUserStatus(
  actingUserId: number,
  targetId: number,
  status_aktif: boolean,
): Promise<UserResponse> {
  if (actingUserId === targetId && !status_aktif) {
    throw new AppError(400, 'Tidak dapat menonaktifkan akun sendiri')
  }

  const current = await findUserById(targetId)
  if (!current) throw new AppError(404, 'User tidak ditemukan')

  const [updated] = await db
    .update(users)
    .set({ status_aktif })
    .where(eq(users.id_user, targetId))
    .returning()

  return toUserResponse(updated, current.role)
}
