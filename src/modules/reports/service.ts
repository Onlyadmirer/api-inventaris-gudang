import { and, asc, desc, eq, gte, lte, type SQL } from 'drizzle-orm'
import { db } from '../../db'
import {
  categories,
  items,
  locations,
  stock_opname_details,
  stock_opnames,
  transaction_details,
  transactions,
  users,
} from '../../db/schema'
import { parseDateRange, type DateRange } from '../../lib/date-range'
import { buildPdf, buildXlsx, type ExportColumn, type ExportRow } from '../../lib/export'

export type ReportJenis = 'stok' | 'transaksi' | 'opname'
export type ReportFormat = 'pdf' | 'xlsx'

export type ReportFilter = {
  dari?: string
  sampai?: string
  kategori_id?: number
}

export type StokReportRow = {
  id_barang: number
  kode_barang: string
  nama_barang: string
  kategori: string
  lokasi: string | null
  stok_saat_ini: number
  batas_stok_minimum: number
  status: 'kritis' | 'aman'
}

export type TransaksiReportItem = {
  id_transaksi: number
  tanggal_transaksi: Date
  jenis_transaksi: 'masuk' | 'keluar'
  nama_user: string
  keterangan: string | null
  items: Array<{ barang_id: number; kode_barang: string; nama_barang: string; jumlah: number }>
}

export type OpnameReportItem = {
  id_opname: number
  tanggal_opname: Date
  nama_user: string
  status: 'draft' | 'selesai'
  keterangan: string | null
  items: Array<{
    barang_id: number
    kode_barang: string
    nama_barang: string
    stok_sistem: number
    stok_fisik: number
    selisih: number
  }>
}

async function buildStokReport(filter: ReportFilter) {
  const conditions: SQL[] = []
  if (filter.kategori_id !== undefined) conditions.push(eq(items.kategori_id, filter.kategori_id))

  const rows = await db
    .select({ item: items, kategori: categories, lokasi: locations })
    .from(items)
    .innerJoin(categories, eq(items.kategori_id, categories.id_kategori))
    .leftJoin(locations, eq(items.lokasi_id, locations.id_lokasi))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(items.nama_barang))

  const data: StokReportRow[] = rows.map((row) => ({
    id_barang: row.item.id_barang,
    kode_barang: row.item.kode_barang,
    nama_barang: row.item.nama_barang,
    kategori: row.kategori.nama_kategori,
    lokasi: row.lokasi ? row.lokasi.nama_rak : null,
    stok_saat_ini: row.item.stok_saat_ini,
    batas_stok_minimum: row.item.batas_stok_minimum,
    status: row.item.stok_saat_ini <= row.item.batas_stok_minimum ? 'kritis' : 'aman',
  }))

  return {
    data,
    ringkasan: {
      total_item: data.length,
      total_stok: data.reduce((total, row) => total + row.stok_saat_ini, 0),
      jumlah_kritis: data.filter((row) => row.status === 'kritis').length,
    },
  }
}

async function buildTransaksiReport(filter: ReportFilter, range: DateRange) {
  const conditions: SQL[] = []
  if (range.from) conditions.push(gte(transactions.tanggal_transaksi, range.from))
  if (range.to) conditions.push(lte(transactions.tanggal_transaksi, range.to))
  if (filter.kategori_id !== undefined) conditions.push(eq(items.kategori_id, filter.kategori_id))

  const rows = await db
    .select({ trx: transactions, user: users, detail: transaction_details, item: items })
    .from(transactions)
    .innerJoin(users, eq(transactions.user_id, users.id_user))
    .innerJoin(transaction_details, eq(transaction_details.transaksi_id, transactions.id_transaksi))
    .innerJoin(items, eq(transaction_details.barang_id, items.id_barang))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(transactions.tanggal_transaksi), asc(transaction_details.id_detail_trx))

  const map = new Map<number, TransaksiReportItem>()
  for (const row of rows) {
    let entry = map.get(row.trx.id_transaksi)
    if (!entry) {
      entry = {
        id_transaksi: row.trx.id_transaksi,
        tanggal_transaksi: row.trx.tanggal_transaksi,
        jenis_transaksi: row.trx.jenis_transaksi,
        nama_user: row.user.nama_lengkap,
        keterangan: row.trx.keterangan,
        items: [],
      }
      map.set(row.trx.id_transaksi, entry)
    }
    entry.items.push({
      barang_id: row.detail.barang_id,
      kode_barang: row.item.kode_barang,
      nama_barang: row.item.nama_barang,
      jumlah: row.detail.jumlah,
    })
  }

  const data = [...map.values()]
  const sumItems = (predicate: (entry: TransaksiReportItem) => boolean) =>
    data
      .filter(predicate)
      .reduce((total, entry) => total + entry.items.reduce((acc, item) => acc + item.jumlah, 0), 0)

  return {
    data,
    ringkasan: {
      total_transaksi: data.length,
      total_masuk: sumItems((entry) => entry.jenis_transaksi === 'masuk'),
      total_keluar: sumItems((entry) => entry.jenis_transaksi === 'keluar'),
    },
  }
}

