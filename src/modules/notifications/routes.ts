import { Elysia } from 'elysia'
import { authPlugin } from '../../plugins/auth'
import {
  listNotificationsQuery,
  notificationIdParams,
  updatePreferencesBody,
} from './model'
import {
  listNotifications,
  listPreferences,
  markAllRead,
  markRead,
  upsertPreferences,
} from './service'

export const preferenceRoutes = new Elysia({ prefix: '/preferences' })
  .use(authPlugin)
  .get(
    '/',
    async ({ authUser }) => listPreferences(authUser!.id_user),
    {
      requireRole: ['KEPALA_GUDANG'],
      detail: {
        summary: 'Daftar preferensi notifikasi (UC-16)',
        tags: ['Kepala Gudang'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .put(
    '/',
    async ({ authUser, body }) => upsertPreferences(authUser!.id_user, body.preferences),
    {
      body: updatePreferencesBody,
      requireRole: ['KEPALA_GUDANG'],
      detail: {
        summary: 'Ubah preferensi notifikasi (UC-16)',
        tags: ['Kepala Gudang'],
        security: [{ bearerAuth: [] }],
      },
    },
  )

export const notificationRoutes = new Elysia({ prefix: '/notifications' })
  .use(authPlugin)
  .get(
    '/',
    async ({ authUser, query }) =>
      listNotifications(authUser!.id_user, query.unread, query.page ?? 1, query.limit ?? 20),
    {
      query: listNotificationsQuery,
      requireRole: ['ADMIN', 'KEPALA_GUDANG'],
      detail: {
        summary: 'Inbox notifikasi in-app (UC-17)',
        tags: ['Admin', 'Kepala Gudang'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .patch(
    '/read-all',
    async ({ authUser }) => markAllRead(authUser!.id_user),
    {
      requireRole: ['ADMIN', 'KEPALA_GUDANG'],
      detail: {
        summary: 'Tandai semua notifikasi terbaca (UC-17)',
        tags: ['Admin', 'Kepala Gudang'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .patch(
    '/:id/read',
    async ({ authUser, params }) => markRead(authUser!.id_user, params.id),
    {
      params: notificationIdParams,
      requireRole: ['ADMIN', 'KEPALA_GUDANG'],
      detail: {
        summary: 'Tandai notifikasi terbaca (UC-17)',
        tags: ['Admin', 'Kepala Gudang'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
