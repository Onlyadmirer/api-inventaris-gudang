import { and, desc, eq, gte, inArray, lte, or, sql, type SQL } from 'drizzle-orm'
import { db } from '../../db'
import { items, stock_movements, transaction_details, transactions, users } from '../../db/schema'
import { afterStockChange } from '../../lib/notification-hook'
import { parseDateRange } from '../../lib/date-range'
import { AppError } from '../../plugins/error'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type ItemRow = typeof items.$inferSelect

export type TransactionItemInput =
  | { barang_id: number; jumlah: number }
  | { kode_barang: string; jumlah: number }

export type CreateTransactionInput = {
  user_id: number
  jenis: 'masuk' | 'keluar'
  items: TransactionItemInput[]
  keterangan?: string
  sumber?: 'scan' | 'manual'
}

export type TransactionItemResult = {
  barang_id: number
  kode_barang: string
  nama_barang: string
  jumlah: number
  stok_sebelum: number
  stok_sesudah: number
}

export type TransactionResponse = {
  id_transaksi: number
  user_id: number
  jenis_transaksi: 'masuk' | 'keluar'
  tanggal_transaksi: Date
  keterangan: string | null
  items: TransactionItemResult[]
}

function buildKeterangan(
  keterangan: string | undefined,
  sumber: 'scan' | 'manual' | undefined,
): string | null {
  const parts: string[] = []
  if (sumber) parts.push(`[${sumber}]`)
  if (keterangan) parts.push(keterangan)
  const result = parts.join(' ').trim()
  return result.length > 0 ? result : null
}

// Resolusi referensi barang (id atau kode), lalu agregasi bila item muncul >1x.
async function resolveItems(tx: Tx, inputs: TransactionItemInput[]): Promise<Array<{ item: ItemRow; jumlah: number }>> {
  const ids = inputs
    .filter((i): i is { barang_id: number; jumlah: number } => 'barang_id' in i)
    .map((i) => i.barang_id)
  const codes = inputs
    .filter((i): i is { kode_barang: string; jumlah: number } => 'kode_barang' in i)
    .map((i) => i.kode_barang)

  const conditions = []
  if (ids.length > 0) conditions.push(inArray(items.id_barang, ids))
  if (codes.length > 0) conditions.push(inArray(items.kode_barang, codes))

  const rows = conditions.length > 0 ? await tx.select().from(items).where(or(...conditions)) : []

  const byId = new Map(rows.map((r) => [r.id_barang, r]))
  const byCode = new Map(rows.map((r) => [r.kode_barang, r]))

  const aggregated = new Map<number, { item: ItemRow; jumlah: number }>()
  for (const input of inputs) {
    const row = 'barang_id' in input ? byId.get(input.barang_id) : byCode.get(input.kode_barang)
    if (!row) throw new AppError(404, 'Barang tidak ditemukan')

    const existing = aggregated.get(row.id_barang)
    if (existing) existing.jumlah += input.jumlah
    else aggregated.set(row.id_barang, { item: row, jumlah: input.jumlah })
  }

  return [...aggregated.values()]
}

export async function createTransaction(input: CreateTransactionInput): Promise<TransactionResponse> {
  const keterangan = buildKeterangan(input.keterangan, input.sumber)

  const committed = await db.transaction(async (tx) => {
    const resolved = await resolveItems(tx, input.items)

    const [trx] = await tx
      .insert(transactions)
      .values({ user_id: input.user_id, jenis_transaksi: input.jenis, keterangan })
      .returning()

    const results: TransactionItemResult[] = []

    for (const { item, jumlah } of resolved) {
      let stok_sebelum: number
      let stok_sesudah: number

      if (input.jenis === 'masuk') {
        const [updated] = await tx
          .update(items)
          .set({ stok_saat_ini: sql`${items.stok_saat_ini} + ${jumlah}` })
          .where(eq(items.id_barang, item.id_barang))
          .returning({ stok_saat_ini: items.stok_saat_ini })

        if (!updated) throw new AppError(404, 'Barang tidak ditemukan')

        stok_sesudah = updated.stok_saat_ini
        stok_sebelum = stok_sesudah - jumlah
      } else {
        const [updated] = await tx
          .update(items)
          .set({ stok_saat_ini: sql`${items.stok_saat_ini} - ${jumlah}` })
          .where(and(eq(items.id_barang, item.id_barang), gte(items.stok_saat_ini, jumlah)))
          .returning({ stok_saat_ini: items.stok_saat_ini })

        if (!updated) throw new AppError(400, `Stok tidak mencukupi untuk barang ${item.nama_barang}`)

        stok_sesudah = updated.stok_saat_ini
        stok_sebelum = stok_sesudah + jumlah
      }

      await tx.insert(transaction_details).values({
        transaksi_id: trx.id_transaksi,
        barang_id: item.id_barang,
        jumlah,
      })

      await tx.insert(stock_movements).values({
        barang_id: item.id_barang,
        user_id: input.user_id,
        transaksi_id: trx.id_transaksi,
        opname_id: null,
        jenis_pergerakan: input.jenis,
        jumlah,
        stok_sebelum,
        stok_sesudah,
      })

      results.push({
        barang_id: item.id_barang,
        kode_barang: item.kode_barang,
        nama_barang: item.nama_barang,
        jumlah,
        stok_sebelum,
        stok_sesudah,
      })
    }

    return { trx, results }
  })

  try {
    await afterStockChange(committed.results.map((r) => r.barang_id))
  } catch (error) {
    console.error('afterStockChange gagal:', error)
  }

  return {
    id_transaksi: committed.trx.id_transaksi,
    user_id: committed.trx.user_id,
    jenis_transaksi: committed.trx.jenis_transaksi,
    tanggal_transaksi: committed.trx.tanggal_transaksi,
    keterangan: committed.trx.keterangan,
    items: committed.results,
  }
}

