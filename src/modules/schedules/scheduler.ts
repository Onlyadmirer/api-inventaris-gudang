import { Cron } from 'croner'
import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { notification_logs, report_schedules } from '../../db/schema'
import { logActivity } from '../../plugins/audit'
import { sendEmail } from '../../lib/mailer'
import { exportReport, type ReportJenis } from '../reports/service'

export type ScheduleRow = typeof report_schedules.$inferSelect

const jobs = new Map<number, Cron>()

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function ymd(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export type ReportPeriod = {
  dari: string
  sampai: string
}

export function buildPeriod(frekuensi: ScheduleRow['frekuensi'], now = new Date()): ReportPeriod {
  if (frekuensi === 'harian') {
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
    return { dari: ymd(yesterday), sampai: ymd(yesterday) }
  }

  if (frekuensi === 'mingguan') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)
    return { dari: ymd(start), sampai: ymd(now) }
  }

  const firstPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const lastPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0)
  return { dari: ymd(firstPrevMonth), sampai: ymd(lastPrevMonth) }
}

export function buildCronPattern(
  frekuensi: ScheduleRow['frekuensi'],
  waktu_eksekusi: string,
): string {
  const [hour, minute] = waktu_eksekusi.split(':').map(Number)
  if (frekuensi === 'harian') return `${minute} ${hour} * * *`
  if (frekuensi === 'mingguan') return `${minute} ${hour} * * 1`
  return `${minute} ${hour} 1 * *`
}

async function getScheduleRow(id: number): Promise<ScheduleRow | null> {
  const rows = await db
    .select()
    .from(report_schedules)
    .where(eq(report_schedules.id_jadwal, id))
    .limit(1)
  return rows[0] ?? null
}

async function recordNotification(
  row: ScheduleRow,
  status: 'terkirim' | 'gagal',
  period: ReportPeriod,
  errorMessage: string | null,
): Promise<void> {
  try {
    const pesan = `Laporan ${row.jenis_laporan} (${row.frekuensi}) ${period.dari} s/d ${period.sampai}${
      status === 'gagal' && errorMessage ? ` gagal dikirim: ${errorMessage}` : ' terkirim'
    }`
    await db.insert(notification_logs).values({
      user_id: row.user_id,
      barang_id: null,
      kanal: 'email',
      pesan,
      status_kirim: status,
      sudah_dibaca: false,
    })
  } catch (error) {
    console.error('Gagal menulis notification_logs jadwal:', error)
  }
}

export type ScheduleRunResult = {
  id_jadwal: number
  jenis_laporan: ReportJenis
  frekuensi: ScheduleRow['frekuensi']
  email_penerima: string
  status: 'terkirim' | 'gagal'
  periode: ReportPeriod
  error?: string
}

export async function executeSchedule(row: ScheduleRow): Promise<ScheduleRunResult> {
  const period = buildPeriod(row.frekuensi)
  let status: 'terkirim' | 'gagal' = 'terkirim'
  let errorMessage: string | null = null

  try {
    const result = await exportReport(row.jenis_laporan as ReportJenis, 'xlsx', {
      dari: period.dari,
      sampai: period.sampai,
    })
    await sendEmail({
      to: row.email_penerima,
      subject: `Laporan ${row.jenis_laporan} (${row.frekuensi})`,
      text: `Terlampir laporan ${row.jenis_laporan} periode ${period.dari} s/d ${period.sampai}.`,
      attachments: [
        { filename: result.filename, content: result.buffer, contentType: result.contentType },
      ],
    })
  } catch (error) {
    status = 'gagal'
    errorMessage = error instanceof Error ? error.message : String(error)
  }

  await recordNotification(row, status, period, errorMessage)
  await logActivity({
    user_id: row.user_id,
    aksi: 'schedule.run',
    entitas_terkait: 'report_schedules',
    entitas_id: row.id_jadwal,
  })

  return {
    id_jadwal: row.id_jadwal,
    jenis_laporan: row.jenis_laporan as ReportJenis,
    frekuensi: row.frekuensi,
    email_penerima: row.email_penerima,
    status,
    periode: period,
    error: errorMessage ?? undefined,
  }
}

export async function runScheduleNow(id: number): Promise<ScheduleRunResult> {
  const row = await getScheduleRow(id)
  if (!row) throw new Error('Jadwal tidak ditemukan')
  return executeSchedule(row)
}

export function removeSchedule(id: number): void {
  const job = jobs.get(id)
  if (job) {
    job.stop()
    jobs.delete(id)
  }
}

export function registerSchedule(row: ScheduleRow): void {
  removeSchedule(row.id_jadwal)
  if (!row.status_aktif) return

  const pattern = buildCronPattern(row.frekuensi, row.waktu_eksekusi)
  const job = new Cron(
    pattern,
    async () => {
      try {
        const current = await getScheduleRow(row.id_jadwal)
        if (!current || !current.status_aktif) {
          removeSchedule(row.id_jadwal)
          return
        }
        await executeSchedule(current)
      } catch (error) {
        console.error('Eksekusi jadwal gagal:', error)
      }
    },
    { unref: true, catch: true },
  )
  jobs.set(row.id_jadwal, job)
}

export async function loadActiveSchedules(): Promise<void> {
  const rows = await db
    .select()
    .from(report_schedules)
    .where(eq(report_schedules.status_aktif, true))
  for (const row of rows) registerSchedule(row)
}

export function nextRunFor(id: number): Date | null {
  return jobs.get(id)?.nextRun() ?? null
}

export function hasActiveJob(id: number): boolean {
  return jobs.has(id)
}

export function stopAll(): void {
  for (const job of jobs.values()) job.stop()
  jobs.clear()
}
