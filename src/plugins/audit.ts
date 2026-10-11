import { db } from '../db'
import { activity_logs } from '../db/schema'

export type LogActivityInput = {
  user_id?: number | null
  aksi: string
  entitas_terkait?: string | null
  entitas_id?: number | null
  ip_address?: string | null
}

export async function logActivity(input: LogActivityInput): Promise<void> {
  try {
    await db.insert(activity_logs).values({
      user_id: input.user_id ?? null,
      aksi: input.aksi,
      entitas_terkait: input.entitas_terkait ?? null,
      entitas_id: input.entitas_id ?? null,
      ip_address: input.ip_address ?? null,
    })
  } catch (error) {
    console.error('Gagal menulis activity_logs:', error)
  }
}

export function clientIp(server: unknown, request: Request): string | null {
  const s = server as { requestIP?: (r: Request) => { address?: string } | null } | null
  try {
    return s?.requestIP?.(request)?.address ?? null
  } catch {
    return null
  }
}
