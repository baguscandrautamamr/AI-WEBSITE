/**
 * Dua bahasa aplikasi ini, sebagai satu tipe yang dipakai kedua sisi.
 *
 * Ada berkas tersendiri karena `lib/i18n.tsx` adalah komponen klien: ia memuat
 * React dan kedua kamus pesan sekaligus. Route handler hanya butuh tahu bahwa
 * bahasanya "id" atau "en" — bukan seluruh isi kamusnya — dan sebuah tipe yang
 * ikut menyeret React ke bundel server adalah harga yang tidak perlu dibayar.
 */
export type Locale = "id" | "en";

/**
 * Bahasa bawaan.
 *
 * Indonesia, bukan Inggris: penggunanya tim MEP di Indonesia, dan render
 * pertama di server memang memakai ini sebelum pilihan tersimpan terbaca.
 */
export const DEFAULT_LOCALE: Locale = "id";

/**
 * Bahasa dari sesuatu yang datang dari luar.
 *
 * Dipakai di route handler, dan karena itu ia tidak boleh percaya apa pun:
 * yang mengirim `language` adalah body JSON, dan body JSON bisa berisi apa
 * saja. Yang tidak dikenali jatuh ke bahasa bawaan, bukan menolak permintaan —
 * bahasa yang salah eja seharusnya tidak membuat pertanyaan gagal dijawab.
 */
export function asLocale(value: unknown): Locale {
  return value === "en" || value === "id" ? value : DEFAULT_LOCALE;
}
