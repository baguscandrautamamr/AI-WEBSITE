/**
 * Riwayat percakapan yang dikirim ulang ke model.
 *
 * Riwayatnya sekarang dikirim UTUH, diagram dan semuanya. Sebelumnya gambar
 * diganti penanda demi menghemat token, dan penghematan itu ternyata membayar
 * harga yang jauh lebih mahal: riwayat adalah contoh jawaban yang seolah pernah
 * ditulis model sendiri, jadi apa pun yang kami sisipkan ke sana akan ditiru.
 * Dua kali terbukti. Mula-mula "[diagram]" muncul di layar sebagai jawaban, di
 * bawah judul yang menjanjikan gambar. Setelah penandanya diganti kalimat
 * catatan sistem yang panjang — yang seharusnya "tidak mungkin ditiru" — kalimat
 * itu pun muncul di layar, kata demi kata.
 *
 * Dan penghematannya tidak pernah menghemat apa pun: tagihannya dihitung per
 * permintaan, bukan per token. Sepanjang apa pun percakapannya, tetap satu
 * permintaan. Jadi yang tersisa dari gagasan itu hanya kerugiannya.
 *
 * Terpisah dari route-nya supaya bisa diuji.
 */

/**
 * Kalimat sistem yang pernah dipakai menggantikan diagram di riwayat.
 *
 * Sudah tidak dipakai lagi — tagihan dihitung per permintaan, bukan per token,
 * jadi menghemat token dengan memangkas riwayat tidak pernah menghemat apa pun.
 * Tapi ia MASIH ADA di jawaban-jawaban yang telanjur tersimpan, karena model
 * sempat menyalinnya ke dalam jawabannya sendiri, dan yang tersimpan itu
 * dikirim ulang sebagai contoh. Dibersihkan saat riwayatnya dibaca supaya
 * lingkarannya benar-benar putus.
 */
const LEAKED = /\(catatan sistem:[^)]*\)\s*/gi;

/** Penanda yang pernah dipakai sebelum kalimat di atas, dengan akibat yang sama. */
const LEAKED_MARKER = /^\s*\[diagram\]\s*$/gim;

/**
 * Jawaban tersimpan, tanpa sisa penanda buatan kami sendiri.
 *
 * Riwayat dikirim ulang sebagai giliran ASISTEN — contoh jawaban yang seolah
 * pernah ditulis model sendiri. Apa pun yang kami sisipkan ke sana akan ditiru,
 * dan dua kali sudah terbukti: mula-mula "[diagram]", lalu kalimat catatan
 * sistem yang menggantikannya. Keduanya muncul di layar pengguna sebagai
 * jawaban, di bawah judul yang menjanjikan sebuah gambar.
 *
 * Sekarang tidak ada yang disisipkan sama sekali. Ini hanya menyapu sisa yang
 * telanjur tersimpan.
 */
export function scrubLeaks(text: string): string {
  return text.replace(LEAKED, "").replace(LEAKED_MARKER, "").trim();
}

/**
 * Batas ukuran riwayat, sebagai jaring pengaman — bukan penghematan.
 *
 * Riwayat sudah dibatasi delapan giliran saat disimpan, dan delapan giliran
 * berisi diagram pun masih jauh di bawah jendela konteks model. Ini untuk hal
 * yang tidak terduga: satu jawaban raksasa, atau utas yang ditulis bot dengan
 * aturan lain.
 *
 * Yang dibuang giliran PALING LAMA, utuh — bukan isi giliran yang dipotong.
 * Memotong isi berarti menaruh penanda di tempatnya, dan penanda di riwayat
 * persis yang baru saja dicabut dari sini.
 */
const MAX_HISTORY_CHARS = 200_000;

export function fitHistory<T extends { text: string }>(turns: T[]): T[] {
  let total = turns.reduce((sum, turn) => sum + turn.text.length, 0);
  if (total <= MAX_HISTORY_CHARS) return turns;

  const kept = [...turns];
  while (kept.length > 1 && total > MAX_HISTORY_CHARS) {
    total -= kept[0].text.length;
    kept.shift();
  }

  return kept;
}

