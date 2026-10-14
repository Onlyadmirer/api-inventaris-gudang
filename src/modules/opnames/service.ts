import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm'
import { db } from '../../db'
import {
  items,
  stock_movements,
  stock_opname_details,
  stock_opnames,
  users,
} from '../../db/schema'
import { afterStockChange } from '../../lib/notification-hook'
import { AppError } from '../../plugins/error'

type OpnameRow = typeof stock_opnames.$inferSelect
type OpnameDetailRow = typeof stock_opname_details.$inferSelect
type ItemRow = typeof items.$inferSelect

export type OpnameResponse = {
  id_opname: number
  user_id: number
  nama_user: string
  tanggal_opname: Date
  status: 'draft' | 'selesai'
  keterangan: string | null
}

function toOpnameResponse(opname: OpnameRow, nama_user: string): OpnameResponse {
  return {
    id_opname: opname.id_opname,
    user_id: opname.user_id,
    nama_user,
    tanggal_opname: opname.tanggal_opname,
    status: opname.status,
    keterangan: opname.keterangan,
  }
}

export async function createOpname(user_id: number, keterangan?: string): Promise<OpnameResponse> {
  const [created] = await db
    .insert(stock_opnames)
    .values({ user_id, keterangan: keterangan ?? null })
    .returning()

  const [userRow] = await db
    .select({ nama_lengkap: users.nama_lengkap })
    .from(users)
    .where(eq(users.id_user, user_id))
    .limit(1)

  return toOpnameResponse(created, userRow?.nama_lengkap ?? '')
}

export type ListOpnamesFilter = {
  status?: 'draft' | 'selesai'
  page: number
  limit: number
}

export type OpnameListItem = OpnameResponse & {
  jumlah_item: number
  jumlah_selisih: number
}

export async function listOpnames(filter: ListOpnamesFilter) {
  const conditions: SQL[] = []
  if (filter.status) conditions.push(eq(stock_opnames.status, filter.status))
  const where = conditions.length > 0 ? and(...conditions) : undefined
  const offset = (filter.page - 1) * filter.limit

  const [rows, countResult] = await Promise.all([
    db
      .select({
        opname: stock_opnames,
        nama_user: users.nama_lengkap,
        jumlah_item: sql<number>`count(${stock_opname_details.id_detail_opname})::int`,
        jumlah_selisih: sql<number>`count(*) filter (where ${stock_opname_details.selisih} <> 0)::int`,
      })
      .from(stock_opnames)
      .innerJoin(users, eq(stock_opnames.user_id, users.id_user))
      .leftJoin(stock_opname_details, eq(stock_opname_details.opname_id, stock_opnames.id_opname))
      .where(where)
      .groupBy(stock_opnames.id_opname, users.nama_lengkap)
      .orderBy(desc(stock_opnames.tanggal_opname))
      .limit(filter.limit)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(stock_opnames).where(where),
  ])

  const data: OpnameListItem[] = rows.map((r) => ({
    ...toOpnameResponse(r.opname, r.nama_user),
    jumlah_item: r.jumlah_item,
    jumlah_selisih: r.jumlah_selisih,
  }))

  return { data, meta: { page: filter.page, limit: filter.limit, total: countResult[0]?.total ?? 0 } }
}

export type OpnameDetailResponse = {
  id_detail_opname: number
  barang_id: number
  kode_barang: string
  nama_barang: string
  stok_sistem: number
  stok_fisik: number
  selisih: number
  keterangan: string | null
}

function toDetailResponse(detail: OpnameDetailRow, item: ItemRow): OpnameDetailResponse {
  return {
    id_detail_opname: detail.id_detail_opname,
    barang_id: detail.barang_id,
    kode_barang: item.kode_barang,
    nama_barang: item.nama_barang,
    stok_sistem: detail.stok_sistem,
    stok_fisik: detail.stok_fisik,
    selisih: detail.selisih,
    keterangan: detail.keterangan,
  }
}

export type OpnameSummary = {
  total_item: number
  jumlah_sesuai: number
  jumlah_selisih: number
}

export type OpnameDetailSummaryResponse = OpnameResponse & {
  details: OpnameDetailResponse[]
  ringkasan: OpnameSummary
}

