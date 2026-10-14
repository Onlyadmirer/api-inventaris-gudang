import { and, desc, eq, gte, ilike, lte, sql, type SQL } from 'drizzle-orm'
import { db } from '../../db'
import { activity_logs, items, notification_logs, users } from '../../db/schema'
import { parseDateRange } from '../../lib/date-range'

export type ListAuditLogsFilter = {
  dari?: string
  sampai?: string
  user_id?: number
  aksi?: string
  page: number
  limit: number
}

export async function listAuditLogs(filter: ListAuditLogsFilter) {
  const range = parseDateRange(filter.dari, filter.sampai)
  const conditions: SQL[] = []
  if (range.from) conditions.push(gte(activity_logs.created_at, range.from))
  if (range.to) conditions.push(lte(activity_logs.created_at, range.to))
  if (filter.user_id !== undefined) conditions.push(eq(activity_logs.user_id, filter.user_id))
  if (filter.aksi) conditions.push(ilike(activity_logs.aksi, `%${filter.aksi}%`))

  const where = conditions.length > 0 ? and(...conditions) : undefined
  const offset = (filter.page - 1) * filter.limit

  const [rows, countResult] = await Promise.all([
    db
      .select({ log: activity_logs, nama_user: users.nama_lengkap })
      .from(activity_logs)
      .leftJoin(users, eq(activity_logs.user_id, users.id_user))
      .where(where)
      .orderBy(desc(activity_logs.created_at), desc(activity_logs.id_log))
      .limit(filter.limit)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(activity_logs).where(where),
  ])

  const data = rows.map((row) => ({
    id_log: row.log.id_log,
    user_id: row.log.user_id,
    nama_user: row.nama_user ?? null,
    aksi: row.log.aksi,
    entitas_terkait: row.log.entitas_terkait,
    entitas_id: row.log.entitas_id,
    ip_address: row.log.ip_address,
    created_at: row.log.created_at,
  }))

  return { data, meta: { page: filter.page, limit: filter.limit, total: countResult[0]?.total ?? 0 } }
}

export type ListNotificationLogsFilter = {
  dari?: string
  sampai?: string
  user_id?: number
  barang_id?: number
  kanal?: 'email' | 'whatsapp' | 'push'
  status_kirim?: 'pending' | 'terkirim' | 'gagal'
  sudah_dibaca?: boolean
  page: number
  limit: number
}

export async function listNotificationLogs(filter: ListNotificationLogsFilter) {
  const range = parseDateRange(filter.dari, filter.sampai)
  const conditions: SQL[] = []
  if (range.from) conditions.push(gte(notification_logs.created_at, range.from))
  if (range.to) conditions.push(lte(notification_logs.created_at, range.to))
  if (filter.user_id !== undefined) conditions.push(eq(notification_logs.user_id, filter.user_id))
  if (filter.barang_id !== undefined) conditions.push(eq(notification_logs.barang_id, filter.barang_id))
  if (filter.kanal) conditions.push(eq(notification_logs.kanal, filter.kanal))
  if (filter.status_kirim) conditions.push(eq(notification_logs.status_kirim, filter.status_kirim))
  if (filter.sudah_dibaca !== undefined) {
    conditions.push(eq(notification_logs.sudah_dibaca, filter.sudah_dibaca))
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined
  const offset = (filter.page - 1) * filter.limit

  const [rows, countResult] = await Promise.all([
    db
      .select({
        notif: notification_logs,
        nama_user: users.nama_lengkap,
        kode_barang: items.kode_barang,
        nama_barang: items.nama_barang,
      })
      .from(notification_logs)
      .innerJoin(users, eq(notification_logs.user_id, users.id_user))
      .leftJoin(items, eq(notification_logs.barang_id, items.id_barang))
      .where(where)
      .orderBy(desc(notification_logs.created_at), desc(notification_logs.id_notif))
      .limit(filter.limit)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(notification_logs).where(where),
  ])

  const data = rows.map((row) => ({
    id_notif: row.notif.id_notif,
    user_id: row.notif.user_id,
    nama_user: row.nama_user,
    barang_id: row.notif.barang_id,
    kode_barang: row.kode_barang ?? null,
    nama_barang: row.nama_barang ?? null,
    kanal: row.notif.kanal,
    pesan: row.notif.pesan,
    status_kirim: row.notif.status_kirim,
    sudah_dibaca: row.notif.sudah_dibaca,
    created_at: row.notif.created_at,
  }))

  return { data, meta: { page: filter.page, limit: filter.limit, total: countResult[0]?.total ?? 0 } }
}
