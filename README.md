# Sistem Kelola Gudang — Backend

Backend REST API untuk Sistem Kelola Gudang (inventaris + QR Code).

- Runtime: **Bun**
- Framework: **ElysiaJS** (TypeScript)
- ORM: **Drizzle ORM** + **PostgreSQL**
- Auth: **JWT** (`@elysiajs/jwt`) + `Bun.password`
- QR: `qrcode` · Ekspor: `exceljs`, `pdfkit` · Email: `nodemailer` · Cron: `croner`

## Prasyarat

- [Bun](https://bun.sh) v1.3+
- PostgreSQL 14+ (database `inventaris_gudang`)

## Setup

```bash
cd backend
bun install
cp .env.example .env
```

Isi `.env`:

```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/inventaris_gudang
JWT_SECRET=ubah-secret-ini
PORT=3000

# SMTP (opsional; fitur email notifikasi & jadwal laporan)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
```

Lalu siapkan database:

```bash
bun run db:migrate   # terapkan skema
bun run db:seed      # data awal (role, user, kategori, lokasi, barang)
```

## Menjalankan

```bash
bun run dev          # mode watch
bun run start        # produksi
```

Server: `http://localhost:3000` · API prefix `/api` · OpenAPI UI: `http://localhost:3000/api/openapi` (spec JSON: `/api/openapi/json`)

## Script

| Script | Fungsi |
|---|---|
| `bun run dev` | Jalankan dengan watch |
| `bun run start` | Jalankan sekali |
| `bun test` | Jalankan semua test |
| `bun run typecheck` | Cek TypeScript (`tsc --noEmit`) |
| `bun run db:generate` | Generate file migrasi dari schema |
| `bun run db:migrate` | Terapkan migrasi |
| `bun run db:push` | Push schema langsung (dev) |
| `bun run db:seed` | Seed data awal |
| `bun run db:studio` | Drizzle Studio |

## Akun seed

Password semua akun: `password123`

| Role | Email |
|---|---|
| ADMIN | `admin@inventaris.test` |
| KEPALA_GUDANG | `kepala@inventaris.test` |
| STAF_GUDANG | `staf@inventaris.test` |

## Autentikasi

- `POST /api/auth/login` → `{ token, user }` (login pakai **email** + password).
- Kirim `Authorization: Bearer <token>` pada semua endpoint lain.
- Role dicek di server (`ADMIN`, `KEPALA_GUDANG`, `STAF_GUDANG`).

## Ringkasan endpoint

Semua endpoint ber-prefix `/api`. Detail lengkap ada di `docs/api-spec.md` dan OpenAPI (`/api/openapi`).

| Modul | Endpoint utama | Role |
|---|---|---|
| Auth | `POST /auth/login`, `GET /auth/me` | publik / semua |
| Users | `GET/POST /users`, `PATCH /users/:id`, `PATCH /users/:id/status` | ADMIN |
| Categories / Locations | CRUD | GET semua, mutasi A |
| Items | `GET /items`, `GET /items/:id`, `GET /items/by-code/:kode`, CRUD, `PATCH /items/:id/min-stock`, `GET /items/:id/qr`, `POST /items/qr/batch` | lihat api-spec |
| Transactions | `POST /transactions/masuk`, `POST /transactions/keluar`, `GET /transactions` | S (POST); A,K,S (GET, staf milik sendiri) |
| Opnames | `POST/GET /opnames`, `GET /opnames/:id`, `POST /opnames/:id/details`, `POST /opnames/:id/finalize` | K,S (finalize: K) |
| Dashboard | `GET /dashboard` | A,K |
| Reports | `GET /reports/:jenis`, `GET /reports/:jenis/export?format=pdf\|xlsx` | A,K |
| Preferences | `GET/PUT /preferences` | K |
| Notifications | `GET /notifications`, `PATCH /notifications/:id/read`, `PATCH /notifications/read-all` | A,K |
| Schedules | `GET/POST /schedules`, `PATCH/DELETE /schedules/:id` | A |
| Audit | `GET /audit-logs`, `GET /notification-logs` | A |

Paginasi standar: `?page=1&limit=20` → `{ data: [], meta: { page, limit, total } }`.

Format error: `{ "message": string, "errors"?: [] }`.

## Notifikasi & penjadwalan

- **UC-17**: setiap perubahan stok yang membuat `stok_saat_ini <= batas_stok_minimum` memicu notifikasi in-app (kanal `push`) untuk semua user aktif role `KEPALA_GUDANG` dan `ADMIN`; email dikirim bila preferensi email aktif. Kegagalan pengiriman **tidak** menggagalkan transaksi stok.
- **UC-06**: jadwal laporan (`croner`) dimuat ulang otomatis saat server start; job membangun laporan xlsx lalu mengirimnya via SMTP dan mencatat hasil ke `notification_logs` + `activity_logs`.
  - harian → `MM HH * * *` · mingguan → `MM HH * * 1` (Senin) · bulanan → `MM HH 1 * *` (tanggal 1).
  - Periode data: harian = hari kemarin, mingguan = 7 hari terakhir, bulanan = bulan lalu.

## Struktur

```
src/
  index.ts              # app Elysia + mount semua module
  db/                   # schema, koneksi, migrate, seed
  plugins/              # auth (jwt + guard), error, audit
  lib/                  # mailer, qr, export, date-range, notification-hook
  modules/<nama>/       # routes.ts, service.ts, model.ts
```

## Catatan

- Nama tabel/kolom mengikuti `docs/schema.ts` (bahasa Indonesia, snake_case).
- Akun tidak dihapus, hanya dinonaktifkan (`status_aktif=false`).
- `batas_stok_minimum` hanya diubah lewat `PATCH /items/:id/min-stock` (Admin).