async function buildOpnameReport(filter: ReportFilter, range: DateRange) {
  const conditions: SQL[] = []
  if (range.from) conditions.push(gte(stock_opnames.tanggal_opname, range.from))
  if (range.to) conditions.push(lte(stock_opnames.tanggal_opname, range.to))
  if (filter.kategori_id !== undefined) conditions.push(eq(items.kategori_id, filter.kategori_id))

  const rows = await db
    .select({ opname: stock_opnames, user: users, detail: stock_opname_details, item: items })
    .from(stock_opnames)
    .innerJoin(users, eq(stock_opnames.user_id, users.id_user))
    .leftJoin(stock_opname_details, eq(stock_opname_details.opname_id, stock_opnames.id_opname))
    .leftJoin(items, eq(stock_opname_details.barang_id, items.id_barang))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(stock_opnames.tanggal_opname), asc(stock_opname_details.id_detail_opname))

  const map = new Map<number, OpnameReportItem>()
  for (const row of rows) {
    let entry = map.get(row.opname.id_opname)
    if (!entry) {
      entry = {
        id_opname: row.opname.id_opname,
        tanggal_opname: row.opname.tanggal_opname,
        nama_user: row.user.nama_lengkap,
        status: row.opname.status,
        keterangan: row.opname.keterangan,
        items: [],
      }
      map.set(row.opname.id_opname, entry)
    }
    if (row.detail && row.item) {
      entry.items.push({
        barang_id: row.detail.barang_id,
        kode_barang: row.item.kode_barang,
        nama_barang: row.item.nama_barang,
        stok_sistem: row.detail.stok_sistem,
        stok_fisik: row.detail.stok_fisik,
        selisih: row.detail.selisih,
      })
    }
  }

  const data = [...map.values()]
  return {
    data,
    ringkasan: {
      total_sesi: data.length,
      total_item_dihitung: data.reduce((total, entry) => total + entry.items.length, 0),
      total_selisih: data.reduce(
        (total, entry) => total + entry.items.filter((item) => item.selisih !== 0).length,
        0,
      ),
    },
  }
}

export type ReportResponse = {
  jenis: ReportJenis
  dari: string | null
  sampai: string | null
  kategori_id: number | null
  data: unknown[]
  ringkasan: Record<string, number>
}

export async function getReport(jenis: ReportJenis, filter: ReportFilter): Promise<ReportResponse> {
  const range = parseDateRange(filter.dari, filter.sampai)
  const base = {
    jenis,
    dari: filter.dari ?? null,
    sampai: filter.sampai ?? null,
    kategori_id: filter.kategori_id ?? null,
  }

  if (jenis === 'stok') return { ...base, ...(await buildStokReport(filter)) }
  if (jenis === 'transaksi') return { ...base, ...(await buildTransaksiReport(filter, range)) }
  return { ...base, ...(await buildOpnameReport(filter, range)) }
}

