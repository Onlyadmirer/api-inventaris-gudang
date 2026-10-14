import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { db } from '../../db'
import {
  categories,
  items,
  locations,
  stock_movements,
  transactions,
  users,
} from '../../db/schema'

type ItemRow = typeof items.$inferSelect
type CategoryRow = typeof categories.$inferSelect
type LocationRow = typeof locations.$inferSelect
type MovementRow = typeof stock_movements.$inferSelect
type UserRow = typeof users.$inferSelect

export type CriticalItem = {
  id_barang: number
  kode_barang: string
  nama_barang: string
  kategori: string
  lokasi: string | null
  stok_saat_ini: number
  batas_stok_minimum: number
  kekurangan: number
}

export type GraphPoint = {
  tanggal: string
  total_masuk: number
  total_keluar: number
}

export type RecentMovement = {
  id_movement: number
  barang_id: number
  kode_barang: string
  nama_barang: string
  user_id: number
  nama_user: string
  jenis_pergerakan: 'masuk' | 'keluar' | 'penyesuaian'
  jumlah: number
  stok_sebelum: number
  stok_sesudah: number
  created_at: Date
}

export type DashboardResponse = {
  total_barang: number
  total_stok: number
  transaksi_masuk_hari_ini: number
  transaksi_keluar_hari_ini: number
  jumlah_barang_kritis: number
  barang_kritis: CriticalItem[]
  grafik_transaksi: GraphPoint[]
  pergerakan_terakhir: RecentMovement[]
}

type GraphRow = {
  tanggal: string
  total_masuk: number
  total_keluar: number
}

function toCriticalItem(item: ItemRow, kategori: CategoryRow, lokasi: LocationRow | null): CriticalItem {
  return {
    id_barang: item.id_barang,
    kode_barang: item.kode_barang,
    nama_barang: item.nama_barang,
    kategori: kategori.nama_kategori,
    lokasi: lokasi ? lokasi.nama_rak : null,
    stok_saat_ini: item.stok_saat_ini,
    batas_stok_minimum: item.batas_stok_minimum,
    kekurangan: item.batas_stok_minimum - item.stok_saat_ini,
  }
}

function toRecentMovement(
  movement: MovementRow,
  item: ItemRow,
  user: UserRow,
): RecentMovement {
  return {
    id_movement: movement.id_movement,
    barang_id: movement.barang_id,
    kode_barang: item.kode_barang,
    nama_barang: item.nama_barang,
    user_id: movement.user_id,
    nama_user: user.nama_lengkap,
    jenis_pergerakan: movement.jenis_pergerakan,
    jumlah: movement.jumlah,
    stok_sebelum: movement.stok_sebelum,
    stok_sesudah: movement.stok_sesudah,
    created_at: movement.created_at,
  }
}

export async function getDashboard(hari: number): Promise<DashboardResponse> {
  const days = Math.min(Math.max(hari, 1), 90)
  const criticalCondition = sql`${items.stok_saat_ini} <= ${items.batas_stok_minimum}`

  const [
    totalBarangRows,
    totalStokRows,
    masukRows,
    keluarRows,
    criticalCountRows,
    criticalRows,
    graphRows,
    movementRows,
  ] = await Promise.all([
    db.select({ total: sql<number>`count(*)::int` }).from(items),
    db.select({ total: sql<number>`coalesce(sum(${items.stok_saat_ini}), 0)::int` }).from(items),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(transactions)
      .where(
        and(
          eq(transactions.jenis_transaksi, 'masuk'),
          sql`${transactions.tanggal_transaksi} >= date_trunc('day', now())`,
        ),
      ),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(transactions)
      .where(
        and(
          eq(transactions.jenis_transaksi, 'keluar'),
          sql`${transactions.tanggal_transaksi} >= date_trunc('day', now())`,
        ),
      ),
    db.select({ total: sql<number>`count(*)::int` }).from(items).where(criticalCondition),
    db
      .select({ item: items, kategori: categories, lokasi: locations })
      .from(items)
      .innerJoin(categories, eq(items.kategori_id, categories.id_kategori))
      .leftJoin(locations, eq(items.lokasi_id, locations.id_lokasi))
      .where(criticalCondition)
      .orderBy(asc(items.stok_saat_ini), asc(items.nama_barang)),
    db.execute<GraphRow>(sql`
      SELECT to_char(d, 'YYYY-MM-DD') AS tanggal,
             COALESCE(SUM(CASE WHEN t.jenis_transaksi = 'masuk' THEN td.jumlah ELSE 0 END), 0)::int AS total_masuk,
             COALESCE(SUM(CASE WHEN t.jenis_transaksi = 'keluar' THEN td.jumlah ELSE 0 END), 0)::int AS total_keluar
      FROM generate_series(
             date_trunc('day', now()) - (${days}::int - 1) * interval '1 day',
             date_trunc('day', now()),
             interval '1 day'
           ) AS d
      LEFT JOIN transactions t ON date_trunc('day', t.tanggal_transaksi) = d
      LEFT JOIN transaction_details td ON td.transaksi_id = t.id_transaksi
      GROUP BY d
      ORDER BY d
    `),
    db
      .select({ movement: stock_movements, item: items, user: users })
      .from(stock_movements)
      .innerJoin(items, eq(stock_movements.barang_id, items.id_barang))
      .innerJoin(users, eq(stock_movements.user_id, users.id_user))
      .orderBy(desc(stock_movements.created_at), desc(stock_movements.id_movement))
      .limit(5),
  ])

  return {
    total_barang: totalBarangRows[0]?.total ?? 0,
    total_stok: totalStokRows[0]?.total ?? 0,
    transaksi_masuk_hari_ini: masukRows[0]?.total ?? 0,
    transaksi_keluar_hari_ini: keluarRows[0]?.total ?? 0,
    jumlah_barang_kritis: criticalCountRows[0]?.total ?? 0,
    barang_kritis: criticalRows.map((row) => toCriticalItem(row.item, row.kategori, row.lokasi)),
    grafik_transaksi: graphRows.map((row) => ({
      tanggal: row.tanggal,
      total_masuk: Number(row.total_masuk),
      total_keluar: Number(row.total_keluar),
    })),
    pergerakan_terakhir: movementRows.map((row) =>
      toRecentMovement(row.movement, row.item, row.user),
    ),
  }
}
