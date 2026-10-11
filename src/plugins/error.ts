import { Elysia } from 'elysia'

export class AppError extends Error {
  readonly statusCode: number
  readonly errors?: unknown[]

  constructor(statusCode: number, message: string, errors?: unknown[]) {
    super(message)
    this.name = 'AppError'
    this.statusCode = statusCode
    this.errors = errors
  }
}

export const errorPlugin = new Elysia({ name: 'error' }).onError({ as: 'global' }, ({ code, error, set }) => {
  if (error instanceof AppError) {
    set.status = error.statusCode
    return { message: error.message, errors: error.errors }
  }

  if (code === 'VALIDATION') {
    set.status = 400
    return { message: 'Validasi gagal', errors: error.all }
  }

  if (code === 'NOT_FOUND') {
    set.status = 404
    return { message: 'Data tidak ditemukan' }
  }

  if (code === 'PARSE') {
    set.status = 400
    return { message: 'Body request tidak valid' }
  }

  set.status = 500
  return { message: 'Terjadi kesalahan pada server' }
})
