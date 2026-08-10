/**
 * Menautkan akun website ke sebuah chat Telegram.
 *
 * Yang ditautkan adalah nomor user Telegram — angka, bukan @username. Username
 * bisa diubah dan dilepas pemiliknya lalu diambil orang lain; nomor tidak
 * pernah berubah dan tidak bisa berpindah tangan. Itu sebabnya kolom di
 * database bernama `telegram_user_id` dan bertipe bigint, dan itu juga yang
 * membuat penautan ini bertahan meski orangnya mengganti nama.
 *
 * Cara menemukan nomornya: kirim /start ke bot ini — jawabannya menyebut nomor
 * Anda — atau tanya @userinfobot.
 */

/**
 * Batas yang masih pasti aman dibawa sebagai number di JavaScript.
 *
 * Nomor Telegram hari ini berkisar 9-10 digit dan menurut dokumentasi mereka
 * bisa tumbuh sampai 52 bit; Number.MAX_SAFE_INTEGER adalah 53 bit, jadi
 * seluruh rentang yang sah lewat di sini tanpa kehilangan presisi. Yang ditolak
 * batas ini adalah ketikan yang panjangnya sudah tidak mungkin benar.
 */
const MAX = Number.MAX_SAFE_INTEGER;

/**
 * Nomor chat dari apa pun yang diketik orang, atau null kalau bukan nomor.
 *
 * Sengaja memaafkan bentuk tempelan yang wajar — spasi di ujung, tanda kurung
 * dari sebuah tangkapan layar, "ID: 123456789" yang disalin utuh — karena
 * nomor ini selalu datang dari menyalin sesuatu, dan sebuah galat "bukan angka"
 * atas teks yang jelas berisi angkanya hanya menyuruh orang membersihkannya
 * sendiri.
 *
 * Yang TIDAK dimaafkan: dua angka dalam satu ketikan. "123 456" bisa berarti
 * satu nomor yang terpotong atau dua nomor yang tertempel, dan menebak salah
 * satu berarti mengirim hasil pekerjaan seseorang ke chat yang salah.
 */
export function parseChatId(input: string): number | null {
  const digits = input.replace(/[^\d-]/g, " ").trim();
  if (!digits) return null;

  const parts = digits.split(/\s+/);
  if (parts.length !== 1) return null;

  // Chat grup ber-nomor negatif. Yang ditautkan di sini adalah chat pribadi
  // dengan bot, jadi nomor negatif bukan sekadar tidak didukung — ia berarti
  // yang disalin bukan nomor orangnya.
  if (!/^\d+$/.test(parts[0])) return null;

  const value = Number(parts[0]);
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX) return null;

  return value;
}
