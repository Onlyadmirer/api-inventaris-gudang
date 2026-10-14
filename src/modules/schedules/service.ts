import { asc, eq, sql } from 'drizzle-orm'
import { db } from '../../db'
import { report_schedules, users } from '../../db/schema'
import { AppError } from '../../plugins/error'
import { nextRunFor, registerSchedule, removeSchedule, type ScheduleRow } from './scheduler'

export type ScheduleResponse = {
  id_jadwal: number
  user_id: number
  nama_user?: string
  jenis_laporan: string
  frekuensi: ScheduleRow['frekuensi']
  waktu_eksekusi: string
  email_penerima: string
  status_aktif: boolean
  created_at: Date
  next_run: Date | null
}

function toResponse(row: ScheduleRow, nama_user?: string): ScheduleResponse {
  return {
    id_jadwal: row.id_jadwal,
    user_id: row.user_id,
    nama_user,
    jenis_laporan: row.jenis_laporan,
    frekuensi: row.frekuensi,
    waktu_eksekusi: row.waktu_eksekusi,
    email_penerima: row.email_penerima,
    status_aktif: row.status_aktif,
    created_at: row.created_at,
    next_run: row.status_aktif ? nextRunFor(row.id_jadwal) : null,
  }
}

export async function listSchedules(page: number, limit: number) {
  const offset = (page - 1) * limit

  const [rows, countResult] = await Promise.all([
    db
      .select({ schedule: report_schedules, nama_user: users.nama_lengkap })
      .from(report_schedules)
      .innerJoin(users, eq(report_schedules.user_id, users.id_user))
      .orderBy(asc(report_schedules.id_jadwal))
      .limit(limit)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(report_schedules),
  ])

  return {
    data: rows.map((row) => toResponse(row.schedule, row.nama_user)),
    meta: { page, limit, total: countResult[0]?.total ?? 0 },
  }
}

export type CreateScheduleInput = {
  jenis_laporan: string
  frekuensi: ScheduleRow['frekuensi']
  waktu_eksekusi: string
  email_penerima: string
  status_aktif?: boolean
}

export async function createSchedule(
  userId: number,
  input: CreateScheduleInput,
): Promise<ScheduleResponse> {
  const [created] = await db
    .insert(report_schedules)
    .values({
      user_id: userId,
      jenis_laporan: input.jenis_laporan,
      frekuensi: input.frekuensi,
      waktu_eksekusi: input.waktu_eksekusi,
      email_penerima: input.email_penerima,
      status_aktif: input.status_aktif ?? true,
    })
    .returning()

  registerSchedule(created)
  return toResponse(created)
}

export type UpdateScheduleInput = Partial<CreateScheduleInput>

export async function updateSchedule(
  id: number,
  input: UpdateScheduleInput,
): Promise<ScheduleResponse> {
  const patch: Partial<typeof report_schedules.$inferInsert> = {}
  if (input.jenis_laporan !== undefined) patch.jenis_laporan = input.jenis_laporan
  if (input.frekuensi !== undefined) patch.frekuensi = input.frekuensi
  if (input.waktu_eksekusi !== undefined) patch.waktu_eksekusi = input.waktu_eksekusi
  if (input.email_penerima !== undefined) patch.email_penerima = input.email_penerima
  if (input.status_aktif !== undefined) patch.status_aktif = input.status_aktif

  if (Object.keys(patch).length === 0) throw new AppError(400, 'Tidak ada data yang diubah')

  const [updated] = await db
    .update(report_schedules)
    .set(patch)
    .where(eq(report_schedules.id_jadwal, id))
    .returning()

  if (!updated) throw new AppError(404, 'Jadwal tidak ditemukan')

  registerSchedule(updated)
  return toResponse(updated)
}

export async function deleteSchedule(id: number): Promise<{ id_jadwal: number }> {
  const [deleted] = await db
    .delete(report_schedules)
    .where(eq(report_schedules.id_jadwal, id))
    .returning({ id_jadwal: report_schedules.id_jadwal })

  if (!deleted) throw new AppError(404, 'Jadwal tidak ditemukan')

  removeSchedule(id)
  return { id_jadwal: deleted.id_jadwal }
}
