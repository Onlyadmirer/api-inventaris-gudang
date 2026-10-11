import { AppError } from '../../plugins/error'
import type { Role } from '../../plugins/auth'
import { findUserByEmail } from '../users/service'
import type { UserResponse } from '../users/service'

export type AuthenticatedUser = {
  user: UserResponse
  role: Role
}

export async function authenticate(email: string, password: string): Promise<AuthenticatedUser> {
  const invalid = new AppError(401, 'Email atau password salah')

  const found = await findUserByEmail(email)
  if (!found || !found.user.status_aktif) throw invalid

  const passwordValid = await Bun.password.verify(password, found.user.password_hash)
  if (!passwordValid) throw invalid

  return {
    user: {
      id_user: found.user.id_user,
      nama_lengkap: found.user.nama_lengkap,
      email: found.user.email,
      no_hp: found.user.no_hp,
      role: found.role,
      status_aktif: found.user.status_aktif,
      created_at: found.user.created_at,
    },
    role: found.role,
  }
}
