import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../../db'
import {
  items,
  notification_logs,
  roles,
  user_preferences,
  users,
} from '../../db/schema'
import { sendEmail } from '../../lib/mailer'
import { AppError } from '../../plugins/error'

type ItemRow = typeof items.$inferSelect
type UserRow = typeof users.$inferSelect
type PreferenceRow = typeof user_preferences.$inferSelect

export type Kanal = 'email' | 'whatsapp' | 'push'
export type StatusKirim = 'pending' | 'terkirim' | 'gagal'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_REGEX = /^\+?[0-9]{8,15}$/

// ---------- UC-16 Preferensi Notifikasi ----------

export type PreferenceResponse = {
  id_preferensi: number
  kanal_notifikasi: Kanal
  tujuan: string | null
  status_aktif: boolean
}

function toPreferenceResponse(row: PreferenceRow): PreferenceResponse {
  return {
    id_preferensi: row.id_preferensi,
    kanal_notifikasi: row.kanal_notifikasi,
    tujuan: row.tujuan,
    status_aktif: row.status_aktif,
  }
}

export async function listPreferences(userId: number): Promise<{ data: PreferenceResponse[] }> {
  const rows = await db
    .select()
    .from(user_preferences)
    .where(eq(user_preferences.user_id, userId))
    .orderBy(user_preferences.id_preferensi)

  return { data: rows.map(toPreferenceResponse) }
}

export type PreferenceInput = {
  kanal_notifikasi: Kanal
  tujuan?: string | null
  status_aktif: boolean
}

function normalizeTujuan(input: PreferenceInput): string | null {
  const tujuan = input.tujuan?.trim() ?? null

  if (input.kanal_notifikasi === 'email') {
    if (input.status_aktif && !tujuan) throw new AppError(400, 'Tujuan email wajib diisi')
    if (tujuan && !EMAIL_REGEX.test(tujuan)) throw new AppError(400, 'Format email tidak valid')
  }

  if (input.kanal_notifikasi === 'whatsapp') {
    if (input.status_aktif && !tujuan) throw new AppError(400, 'Nomor WhatsApp wajib diisi')
    if (tujuan && !PHONE_REGEX.test(tujuan)) {
      throw new AppError(400, 'Format nomor WhatsApp tidak valid')
    }
  }

  return tujuan
}

export async function upsertPreferences(
  userId: number,
  inputs: PreferenceInput[],
): Promise<{ data: PreferenceResponse[] }> {
  for (const input of inputs) {
    const tujuan = normalizeTujuan(input)
    await db
      .insert(user_preferences)
      .values({
        user_id: userId,
        kanal_notifikasi: input.kanal_notifikasi,
        tujuan,
        status_aktif: input.status_aktif,
      })
      .onConflictDoUpdate({
        target: [user_preferences.user_id, user_preferences.kanal_notifikasi],
        set: { tujuan, status_aktif: input.status_aktif },
      })
  }

  return listPreferences(userId)
}

// ---------- UC-17 Inbox Notifikasi ----------

export type NotificationResponse = {
  id_notif: number
  barang_id: number | null
  kode_barang: string | null
  nama_barang: string | null
  kanal: Kanal
  pesan: string
  status_kirim: StatusKirim
  sudah_dibaca: boolean
  created_at: Date
}

export async function listNotifications(
  userId: number,
  unread: boolean | undefined,
  page: number,
  limit: number,
) {
  const conditions = [eq(notification_logs.user_id, userId)]
  if (unread !== undefined) conditions.push(eq(notification_logs.sudah_dibaca, !unread))
  const where = and(...conditions)
  const offset = (page - 1) * limit

  const [rows, countResult] = await Promise.all([
    db
      .select({
        notif: notification_logs,
        kode_barang: items.kode_barang,
        nama_barang: items.nama_barang,
      })
      .from(notification_logs)
      .leftJoin(items, eq(notification_logs.barang_id, items.id_barang))
      .where(where)
      .orderBy(desc(notification_logs.created_at), desc(notification_logs.id_notif))
      .limit(limit)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(notification_logs).where(where),
  ])

  const data: NotificationResponse[] = rows.map((row) => ({
    id_notif: row.notif.id_notif,
    barang_id: row.notif.barang_id,
    kode_barang: row.kode_barang ?? null,
    nama_barang: row.nama_barang ?? null,
    kanal: row.notif.kanal,
    pesan: row.notif.pesan,
    status_kirim: row.notif.status_kirim,
    sudah_dibaca: row.notif.sudah_dibaca,
    created_at: row.notif.created_at,
  }))

  return { data, meta: { page, limit, total: countResult[0]?.total ?? 0 } }
}

