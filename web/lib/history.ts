/**
 * Riwayat percakapan yang dikirim ulang ke model, dan yang harus dibuang darinya.
 *
 * Terpisah dari route-nya supaya bisa diuji. Yang di sini bukan detail: satu
 * kalimat yang salah di dalamnya pernah membuat asisten berhenti menggambar
 * sama sekali, dan itu bukan hal yang pantas hanya dijaga oleh kehati-hatian.
 */

/**
 * Penanda pengganti diagram di dalam riwayat.
 *
 * Dulu ia berbunyi "[diagram]", dan itu bug — bukan kosmetik. Riwayat dikirim
 * ulang sebagai giliran ASISTEN, jadi yang dibaca model adalah contoh jawaban
 * yang pernah ia tulis sendiri. Setelah satu diagram dibuat, riwayatnya berbunyi
 * "Diagram Satu Garis" lalu "[diagram]" — dan ketika diminta menggambar lagi,
 * model menirunya persis: sebuah judul, lalu tulisan [diagram], tanpa gambar
 * apa pun. Ia belajar dari contoh, dan contoh itu kami sendiri yang menaruh di
 * sana.
 *
 * Yang menyembuhkan bukan kalimatnya lebih sopan, melainkan bentuknya tidak
 * bisa ditiru: ini kalimat keterangan, bukan penanda ringkas yang masuk akal
 * ditulis sebagai jawaban.
 */
export const REDACTED =
  "(catatan sistem: gambar pada jawaban ini sudah tampil di layar pengguna dan dihilangkan dari riwayat untuk menghemat token)";

/**
 * Jawaban asisten tanpa gambarnya.
 *
 * Riwayat dikirim ulang sebagai input pada setiap pertanyaan berikutnya, jadi
 * satu SVG dua ribu token yang lahir di pertanyaan pertama akan ditagih lagi di
 * pertanyaan kedua, ketiga, keempat, sampai ia terdorong keluar dari delapan
 * giliran terakhir. Dibiarkan begitu, beberapa diagram melipatgandakan biaya
 * input setiap permintaan selama percakapan berjalan.
 *
 * Dipakai saat MENYUSUN pesan untuk model, bukan saat menyimpan. Yang disimpan
 * tetap utuh — tabel itulah yang dibaca ulang saat halaman dibuka, dan
 * menyimpan penandanya di sana berarti gambarnya hilang begitu aplikasi dimuat
 * lagi.
 */
export function withoutDiagrams(text: string): string {
  // Dikenali dari isinya, bukan dari pagar ```svg.
  //
  // Pagar itu yang DIMINTA prompt, bukan yang selalu datang: diagram juga
  // sampai sebagai markup mentah dan sebagai isi pembungkus tool-call. Selama
  // penyaring ini hanya mengenal satu bentuk, bentuk yang lain lolos — dan
  // seluruh penghematan yang jadi alasan fungsi ini ada pun ikut lolos, tanpa
  // gejala apa pun selain tagihan input yang membengkak.
  return text
    .replace(/\[TOOL_CALL\][\s\S]*?(?:\[\/TOOL_CALL\]|$)/gi, REDACTED)
    .replace(/```[\w-]*\s*<svg[\s>][\s\S]*?(?:```|$)/gi, REDACTED)
    .replace(/<svg[\s>][\s\S]*?(?:<\/svg>|$)/gi, REDACTED)
    // Kartu ikut dibuang dengan alasan yang sama: dua belas baris berisi markup
    // simbol adalah ribuan token yang ditagih ulang di setiap pertanyaan
    // berikutnya sepanjang percakapan.
    .replace(/```\s*cards\b[\s\S]*?(?:```|$)/gi, REDACTED);
}

/** Penanda yang ditulis model seolah ada yang akan mengisinya di belakangnya. */
const PLACEHOLDER = /\[\s*(diagram|gambar|image|svg|chart|grafik|kartu|cards)\b[^\]]*\]/i;

/**
 * Jawaban yang MENJANJIKAN gambar tapi tidak memuatnya.
 *
 * Gejalanya persis seperti yang dilaporkan: sebuah judul, lalu tulisan
 * "[diagram]", dan tidak ada apa-apa lagi. Penyebab utamanya sudah dicabut —
 * penanda itu dulu datang dari riwayat buatan kami sendiri — tapi kebiasaan
 * menulis penanda tidak sepenuhnya hilang hanya karena contohnya dihapus, dan
 * jawaban yang menyebut ada gambar sementara gambarnya tidak ada terlihat
 * seperti aplikasi rusak, bukan seperti jawaban kurang lengkap.
 */
export function promisedButMissing(reply: string): boolean {
  if (!PLACEHOLDER.test(reply)) return false;
  return !/<svg[\s>]/i.test(reply) && !/```\s*cards\b/i.test(reply);
}
