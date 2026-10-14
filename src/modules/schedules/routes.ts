import { Elysia } from 'elysia'
import { authPlugin } from '../../plugins/auth'
import { clientIp, logActivity } from '../../plugins/audit'
import {
  createScheduleBody,
  listSchedulesQuery,
  scheduleIdParams,
  updateScheduleBody,
} from './model'
import {
  createSchedule,
  deleteSchedule,
  listSchedules,
  updateSchedule,
} from './service'

export const scheduleRoutes = new Elysia({ prefix: '/schedules' })
  .use(authPlugin)
  .get(
    '/',
    async ({ query }) => listSchedules(query.page ?? 1, query.limit ?? 20),
    {
      query: listSchedulesQuery,
      requireRole: ['KEPALA_GUDANG'],
      detail: {
        summary: 'Daftar jadwal laporan (UC-06)',
        tags: ['Schedules'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .post(
    '/',
    async ({ body, authUser, server, request, set }) => {
      const created = await createSchedule(authUser!.id_user, body)
      await logActivity({
        user_id: authUser!.id_user,
        aksi: 'schedule.create',
        entitas_terkait: 'report_schedules',
        entitas_id: created.id_jadwal,
        ip_address: clientIp(server, request),
      })
      set.status = 201
      return created
    },
    {
      body: createScheduleBody,
      requireRole: ['KEPALA_GUDANG'],
      detail: {
        summary: 'Tambah jadwal laporan (UC-06)',
        tags: ['Schedules'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .patch(
    '/:id',
    async ({ params, body, authUser, server, request }) => {
      const updated = await updateSchedule(params.id, body)
      await logActivity({
        user_id: authUser!.id_user,
        aksi: 'schedule.update',
        entitas_terkait: 'report_schedules',
        entitas_id: updated.id_jadwal,
        ip_address: clientIp(server, request),
      })
      return updated
    },
    {
      params: scheduleIdParams,
      body: updateScheduleBody,
      requireRole: ['KEPALA_GUDANG'],
      detail: {
        summary: 'Ubah jadwal laporan (UC-06)',
        tags: ['Schedules'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .delete(
    '/:id',
    async ({ params, authUser, server, request }) => {
      const deleted = await deleteSchedule(params.id)
      await logActivity({
        user_id: authUser!.id_user,
        aksi: 'schedule.delete',
        entitas_terkait: 'report_schedules',
        entitas_id: deleted.id_jadwal,
        ip_address: clientIp(server, request),
      })
      return deleted
    },
    {
      params: scheduleIdParams,
      requireRole: ['KEPALA_GUDANG'],
      detail: {
        summary: 'Hapus jadwal laporan (UC-06)',
        tags: ['Schedules'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