/**
 * Penanda yang berdiri SENDIRI di satu baris, di tempat gambarnya seharusnya.
 *
 * Harus sendirian, dan itu bukan kehati-hatian berlebihan — versi pertama
 * pemeriksaan ini mencari penanda di mana pun di dalam jawaban, dan akibatnya
 * empat dari lima jawaban biasa ikut ditulis ulang:
 *
 *   - "Seperti pada [Gambar 1], jarak antar penyangga 1,5 m" — rujukan wajar
 *   - "[gambar teknis](https://...)" — tautan markdown biasa
 *   - "Bagian: [Diagram Satu Garis], [Tabel Beban]" — daftar isi
 *   - dan yang paling sering: jawaban yang MENYEBUT aturannya sendiri, karena
 *     sistem prompt memuat kata "[diagram]" secara harfiah dan model
 *     mengutipnya kembali saat menjelaskan apa yang bisa ia lakukan
 *
 * Yang di layar terlihat sebagai jawaban ditulis penuh, dihapus, lalu ditulis
 * ulang hampir sama — dan itu jauh lebih membingungkan daripada bug yang mau
 * diperbaikinya. Bug aslinya selalu berbentuk penanda sendirian di satu baris;
 * bentuk itulah yang dicari sekarang.
 */
const LONE_PLACEHOLDER =
  /^[\s>*_-]*\[\s*(diagram|gambar|image|svg|chart|grafik|kartu|cards)\b[^\]]*\][\s.:;]*$/im;

/**
 * Jawaban yang MENJANJIKAN gambar tapi tidak memuatnya.
 *
 * Gejalanya persis seperti yang dilaporkan: sebuah judul, lalu tulisan
 * "[diagram]" sendirian di satu baris, dan tidak ada apa-apa lagi.
 */
