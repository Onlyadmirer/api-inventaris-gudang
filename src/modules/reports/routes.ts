import { Elysia } from 'elysia'
import { authPlugin } from '../../plugins/auth'
import { clientIp, logActivity } from '../../plugins/audit'
import { reportExportQuery, reportJenisParams, reportQuery } from './model'
import { exportReport, getReport } from './service'

export const reportRoutes = new Elysia({ prefix: '/reports' })
  .use(authPlugin)
  .get(
    '/:jenis/export',
    async ({ params, query, authUser, server, request }) => {
      const result = await exportReport(params.jenis, query.format, query)

      await logActivity({
        user_id: authUser!.id_user,
        aksi: 'report.export',
        entitas_terkait: 'reports',
        ip_address: clientIp(server, request),
      })

      return new Response(result.buffer, {
        headers: {
          'content-type': result.contentType,
          'content-disposition': `attachment; filename="${result.filename}"`,
        },
      })
    },
    {
      params: reportJenisParams,
      query: reportExportQuery,
      requireRole: ['ADMIN', 'KEPALA_GUDANG'],
      detail: {
        summary: 'Ekspor laporan PDF/Excel (UC-14)',
        tags: ['Reports'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .get(
    '/:jenis',
    async ({ params, query, authUser, server, request }) => {
      const result = await getReport(params.jenis, query)

      await logActivity({
        user_id: authUser!.id_user,
        aksi: 'report.view',
        entitas_terkait: 'reports',
        ip_address: clientIp(server, request),
      })

      return result
    },
    {
      params: reportJenisParams,
      query: reportQuery,
      requireRole: ['ADMIN', 'KEPALA_GUDANG'],
      detail: {
        summary: 'Laporan stok/transaksi/opname JSON (UC-14)',
        tags: ['Reports'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