function formatDateTime(value: Date): string {
  const date = new Date(value)
  const pad = (num: number) => String(num).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function fileStamp(): string {
  return formatDateTime(new Date()).slice(0, 10).replace(/-/g, '')
}

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export type ExportResult = {
  buffer: Buffer
  contentType: string
  filename: string
}

export async function exportReport(
  jenis: ReportJenis,
  format: ReportFormat,
  filter: ReportFilter,
): Promise<ExportResult> {
  const range = parseDateRange(filter.dari, filter.sampai)

  let title: string
  let columns: ExportColumn[]
  let rows: ExportRow[]

  if (jenis === 'stok') {
    const { data } = await buildStokReport(filter)
    title = 'Laporan Stok Barang'
    columns = [
      { header: 'Kode', key: 'kode_barang', width: 14 },
      { header: 'Nama Barang', key: 'nama_barang', width: 30 },
      { header: 'Kategori', key: 'kategori', width: 16 },
      { header: 'Lokasi', key: 'lokasi', width: 14 },
      { header: 'Stok', key: 'stok_saat_ini', width: 8 },
      { header: 'Batas Min', key: 'batas_stok_minimum', width: 10 },
      { header: 'Status', key: 'status', width: 10 },
    ]
    rows = data
  } else if (jenis === 'transaksi') {
    const { data } = await buildTransaksiReport(filter, range)
    title = 'Laporan Transaksi'
    columns = [
      { header: 'ID', key: 'id_transaksi', width: 8 },
      { header: 'Tanggal', key: 'tanggal', width: 18 },
      { header: 'Jenis', key: 'jenis', width: 10 },
      { header: 'User', key: 'nama_user', width: 16 },
      { header: 'Kode', key: 'kode_barang', width: 14 },
      { header: 'Nama Barang', key: 'nama_barang', width: 26 },
      { header: 'Jumlah', key: 'jumlah', width: 8 },
      { header: 'Keterangan', key: 'keterangan', width: 22 },
    ]
    rows = data.flatMap((entry): ExportRow[] =>
      entry.items.map((item) => ({
        id_transaksi: entry.id_transaksi,
        tanggal: formatDateTime(entry.tanggal_transaksi),
        jenis: entry.jenis_transaksi,
        nama_user: entry.nama_user,
        kode_barang: item.kode_barang,
        nama_barang: item.nama_barang,
        jumlah: item.jumlah,
        keterangan: entry.keterangan ?? '',
      })),
    )
  } else {
    const { data } = await buildOpnameReport(filter, range)
    title = 'Laporan Stok Opname'
    columns = [
      { header: 'ID', key: 'id_opname', width: 8 },
      { header: 'Tanggal', key: 'tanggal', width: 18 },
      { header: 'User', key: 'nama_user', width: 16 },
      { header: 'Status', key: 'status', width: 10 },
      { header: 'Kode', key: 'kode_barang', width: 14 },
      { header: 'Nama Barang', key: 'nama_barang', width: 26 },
      { header: 'Sistem', key: 'stok_sistem', width: 8 },
      { header: 'Fisik', key: 'stok_fisik', width: 8 },
      { header: 'Selisih', key: 'selisih', width: 8 },
    ]
    rows = data.flatMap((entry): ExportRow[] => {
      if (entry.items.length === 0) {
        return [
          {
            id_opname: entry.id_opname,
            tanggal: formatDateTime(entry.tanggal_opname),
            nama_user: entry.nama_user,
            status: entry.status,
            kode_barang: '-',
            nama_barang: '-',
            stok_sistem: '',
            stok_fisik: '',
            selisih: '',
          },
        ]
      }
      return entry.items.map((item) => ({
        id_opname: entry.id_opname,
        tanggal: formatDateTime(entry.tanggal_opname),
        nama_user: entry.nama_user,
        status: entry.status,
        kode_barang: item.kode_barang,
        nama_barang: item.nama_barang,
        stok_sistem: item.stok_sistem,
        stok_fisik: item.stok_fisik,
        selisih: item.selisih,
      }))
    })
  }

  const buffer = format === 'xlsx' ? await buildXlsx(title, columns, rows) : await buildPdf(title, columns, rows)

  return {
    buffer,
    contentType: format === 'xlsx' ? XLSX_CONTENT_TYPE : 'application/pdf',
    filename: `laporan-${jenis}-${fileStamp()}.${format}`,
  }
}