export type TransactionListItem = {
  id_transaksi: number
  user_id: number
  nama_user: string
  jenis_transaksi: 'masuk' | 'keluar'
  tanggal_transaksi: Date
  keterangan: string | null
  items: Array<{
    barang_id: number
    kode_barang: string
    nama_barang: string
    jumlah: number
  }>
}

export type ListTransactionsInput = {
  dari?: string
  sampai?: string
  jenis?: 'masuk' | 'keluar'
  ownerId?: number
  page: number
  limit: number
}

export async function listTransactions(input: ListTransactionsInput) {
  const range = parseDateRange(input.dari, input.sampai)
  const conditions: SQL[] = []
  if (range.from) conditions.push(gte(transactions.tanggal_transaksi, range.from))
  if (range.to) conditions.push(lte(transactions.tanggal_transaksi, range.to))
  if (input.jenis) conditions.push(eq(transactions.jenis_transaksi, input.jenis))
  if (input.ownerId !== undefined) conditions.push(eq(transactions.user_id, input.ownerId))
  const where = conditions.length > 0 ? and(...conditions) : undefined

  const offset = (input.page - 1) * input.limit

  const [rows, countResult] = await Promise.all([
    db
      .select({ trx: transactions, nama_user: users.nama_lengkap })
      .from(transactions)
      .innerJoin(users, eq(transactions.user_id, users.id_user))
      .where(where)
      .orderBy(desc(transactions.tanggal_transaksi), desc(transactions.id_transaksi))
      .limit(input.limit)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(transactions).where(where),
  ])

  const ids = rows.map((row) => row.trx.id_transaksi)
  const detailRows =
    ids.length > 0
      ? await db
          .select({
            transaksi_id: transaction_details.transaksi_id,
            barang_id: transaction_details.barang_id,
            jumlah: transaction_details.jumlah,
            kode_barang: items.kode_barang,
            nama_barang: items.nama_barang,
          })
          .from(transaction_details)
          .innerJoin(items, eq(transaction_details.barang_id, items.id_barang))
          .where(inArray(transaction_details.transaksi_id, ids))
          .orderBy(transaction_details.id_detail_trx)
      : []

  const detailsByTrx = new Map<number, TransactionListItem['items']>()
  for (const detail of detailRows) {
    const list = detailsByTrx.get(detail.transaksi_id) ?? []
    list.push({
      barang_id: detail.barang_id,
      kode_barang: detail.kode_barang,
      nama_barang: detail.nama_barang,
      jumlah: detail.jumlah,
    })
    detailsByTrx.set(detail.transaksi_id, list)
  }

  const data: TransactionListItem[] = rows.map((row) => ({
    id_transaksi: row.trx.id_transaksi,
    user_id: row.trx.user_id,
    nama_user: row.nama_user,
    jenis_transaksi: row.trx.jenis_transaksi,
    tanggal_transaksi: row.trx.tanggal_transaksi,
    keterangan: row.trx.keterangan,
    items: detailsByTrx.get(row.trx.id_transaksi) ?? [],
  }))

  return { data, meta: { page: input.page, limit: input.limit, total: countResult[0]?.total ?? 0 } }
}