export async function markRead(userId: number, id: number) {
  const [updated] = await db
    .update(notification_logs)
    .set({ sudah_dibaca: true })
    .where(and(eq(notification_logs.id_notif, id), eq(notification_logs.user_id, userId)))
    .returning()

  if (!updated) throw new AppError(404, 'Notifikasi tidak ditemukan')

  return { id_notif: updated.id_notif, sudah_dibaca: updated.sudah_dibaca }
}

export async function markAllRead(userId: number) {
  const updated = await db
    .update(notification_logs)
    .set({ sudah_dibaca: true })
    .where(and(eq(notification_logs.user_id, userId), eq(notification_logs.sudah_dibaca, false)))
    .returning({ id_notif: notification_logs.id_notif })

  return { updated: updated.length }
}

// ---------- Hook pasca perubahan stok (UC-17) ----------

async function insertNotification(
  userId: number,
  barangId: number,
  kanal: Kanal,
  pesan: string,
  statusKirim: StatusKirim,
): Promise<void> {
  await db.insert(notification_logs).values({
    user_id: userId,
    barang_id: barangId,
    kanal,
    pesan,
    status_kirim: statusKirim,
    sudah_dibaca: false,
  })
}

async function notifyRecipient(
  user: UserRow,
  item: ItemRow,
  pesan: string,
  preferences: PreferenceRow[],
): Promise<void> {
  try {
    await insertNotification(user.id_user, item.id_barang, 'push', pesan, 'terkirim')
  } catch (error) {
    console.error('Gagal menyimpan notifikasi in-app:', error)
  }

  const activePrefs = preferences.filter((p) => p.user_id === user.id_user && p.status_aktif)

  const emailPref = activePrefs.find((p) => p.kanal_notifikasi === 'email')
  if (emailPref?.tujuan) {
    try {
      await sendEmail({
        to: emailPref.tujuan,
        subject: `Peringatan Stok Minimum: ${item.nama_barang}`,
        text: pesan,
      })
      await insertNotification(user.id_user, item.id_barang, 'email', pesan, 'terkirim')
    } catch (error) {
      console.error('Gagal kirim email notifikasi:', error)
      try {
        await insertNotification(user.id_user, item.id_barang, 'email', pesan, 'gagal')
      } catch (insertError) {
        console.error('Gagal mencatat email notifikasi:', insertError)
      }
    }
  }

  const whatsappPref = activePrefs.find((p) => p.kanal_notifikasi === 'whatsapp')
  if (whatsappPref?.tujuan) {
    try {
      await insertNotification(user.id_user, item.id_barang, 'whatsapp', pesan, 'pending')
    } catch (error) {
      console.error('Gagal mencatat notifikasi WhatsApp:', error)
    }
  }
}

export async function afterStockChange(itemIds: number[]): Promise<void> {
  try {
    const uniqueIds = [...new Set(itemIds)].filter((id) => Number.isInteger(id) && id > 0)
    if (uniqueIds.length === 0) return

    const lowItems = await db
      .select()
      .from(items)
      .where(
        and(
          inArray(items.id_barang, uniqueIds),
          sql`${items.stok_saat_ini} <= ${items.batas_stok_minimum}`,
        ),
      )
    if (lowItems.length === 0) return

    const recipients = await db
      .select({ user: users })
      .from(users)
      .innerJoin(roles, eq(users.role_id, roles.id_role))
      .where(
        and(
          eq(users.status_aktif, true),
          inArray(roles.nama_role, ['KEPALA_GUDANG', 'ADMIN']),
        ),
      )
    if (recipients.length === 0) return

    const preferences = await db
      .select()
      .from(user_preferences)
      .where(inArray(user_preferences.user_id, recipients.map((r) => r.user.id_user)))

    for (const item of lowItems) {
      const pesan = `Stok barang ${item.nama_barang} (${item.kode_barang}) menipis: sisa ${item.stok_saat_ini}, batas minimum ${item.batas_stok_minimum}.`
      for (const { user } of recipients) {
        await notifyRecipient(user, item, pesan, preferences)
      }
    }
  } catch (error) {
    console.error('afterStockChange gagal:', error)
  }
}
