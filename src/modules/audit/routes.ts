import { Elysia } from 'elysia'
import { authPlugin } from '../../plugins/auth'
import { listAuditLogsQuery, listNotificationLogsQuery } from './model'
import { listAuditLogs, listNotificationLogs } from './service'

export const auditRoutes = new Elysia()
  .use(authPlugin)
  .get(
    '/audit-logs',
    async ({ query }) => {
      return listAuditLogs({
        dari: query.dari,
        sampai: query.sampai,
        user_id: query.user_id,
        aksi: query.aksi,
        page: query.page ?? 1,
        limit: query.limit ?? 20,
      })
    },
    {
      query: listAuditLogsQuery,
      requireRole: ['ADMIN'],
      detail: {
        summary: 'Audit trail aktivitas (UC-07)',
        tags: ['Audit'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .get(
    '/notification-logs',
    async ({ query }) => {
      return listNotificationLogs({
        dari: query.dari,
        sampai: query.sampai,
        user_id: query.user_id,
        barang_id: query.barang_id,
        kanal: query.kanal,
        status_kirim: query.status_kirim,
        sudah_dibaca: query.sudah_dibaca,
        page: query.page ?? 1,
        limit: query.limit ?? 20,
      })
    },
    {
      query: listNotificationLogsQuery,
      requireRole: ['ADMIN'],
      detail: {
        summary: 'Log notifikasi (UC-07)',
        tags: ['Audit'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
