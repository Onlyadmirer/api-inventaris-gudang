// docs/schema.ts -> salin ke backend/src/db/schema.ts
// Sumber: ERD kelompok + keputusan di docs/decisions.md
import {
  pgTable, pgEnum, serial, integer, varchar, text, boolean, timestamp,
  uniqueIndex, index, check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const jenisTransaksiEnum = pgEnum("jenis_transaksi", ["masuk", "keluar"]);
export const jenisPergerakanEnum = pgEnum("jenis_pergerakan", ["masuk", "keluar", "penyesuaian"]);
export const statusOpnameEnum = pgEnum("status_opname", ["draft", "selesai"]);
export const kanalEnum = pgEnum("kanal_notifikasi", ["email", "whatsapp", "push"]);
export const frekuensiEnum = pgEnum("frekuensi_laporan", ["harian", "mingguan", "bulanan"]);
export const statusKirimEnum = pgEnum("status_kirim", ["pending", "terkirim", "gagal"]);

// ---------- Manajemen pengguna ----------
export const roles = pgTable("roles", {
  id_role: serial("id_role").primaryKey(),
  nama_role: varchar("nama_role", { length: 50 }).notNull().unique(), // ADMIN | KEPALA_GUDANG | STAF_GUDANG
  deskripsi: text("deskripsi"),
});

export const users = pgTable("users", {
  id_user: serial("id_user").primaryKey(),
  role_id: integer("role_id").notNull().references(() => roles.id_role),
  nama_lengkap: varchar("nama_lengkap", { length: 150 }).notNull(),
  email: varchar("email", { length: 150 }).notNull().unique(),
  password_hash: text("password_hash").notNull(),
  no_hp: varchar("no_hp", { length: 20 }),
  status_aktif: boolean("status_aktif").notNull().default(true),
  created_at: timestamp("created_at").notNull().defaultNow(),
});

export const user_preferences = pgTable("user_preferences", {
  id_preferensi: serial("id_preferensi").primaryKey(),
  user_id: integer("user_id").notNull().references(() => users.id_user),
  kanal_notifikasi: kanalEnum("kanal_notifikasi").notNull(),
  tujuan: varchar("tujuan", { length: 150 }), // nomor WA / email tujuan (penyesuaian)
  status_aktif: boolean("status_aktif").notNull().default(true),
}, (t) => [uniqueIndex("uq_pref_user_kanal").on(t.user_id, t.kanal_notifikasi)]);

// ---------- Master data ----------
export const categories = pgTable("categories", {
  id_kategori: serial("id_kategori").primaryKey(),
  nama_kategori: varchar("nama_kategori", { length: 100 }).notNull().unique(),
  deskripsi: text("deskripsi"),
});

export const locations = pgTable("locations", {
  id_lokasi: serial("id_lokasi").primaryKey(),
  nama_rak: varchar("nama_rak", { length: 100 }).notNull(),
  keterangan: text("keterangan"),
});

export const items = pgTable("items", {
  id_barang: serial("id_barang").primaryKey(),
  kategori_id: integer("kategori_id").notNull().references(() => categories.id_kategori),
  lokasi_id: integer("lokasi_id").references(() => locations.id_lokasi),
  kode_barang: varchar("kode_barang", { length: 50 }).notNull().unique(), // SKU
  nama_barang: varchar("nama_barang", { length: 200 }).notNull(),
  stok_saat_ini: integer("stok_saat_ini").notNull().default(0),
  batas_stok_minimum: integer("batas_stok_minimum").notNull().default(0),
  qr_code: text("qr_code"), // isi/payload QR (kode_barang); gambar dibuat on-the-fly
  created_at: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_items_nama").on(t.nama_barang),
  check("ck_stok_nonneg", sql`${t.stok_saat_ini} >= 0`),
  check("ck_min_nonneg", sql`${t.batas_stok_minimum} >= 0`),
]);

// ---------- Transaksi ----------
export const transactions = pgTable("transactions", {
  id_transaksi: serial("id_transaksi").primaryKey(),
  user_id: integer("user_id").notNull().references(() => users.id_user),
  jenis_transaksi: jenisTransaksiEnum("jenis_transaksi").notNull(),
  tanggal_transaksi: timestamp("tanggal_transaksi").notNull().defaultNow(),
  keterangan: text("keterangan"),
});

export const transaction_details = pgTable("transaction_details", {
  id_detail_trx: serial("id_detail_trx").primaryKey(),
  transaksi_id: integer("transaksi_id").notNull().references(() => transactions.id_transaksi),
  barang_id: integer("barang_id").notNull().references(() => items.id_barang),
  jumlah: integer("jumlah").notNull(),
}, (t) => [check("ck_jumlah_pos", sql`${t.jumlah} > 0`)]);

// ---------- Stok opname ----------
export const stock_opnames = pgTable("stock_opnames", {
  id_opname: serial("id_opname").primaryKey(),
  user_id: integer("user_id").notNull().references(() => users.id_user),
  tanggal_opname: timestamp("tanggal_opname").notNull().defaultNow(),
  status: statusOpnameEnum("status").notNull().default("draft"),
  keterangan: text("keterangan"),
});

export const stock_opname_details = pgTable("stock_opname_details", {
  id_detail_opname: serial("id_detail_opname").primaryKey(),
  opname_id: integer("opname_id").notNull().references(() => stock_opnames.id_opname),
  barang_id: integer("barang_id").notNull().references(() => items.id_barang),
  stok_sistem: integer("stok_sistem").notNull(),
  stok_fisik: integer("stok_fisik").notNull(),
  selisih: integer("selisih").notNull(), // stok_fisik - stok_sistem
  keterangan: text("keterangan"),
});

// ---------- Histori, audit, konfigurasi ----------
export const stock_movements = pgTable("stock_movements", {
  id_movement: serial("id_movement").primaryKey(),
  barang_id: integer("barang_id").notNull().references(() => items.id_barang),
  user_id: integer("user_id").notNull().references(() => users.id_user),
  transaksi_id: integer("transaksi_id").references(() => transactions.id_transaksi), // nullable
  opname_id: integer("opname_id").references(() => stock_opnames.id_opname),         // nullable
  jenis_pergerakan: jenisPergerakanEnum("jenis_pergerakan").notNull(),
  jumlah: integer("jumlah").notNull(), // untuk penyesuaian boleh negatif
  stok_sebelum: integer("stok_sebelum").notNull(),
  stok_sesudah: integer("stok_sesudah").notNull(),
  created_at: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_mov_barang").on(t.barang_id, t.created_at),
  check("ck_mov_sumber", sql`(${t.transaksi_id} IS NULL) <> (${t.opname_id} IS NULL)`), // tepat salah satu terisi
]);

export const activity_logs = pgTable("activity_logs", {
  id_log: serial("id_log").primaryKey(),
  user_id: integer("user_id").references(() => users.id_user),
  aksi: varchar("aksi", { length: 100 }).notNull(),
  entitas_terkait: varchar("entitas_terkait", { length: 50 }),
  entitas_id: integer("entitas_id"),
  ip_address: varchar("ip_address", { length: 45 }),
  created_at: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("idx_log_created").on(t.created_at)]);

export const report_schedules = pgTable("report_schedules", {
  id_jadwal: serial("id_jadwal").primaryKey(),
  user_id: integer("user_id").notNull().references(() => users.id_user),
  jenis_laporan: varchar("jenis_laporan", { length: 50 }).notNull(), // stok | transaksi | opname
  frekuensi: frekuensiEnum("frekuensi").notNull(),
  waktu_eksekusi: varchar("waktu_eksekusi", { length: 5 }).notNull(), // "HH:mm"
  email_penerima: varchar("email_penerima", { length: 150 }).notNull(),
  status_aktif: boolean("status_aktif").notNull().default(true),
  created_at: timestamp("created_at").notNull().defaultNow(),
});

// Tabel baru (keputusan D6): log + inbox notifikasi in-app
export const notification_logs = pgTable("notification_logs", {
  id_notif: serial("id_notif").primaryKey(),
  user_id: integer("user_id").notNull().references(() => users.id_user), // penerima
  barang_id: integer("barang_id").references(() => items.id_barang),
  kanal: kanalEnum("kanal").notNull(), // in-app dicatat sebagai "push"
  pesan: text("pesan").notNull(),
  status_kirim: statusKirimEnum("status_kirim").notNull().default("pending"),
  sudah_dibaca: boolean("sudah_dibaca").notNull().default(false),
  created_at: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("idx_notif_user").on(t.user_id, t.sudah_dibaca)]);
