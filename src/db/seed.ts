import { eq } from 'drizzle-orm'
import { db, queryClient } from './index'
import { categories, items, locations, roles, users } from './schema'

const DUMMY_PASSWORD = 'password123'

const ROLES = [
  { nama_role: 'ADMIN', deskripsi: 'Administrator sistem' },
  { nama_role: 'KEPALA_GUDANG', deskripsi: 'Kepala gudang' },
  { nama_role: 'STAF_GUDANG', deskripsi: 'Staf gudang' },
]

const USERS = [
  { role: 'ADMIN', nama_lengkap: 'Admin Gudang', email: 'admin@inventaris.test', no_hp: '0811000001' },
  { role: 'KEPALA_GUDANG', nama_lengkap: 'Kepala Gudang', email: 'kepala@inventaris.test', no_hp: '0811000002' },
  { role: 'STAF_GUDANG', nama_lengkap: 'Staf Gudang', email: 'staf@inventaris.test', no_hp: '0811000003' },
]

const CATEGORIES = [
  { nama_kategori: 'Elektronik', deskripsi: 'Perangkat elektronik' },
  { nama_kategori: 'Alat Tulis', deskripsi: 'Alat tulis kantor' },
  { nama_kategori: 'Kebersihan', deskripsi: 'Peralatan kebersihan' },
]

const LOCATIONS = [
  { nama_rak: 'Rak A1', keterangan: 'Lantai 1 - Elektronik' },
  { nama_rak: 'Rak B1', keterangan: 'Lantai 1 - ATK' },
  { nama_rak: 'Rak C1', keterangan: 'Lantai 2 - Kebersihan' },
]

const ITEMS = [
  { kode_barang: 'ELK-001', nama_barang: 'Laptop ASUS', kategori: 'Elektronik', lokasi: 'Rak A1', stok_saat_ini: 10, batas_stok_minimum: 3 },
  { kode_barang: 'ELK-002', nama_barang: 'Mouse Logitech', kategori: 'Elektronik', lokasi: 'Rak A1', stok_saat_ini: 2, batas_stok_minimum: 5 },
  { kode_barang: 'ELK-003', nama_barang: 'Keyboard Mechanical', kategori: 'Elektronik', lokasi: 'Rak A1', stok_saat_ini: 15, batas_stok_minimum: 5 },
  { kode_barang: 'ELK-004', nama_barang: 'Monitor LED 24 inch', kategori: 'Elektronik', lokasi: 'Rak A1', stok_saat_ini: 0, batas_stok_minimum: 2 },
  { kode_barang: 'ATK-001', nama_barang: 'Pulpen Gel Hitam', kategori: 'Alat Tulis', lokasi: 'Rak B1', stok_saat_ini: 100, batas_stok_minimum: 20 },
  { kode_barang: 'ATK-002', nama_barang: 'Buku Tulis 100 Lembar', kategori: 'Alat Tulis', lokasi: 'Rak B1', stok_saat_ini: 40, batas_stok_minimum: 10 },
  { kode_barang: 'ATK-003', nama_barang: 'Stapler Medium', kategori: 'Alat Tulis', lokasi: 'Rak B1', stok_saat_ini: 8, batas_stok_minimum: 5 },
  { kode_barang: 'KBR-001', nama_barang: 'Sapu Lantai', kategori: 'Kebersihan', lokasi: 'Rak C1', stok_saat_ini: 12, batas_stok_minimum: 5 },
  { kode_barang: 'KBR-002', nama_barang: 'Pembersih Kaca 1L', kategori: 'Kebersihan', lokasi: 'Rak C1', stok_saat_ini: 3, batas_stok_minimum: 6 },
  { kode_barang: 'KBR-003', nama_barang: 'Tempat Sampah', kategori: 'Kebersihan', lokasi: 'Rak C1', stok_saat_ini: 7, batas_stok_minimum: 4 },
]

async function seed() {
  await db.insert(roles).values(ROLES).onConflictDoNothing({ target: roles.nama_role })

  const roleRows = await db.select().from(roles)
  const roleIdByName = new Map(roleRows.map((r) => [r.nama_role, r.id_role]))

  const passwordHash = await Bun.password.hash(DUMMY_PASSWORD)

  for (const u of USERS) {
    const roleId = roleIdByName.get(u.role)
    if (!roleId) throw new Error(`Role ${u.role} tidak ditemukan`)
    await db
      .insert(users)
      .values({
        role_id: roleId,
        nama_lengkap: u.nama_lengkap,
        email: u.email,
        password_hash: passwordHash,
        no_hp: u.no_hp,
      })
      .onConflictDoNothing({ target: users.email })
  }

  await db
    .insert(categories)
    .values(CATEGORIES)
    .onConflictDoNothing({ target: categories.nama_kategori })

  const categoryRows = await db.select().from(categories)
  const categoryIdByName = new Map(categoryRows.map((c) => [c.nama_kategori, c.id_kategori]))

  for (const l of LOCATIONS) {
    const existing = await db.select().from(locations).where(eq(locations.nama_rak, l.nama_rak)).limit(1)
    if (existing.length === 0) {
      await db.insert(locations).values(l)
    }
  }

  const locationRows = await db.select().from(locations)
  const locationIdByName = new Map(locationRows.map((l) => [l.nama_rak, l.id_lokasi]))

  for (const item of ITEMS) {
    const kategoriId = categoryIdByName.get(item.kategori)
    const lokasiId = locationIdByName.get(item.lokasi)
    if (!kategoriId) throw new Error(`Kategori ${item.kategori} tidak ditemukan`)
    if (!lokasiId) throw new Error(`Lokasi ${item.lokasi} tidak ditemukan`)

    await db
      .insert(items)
      .values({
        kategori_id: kategoriId,
        lokasi_id: lokasiId,
        kode_barang: item.kode_barang,
        nama_barang: item.nama_barang,
        stok_saat_ini: item.stok_saat_ini,
        batas_stok_minimum: item.batas_stok_minimum,
      })
      .onConflictDoNothing({ target: items.kode_barang })
  }

  console.log('Seed selesai. Login dummy:', USERS.map((u) => u.email).join(', '), '/ password:', DUMMY_PASSWORD)
}

await seed()
await queryClient.end()
process.exit(0)
