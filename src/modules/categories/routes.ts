import { Elysia } from 'elysia'
import { authPlugin } from '../../plugins/auth'
import { clientIp, logActivity } from '../../plugins/audit'
import { createCategoryBody, categoryIdParams, updateCategoryBody } from './model'
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from './service'

export const categoryRoutes = new Elysia({ prefix: '/categories' })
  .use(authPlugin)
  .get(
    '/',
    async () => listCategories(),
    {
      requireAuth: true,
      detail: {
        summary: 'Daftar kategori (UC-03)',
        tags: ['Semua'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .post(
    '/',
    async ({ body, authUser, server, request, set }) => {
      const created = await createCategory(body)
      await logActivity({
        user_id: authUser!.id_user,
        aksi: 'category.create',
        entitas_terkait: 'categories',
        entitas_id: created.id_kategori,
        ip_address: clientIp(server, request),
      })
      set.status = 201
      return created
    },
    {
      body: createCategoryBody,
      requireRole: ['ADMIN'],
      detail: {
        summary: 'Tambah kategori (UC-03)',
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .patch(
    '/:id',
    async ({ params, body, authUser, server, request }) => {
      const updated = await updateCategory(params.id, body)
      await logActivity({
        user_id: authUser!.id_user,
        aksi: 'category.update',
        entitas_terkait: 'categories',
        entitas_id: updated.id_kategori,
        ip_address: clientIp(server, request),
      })
      return updated
    },
    {
      params: categoryIdParams,
      body: updateCategoryBody,
      requireRole: ['ADMIN'],
      detail: {
        summary: 'Ubah kategori (UC-03)',
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .delete(
    '/:id',
    async ({ params, authUser, server, request }) => {
      const deleted = await deleteCategory(params.id)
      await logActivity({
        user_id: authUser!.id_user,
        aksi: 'category.delete',
        entitas_terkait: 'categories',
        entitas_id: deleted.id_kategori,
        ip_address: clientIp(server, request),
      })
      return { message: 'Kategori dihapus' }
    },
    {
      params: categoryIdParams,
      requireRole: ['ADMIN'],
      detail: {
        summary: 'Hapus kategori (UC-03)',
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
      },
    },
  )
