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
const SCRIPTS: { name: string; chars: string }[] = [
  { name: "Sirilik", chars: "Ѐ-ӿ" },
  { name: "Ibrani", chars: "֐-׿" },
  { name: "Arab", chars: "؀-ۿ" },
  { name: "Devanagari", chars: "ऀ-ॿ" },
  { name: "Thai", chars: "฀-๿" },
  { name: "Hangul", chars: "ᄀ-ᇿ가-힯" },
  { name: "Jepang", chars: "぀-ヿ" },
  { name: "Mandarin", chars: "㐀-䶿一-鿿" },
];

/**
 * DUA huruf berurutan, bukan satu.
 *
 * Satu karakter tunggal terlalu mudah muncul tanpa maksud — sebuah tanda baca
 * lebar yang tersalin dari sumber lain, satu simbol di dalam atribut SVG — dan
 * mengusik seluruh jawaban karena satu karakter berarti pengguna melihat
 * jawabannya diubah tanpa alasan yang ia bisa lihat. Kata yang benar-benar
 * tergelincir selalu lebih panjang dari satu huruf: `количество` sepuluh,
 * `普通铜编织带` enam.
 */
function pair(chars: string) {
  return new RegExp(`[${chars}]{2}`);
}

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
    const two = pair(script.chars);
    if (two.test(reply) && !two.test(question)) return script.name;
  }
  return null;
}

/** Paling banyak sekian kata yang diminta padanannya sekali jalan. */
const MAX_STRAY_WORDS = 8;

/**
 * Kata-kata asing itu sendiri, bukan cuma nama aksaranya.
 *
 * Ada supaya yang diperbaiki hanya KATANYA. Menulis ulang seluruh jawaban demi
 * satu kata berarti pengguna menonton jawaban yang sudah selesai dihapus dan
 * ditulis lagi hampir sama — dan itu yang ia laporkan sebagai bug, dua kali.
 * Dengan daftar kata ini, jawabannya tetap yang pertama; hanya kata yang tidak
 * terbaca yang diganti di tempatnya.
 *
 * Setelah aksaranya terbukti tergelincir, potongan satu huruf pun ikut diambil:
 * ambang dua huruf ada untuk memutuskan APAKAH ada yang salah, bukan untuk
 * memilih mana yang dibersihkan.
 */
export function strayWords(
  reply: string,
  question: string
): { script: string; words: string[] } | null {
  const script = strayScript(reply, question);
  if (!script) return null;

  const found = SCRIPTS.find((entry) => entry.name === script);
  if (!found) return null;

  const runs = reply.match(new RegExp(`[${found.chars}]+`, "g")) ?? [];
  const words = [...new Set(runs)].slice(0, MAX_STRAY_WORDS);

  return words.length > 0 ? { script, words } : null;
}

/**
 * Padanan yang dikirim model, sebagai daftar pasangan pengganti.
 *
 * Bentuk yang diminta `asli => padanan`, satu per baris. Yang tidak berbentuk
 * itu dilewati — ini keluaran model, dan satu baris yang aneh tidak boleh
 * membuat seluruh perbaikan gagal.
 *
 * Padanan yang MASIH beraksara sama ditolak. Model yang sedang tergelincir bisa
 * menjawab dengan kata asing kedua, dan mengganti kata yang tidak terbaca dengan
 * kata lain yang juga tidak terbaca hanya memindahkan masalahnya.
 */
export function parseFixes(text: string, words: string[]): [string, string][] {
  const wanted = new Set(words);
  const fixes: [string, string][] = [];

  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf("=>");
    if (at === -1) continue;

    const from = line.slice(0, at).trim().replace(/^[-*\d.\s]+/, "");
    const to = line.slice(at + 2).trim().replace(/^["'`]|["'`]$/g, "");

    if (!wanted.has(from) || !to || to === from) continue;
    if (SCRIPTS.some((script) => pair(script.chars).test(to))) continue;
    if (to.length > from.length * 8 + 40) continue;

    fixes.push([from, to]);
  }

  return fixes;
}

/** Mengganti kata-kata itu di dalam jawaban, apa adanya. */
export function applyFixes(reply: string, fixes: [string, string][]): string {
  return fixes.reduce((text, [from, to]) => text.split(from).join(to), reply);
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

  // Kata beraksara asing TIDAK di sini, dan itu perubahan yang disengaja.
  //
  // Dulu ia ikut memicu tulis-ulang seluruh jawaban, dan yang terlihat pengguna
  // adalah jawaban selesai ditulis, hilang, lalu kembali hampir sama — dilaporkan
  // dua kali sebagai bug, dan wajar. Satu kata yang salah tidak sepadan dengan
  // membuang jawaban yang sisanya sudah benar. Sekarang kata itu ditambal di
  // tempatnya; lihat strayWords dan parseFixes.
  return null;
}
