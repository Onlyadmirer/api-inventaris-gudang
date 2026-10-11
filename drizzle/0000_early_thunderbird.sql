CREATE TYPE "public"."frekuensi_laporan" AS ENUM('harian', 'mingguan', 'bulanan');--> statement-breakpoint
CREATE TYPE "public"."jenis_pergerakan" AS ENUM('masuk', 'keluar', 'penyesuaian');--> statement-breakpoint
CREATE TYPE "public"."jenis_transaksi" AS ENUM('masuk', 'keluar');--> statement-breakpoint
CREATE TYPE "public"."kanal_notifikasi" AS ENUM('email', 'whatsapp', 'push');--> statement-breakpoint
CREATE TYPE "public"."status_kirim" AS ENUM('pending', 'terkirim', 'gagal');--> statement-breakpoint
CREATE TYPE "public"."status_opname" AS ENUM('draft', 'selesai');--> statement-breakpoint
CREATE TABLE "activity_logs" (
	"id_log" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"aksi" varchar(100) NOT NULL,
	"entitas_terkait" varchar(50),
	"entitas_id" integer,
	"ip_address" varchar(45),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id_kategori" serial PRIMARY KEY NOT NULL,
	"nama_kategori" varchar(100) NOT NULL,
	"deskripsi" text,
	CONSTRAINT "categories_nama_kategori_unique" UNIQUE("nama_kategori")
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id_barang" serial PRIMARY KEY NOT NULL,
	"kategori_id" integer NOT NULL,
	"lokasi_id" integer,
	"kode_barang" varchar(50) NOT NULL,
	"nama_barang" varchar(200) NOT NULL,
	"stok_saat_ini" integer DEFAULT 0 NOT NULL,
	"batas_stok_minimum" integer DEFAULT 0 NOT NULL,
	"qr_code" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "items_kode_barang_unique" UNIQUE("kode_barang"),
	CONSTRAINT "ck_stok_nonneg" CHECK ("items"."stok_saat_ini" >= 0),
	CONSTRAINT "ck_min_nonneg" CHECK ("items"."batas_stok_minimum" >= 0)
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id_lokasi" serial PRIMARY KEY NOT NULL,
	"nama_rak" varchar(100) NOT NULL,
	"keterangan" text
);
--> statement-breakpoint
CREATE TABLE "notification_logs" (
	"id_notif" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"barang_id" integer,
	"kanal" "kanal_notifikasi" NOT NULL,
	"pesan" text NOT NULL,
	"status_kirim" "status_kirim" DEFAULT 'pending' NOT NULL,
	"sudah_dibaca" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_schedules" (
	"id_jadwal" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"jenis_laporan" varchar(50) NOT NULL,
	"frekuensi" "frekuensi_laporan" NOT NULL,
	"waktu_eksekusi" varchar(5) NOT NULL,
	"email_penerima" varchar(150) NOT NULL,
	"status_aktif" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id_role" serial PRIMARY KEY NOT NULL,
	"nama_role" varchar(50) NOT NULL,
	"deskripsi" text,
	CONSTRAINT "roles_nama_role_unique" UNIQUE("nama_role")
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id_movement" serial PRIMARY KEY NOT NULL,
	"barang_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"transaksi_id" integer,
	"opname_id" integer,
	"jenis_pergerakan" "jenis_pergerakan" NOT NULL,
	"jumlah" integer NOT NULL,
	"stok_sebelum" integer NOT NULL,
	"stok_sesudah" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ck_mov_sumber" CHECK (("stock_movements"."transaksi_id" IS NULL) <> ("stock_movements"."opname_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "stock_opname_details" (
	"id_detail_opname" serial PRIMARY KEY NOT NULL,
	"opname_id" integer NOT NULL,
	"barang_id" integer NOT NULL,
	"stok_sistem" integer NOT NULL,
	"stok_fisik" integer NOT NULL,
	"selisih" integer NOT NULL,
	"keterangan" text
);
--> statement-breakpoint
CREATE TABLE "stock_opnames" (
	"id_opname" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"tanggal_opname" timestamp DEFAULT now() NOT NULL,
	"status" "status_opname" DEFAULT 'draft' NOT NULL,
	"keterangan" text
);
--> statement-breakpoint
CREATE TABLE "transaction_details" (
	"id_detail_trx" serial PRIMARY KEY NOT NULL,
	"transaksi_id" integer NOT NULL,
	"barang_id" integer NOT NULL,
	"jumlah" integer NOT NULL,
	CONSTRAINT "ck_jumlah_pos" CHECK ("transaction_details"."jumlah" > 0)
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id_transaksi" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"jenis_transaksi" "jenis_transaksi" NOT NULL,
	"tanggal_transaksi" timestamp DEFAULT now() NOT NULL,
	"keterangan" text
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"id_preferensi" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"kanal_notifikasi" "kanal_notifikasi" NOT NULL,
	"tujuan" varchar(150),
	"status_aktif" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id_user" serial PRIMARY KEY NOT NULL,
	"role_id" integer NOT NULL,
	"nama_lengkap" varchar(150) NOT NULL,
	"email" varchar(150) NOT NULL,
	"password_hash" text NOT NULL,
	"no_hp" varchar(20),
	"status_aktif" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_users_id_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id_user") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_kategori_id_categories_id_kategori_fk" FOREIGN KEY ("kategori_id") REFERENCES "public"."categories"("id_kategori") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_lokasi_id_locations_id_lokasi_fk" FOREIGN KEY ("lokasi_id") REFERENCES "public"."locations"("id_lokasi") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_user_id_users_id_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id_user") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_barang_id_items_id_barang_fk" FOREIGN KEY ("barang_id") REFERENCES "public"."items"("id_barang") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_user_id_users_id_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id_user") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_barang_id_items_id_barang_fk" FOREIGN KEY ("barang_id") REFERENCES "public"."items"("id_barang") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_user_id_users_id_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id_user") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_transaksi_id_transactions_id_transaksi_fk" FOREIGN KEY ("transaksi_id") REFERENCES "public"."transactions"("id_transaksi") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_opname_id_stock_opnames_id_opname_fk" FOREIGN KEY ("opname_id") REFERENCES "public"."stock_opnames"("id_opname") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opname_details" ADD CONSTRAINT "stock_opname_details_opname_id_stock_opnames_id_opname_fk" FOREIGN KEY ("opname_id") REFERENCES "public"."stock_opnames"("id_opname") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opname_details" ADD CONSTRAINT "stock_opname_details_barang_id_items_id_barang_fk" FOREIGN KEY ("barang_id") REFERENCES "public"."items"("id_barang") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opnames" ADD CONSTRAINT "stock_opnames_user_id_users_id_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id_user") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_details" ADD CONSTRAINT "transaction_details_transaksi_id_transactions_id_transaksi_fk" FOREIGN KEY ("transaksi_id") REFERENCES "public"."transactions"("id_transaksi") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_details" ADD CONSTRAINT "transaction_details_barang_id_items_id_barang_fk" FOREIGN KEY ("barang_id") REFERENCES "public"."items"("id_barang") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id_user") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id_user") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_role_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id_role") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_log_created" ON "activity_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_items_nama" ON "items" USING btree ("nama_barang");--> statement-breakpoint
CREATE INDEX "idx_notif_user" ON "notification_logs" USING btree ("user_id","sudah_dibaca");--> statement-breakpoint
CREATE INDEX "idx_mov_barang" ON "stock_movements" USING btree ("barang_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_pref_user_kanal" ON "user_preferences" USING btree ("user_id","kanal_notifikasi");