export function promisedButMissing(reply: string): boolean {
  if (!LONE_PLACEHOLDER.test(reply)) return false;
  // Tautan markdown kebetulan bisa berdiri sendiri di satu baris juga.
  if (/\]\s*\(/.test(reply)) return false;
  return !/<svg[\s>]/i.test(reply) && !/```\s*cards\b/i.test(reply);
}

/**
 * Aksara yang tidak punya urusan apa pun dengan jawaban di halaman ini.
 *
 * Yunani SENGAJA tidak ada di sini, dan itu keputusan penting: Ω, μ, φ, Δ, dan
 * λ adalah satuan dan lambang yang dipakai hampir di setiap jawaban
 * kelistrikan. Memasukkannya berarti menandai jawaban yang paling benar sebagai
 * paling rusak.
 *
 * Latin diperluas juga tidak: é, ü, ñ muncul wajar pada nama merek dan nama
 * standar.
 */
/**
 * DUA huruf berurutan, bukan satu.
 *
 * Satu karakter tunggal terlalu mudah muncul tanpa maksud — sebuah tanda baca
 * lebar yang tersalin dari sumber lain, satu simbol di dalam atribut SVG — dan
 * menulis ulang seluruh jawaban karena satu karakter berarti pengguna menonton
 * jawabannya dihapus dan ditulis lagi tanpa alasan yang ia bisa lihat. Kata yang
 * benar-benar tergelincir selalu lebih panjang dari satu huruf: `количество`
 * sepuluh, `普通铜编织带` enam.
 */
const SCRIPTS: { name: string; range: RegExp }[] = [
  { name: "Sirilik", range: /[Ѐ-ӿ]{2}/ },
  { name: "Ibrani", range: /[֐-׿]{2}/ },
  { name: "Arab", range: /[؀-ۿ]{2}/ },
  { name: "Devanagari", range: /[ऀ-ॿ]{2}/ },
  { name: "Thai", range: /[฀-๿]{2}/ },
  { name: "Hangul", range: /[ᄀ-ᇿ가-힯]{2}/ },
  { name: "Jepang", range: /[぀-ヿ]{2}/ },
  { name: "Mandarin", range: /[㐀-䶿一-鿿]{2}/ },
];

/**
 * Kata beraksara asing yang nyelonong ke tengah jawaban.
 *
 * Yang dilaporkan pengguna: "Mau saya bantu hitung количество flexible bonding
 * braid", dan sebuah baris tabel berbunyi "普通铜编织带". Satu kata Rusia dan satu
 * kata Mandarin di tengah kalimat Indonesia — bukan salah ketik, bukan istilah,
 * melainkan model yang tergelincir ke bahasa lain untuk satu kata lalu kembali
 * seolah tidak terjadi apa-apa. Pembacanya tidak bisa menebak apa yang
 * dimaksud, dan seluruh jawaban jadi tidak bisa dipercaya.
 *
 * Dibandingkan dengan PERTANYAANNYA, bukan dengan daftar tetap. Kalau yang
 * bertanya memang menulis dengan aksara itu, jawaban beraksara sama adalah
 * jawaban yang benar — yang salah hanya aksara yang muncul entah dari mana.
 */
export function strayScript(reply: string, question: string): string | null {
  for (const script of SCRIPTS) {
    if (script.range.test(reply) && !script.range.test(question)) return script.name;
  }
  return null;
}

/**
 * Alasan sebuah jawaban harus ditulis ulang.
 *
 * Dua kalimat, untuk dua pembaca. `instruction` dikirim balik ke model —
 * percobaan kedua yang tidak diberi tahu apa yang salah cuma lemparan dadu yang
 * sama. `notice` untuk pengguna, dan itu bagian yang sempat terlupakan: tanpa
 * satu baris keterangan, yang terlihat adalah jawaban ditulis penuh, hilang,
 * lalu ditulis lagi hampir sama — dan tidak ada cara menebak apa yang terjadi.
 *
 * Null berarti jawabannya boleh lewat. Menulis ulang jawaban yang sudah benar
 * menggandakan waktu tunggu tanpa memperbaiki apa pun, jadi ambangnya sengaja
 * tinggi.
 */
export interface Redo {
  instruction: string;
  notice: string;
}

export function redoReason(reply: string, question: string): Redo | null {
  // Kalimat catatan sistem yang tersalin ke dalam jawaban. Sumbernya sudah
  // dicabut dan sisanya disapu saat riwayat dibaca, jadi ini tinggal jaring
  // terakhir.
  if (/\(catatan sistem:/i.test(reply)) {
    return {
      instruction:
        "Jawabanmu menyalin sebuah kalimat catatan sistem yang bukan bagian dari jawaban. " +
        "Kalimat itu tidak pernah untuk dibaca pengguna. Tulis ulang jawabannya secara utuh " +
        "tanpa kalimat itu, dan kalau memang ada gambar, gambarnya benar-benar digambar.",
      notice: "Jawaban pertama memuat catatan internal, jadi ditulis ulang.",
    };
  }

  if (promisedButMissing(reply)) {
    return {
      instruction:
        "Jawabanmu memuat penanda seperti [diagram] tanpa gambar yang sesungguhnya, " +
        "dan yang tampil di layar hanya tulisan itu. Tulis ulang jawabannya secara " +
        "utuh dengan gambarnya benar-benar ada — blok cards untuk sekumpulan hal " +
        "sejenis, atau blok svg berisi <svg ...> ... </svg> untuk yang berbentuk. " +
        "Jangan pernah menulis penanda sebagai pengganti gambar.",
      notice: "Jawaban pertama belum menyertakan gambarnya, jadi ditulis ulang.",
    };
  }

  const script = strayScript(reply, question);
  if (script) {
    return {
      instruction:
        `Jawabanmu menyisipkan kata beraksara ${script} di tengah kalimat, dan pembacanya ` +
        "tidak bisa membacanya. Tulis ulang jawabannya secara utuh dalam bahasa yang sama " +
        "dengan pertanyaannya, seluruhnya dengan huruf Latin. Istilah teknis Inggris boleh " +
        "dipertahankan; kata dari bahasa lain tidak.",
      notice: `Jawaban pertama menyisipkan kata beraksara ${script}, jadi ditulis ulang.`,
    };
  }

  return null;
}
