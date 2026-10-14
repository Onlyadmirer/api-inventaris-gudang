// Hook notifikasi setelah stok berubah (UC-17).
// Implementasi nyata ada di modules/notifications/service (B7).
// Kegagalan di sini TIDAK BOLEH menggagalkan transaksi stok.
export { afterStockChange } from '../modules/notifications/service'