export async function getOpname(id: number): Promise<OpnameDetailSummaryResponse> {
  const [header] = await db
    .select({ opname: stock_opnames, nama_user: users.nama_lengkap })
    .from(stock_opnames)
    .innerJoin(users, eq(stock_opnames.user_id, users.id_user))
    .where(eq(stock_opnames.id_opname, id))
    .limit(1)

  if (!header) throw new AppError(404, 'Opname tidak ditemukan')

  const rows = await db
    .select({ detail: stock_opname_details, item: items })
    .from(stock_opname_details)
    .innerJoin(items, eq(stock_opname_details.barang_id, items.id_barang))
    .where(eq(stock_opname_details.opname_id, id))
    .orderBy(asc(stock_opname_details.id_detail_opname))

  const details = rows.map((r) => toDetailResponse(r.detail, r.item))
  const jumlah_selisih = details.filter((d) => d.selisih !== 0).length

  return {
    ...toOpnameResponse(header.opname, header.nama_user),
    details,
    ringkasan: {
      total_item: details.length,
      jumlah_sesuai: details.length - jumlah_selisih,
      jumlah_selisih,
    },
  }
}

export async function addOpnameDetail(
  opnameId: number,
  input: { barang_id: number; stok_fisik: number; keterangan?: string },
): Promise<OpnameDetailResponse> {
  const result = await db.transaction(async (tx) => {
    const [opname] = await tx
      .select()
      .from(stock_opnames)
      .where(eq(stock_opnames.id_opname, opnameId))
      .limit(1)
      .for('update')

    if (!opname) throw new AppError(404, 'Opname tidak ditemukan')
    if (opname.status !== 'draft') throw new AppError(409, 'Opname sudah selesai')

    const [item] = await tx
      .select()
      .from(items)
      .where(eq(items.id_barang, input.barang_id))
      .limit(1)
    if (!item) throw new AppError(404, 'Barang tidak ditemukan')

    const stok_sistem = item.stok_saat_ini
    const selisih = input.stok_fisik - stok_sistem
    const keterangan = input.keterangan ?? null

    const [existing] = await tx
      .select()
      .from(stock_opname_details)
      .where(
        and(
          eq(stock_opname_details.opname_id, opnameId),
          eq(stock_opname_details.barang_id, input.barang_id),
        ),
      )
      .limit(1)

    if (existing) {
      const [updated] = await tx
        .update(stock_opname_details)
        .set({ stok_sistem, stok_fisik: input.stok_fisik, selisih, keterangan })
        .where(eq(stock_opname_details.id_detail_opname, existing.id_detail_opname))
        .returning()
      return toDetailResponse(updated, item)
    }

    const [created] = await tx
      .insert(stock_opname_details)
      .values({
        opname_id: opnameId,
        barang_id: input.barang_id,
        stok_sistem,
        stok_fisik: input.stok_fisik,
        selisih,
        keterangan,
      })
      .returning()

    return toDetailResponse(created, item)
  })

  return result
}

export async function finalizeOpname(
  id: number,
  sinkronkan: boolean,
  user_id: number,
): Promise<OpnameDetailSummaryResponse> {
  const changedItemIds = await db.transaction(async (tx) => {
    const [updatedOpname] = await tx
      .update(stock_opnames)
      .set({ status: 'selesai' })
      .where(and(eq(stock_opnames.id_opname, id), eq(stock_opnames.status, 'draft')))
      .returning()

    if (!updatedOpname) {
      const [exists] = await tx
        .select({ status: stock_opnames.status })
        .from(stock_opnames)
        .where(eq(stock_opnames.id_opname, id))
        .limit(1)
      if (!exists) throw new AppError(404, 'Opname tidak ditemukan')
      throw new AppError(409, 'Opname sudah selesai')
    }

    const details = await tx
      .select()
      .from(stock_opname_details)
      .where(eq(stock_opname_details.opname_id, id))

    if (details.length === 0) throw new AppError(400, 'Opname belum memiliki detail')

    const changed: number[] = []
    if (sinkronkan) {
      for (const detail of details) {
        if (detail.selisih === 0) continue

        await tx
          .update(items)
          .set({ stok_saat_ini: detail.stok_fisik })
          .where(eq(items.id_barang, detail.barang_id))

        await tx.insert(stock_movements).values({
          barang_id: detail.barang_id,
          user_id,
          transaksi_id: null,
          opname_id: id,
          jenis_pergerakan: 'penyesuaian',
          jumlah: detail.selisih,
          stok_sebelum: detail.stok_sistem,
          stok_sesudah: detail.stok_fisik,
        })

        changed.push(detail.barang_id)
      }
    }

    return changed
  })

  try {
    if (changedItemIds.length > 0) await afterStockChange(changedItemIds)
  } catch (error) {
    console.error('afterStockChange gagal:', error)
  }

  return getOpname(id)
}
