import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Dokumen standar: dipotong untuk dicari, dirapikan untuk dikutip.
 *
 * Dua fungsi murni, dan keduanya menentukan apakah kutipannya bisa dipercaya.
 *
 * `chunkDocument` memutuskan sebuah jawaban akan menunjuk pasal mana. Potongan
 * yang batasnya jatuh di tengah sebuah pasal menghasilkan kutipan yang menunjuk
 * judul pasal SEBELUMNYA — nomor yang salah, dengan isi yang benar, yang adalah
 * bentuk paling buruk dari keduanya: orangnya membuka dokumen aslinya di nomor
 * itu, tidak menemukan apa yang dikutip, dan menyimpulkan sistemnya mengarang.
 *
 * `buildSources` memutuskan apa yang dilihat model. Kalau nomor pasal dan
 * halamannya tidak ada di situ, model akan menyebut nomor dari ingatannya di
 * samping isi yang dari dokumen — dan tidak ada apa pun di jawaban itu yang
 * menunjukkan mana yang mana.
 */

/** Satu potongan siap simpan. */
export interface Chunk {
  ord: number;
  heading: string | null;
  page: number | null;
  content: string;
}

/** Satu potongan yang ditemukan pencarian, sebagaimana dikembalikan RPC. */
export interface FoundChunk {
  doc_code: string;
  doc_title: string;
  doc_edition: string | null;
  heading: string | null;
  page: number | null;
  content: string;
  rank: number;
}

/** Panjang yang dituju sebuah potongan, dalam karakter. */
const TARGET_CHARS = 1_200;

/**
 * Panjang maksimum sebelum sebuah blok dipecah paksa.
 *
 * Ada karena tabel. Sebuah tabel KHA bisa satu blok tanpa baris kosong sepanjang
 * enam ribu karakter, dan potongan sebesar itu memakan seluruh anggaran sumber
 * untuk satu kecocokan.
 */
const MAX_CHARS = 2_200;

/**
 * Sebuah potongan baru dimulai pada judul kalau yang sekarang sudah sepanjang
 * ini. Di bawahnya, judul digabung ke potongan yang sedang berjalan — kalau
 * tidak, dokumen dengan judul di setiap paragraf menghasilkan ratusan potongan
 * sepanjang dua baris, dan potongan dua baris tidak memuat jawaban apa pun.
 */
const MIN_BEFORE_BREAK = Math.floor(TARGET_CHARS * 0.4);

/**
 * Baris yang menandai pasal, bagian, atau tabel.
 *
 * Empat bentuk, dan semuanya benar-benar muncul di dokumen standar:
 *
 *   `## Proteksi`                 — markdown, dari sumber yang sudah dirapikan
 *   `3.24.2.1 Proteksi terhadap`  — nomor pasal bertingkat, bentuk PUIL/IEC
 *   `Pasal 5 Ketentuan umum`      — kata kunci berbahasa Indonesia
 *   `Table 52.1 Current ratings`  — kata kunci berbahasa Inggris
 *
 * Yang SENGAJA tidak dikenali: baris berhuruf besar seluruhnya. Ia memang sering
 * judul — dan sama seringnya sebuah baris tabel ("NYY 4x25 KHA 116 A") atau
 * sebuah catatan ("PERINGATAN"). Judul yang salah kenal lebih buruk daripada
 * judul yang tidak dikenali: yang tidak dikenali membuat potongan mewarisi judul
 * benar di atasnya, sedangkan yang salah kenal memberi nomor pasal yang salah ke
 * seluruh potongan sesudahnya.
 */
const HEADING_PATTERNS: RegExp[] = [
  /^#{1,6}\s+(.{2,})$/,
  /^((?:\d+\.)+\d+\.?)\s+(\S.*)$/,
  /^(\d+\.?)\s+([A-ZÀ-ɏ][^.]{3,})$/,
  /^((?:Pasal|Bagian|Lampiran|Tabel|BAB|Bab)\s+[\w.\-]+)\.?\s*(.*)$/i,
  /^((?:Clause|Section|Annex|Table|Chapter)\s+[\w.\-]+)\.?\s*(.*)$/i,
];

/** Judul yang dibawa potongan ini, atau null kalau barisnya bukan judul. */
export function headingOf(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 200) return null;

  for (const pattern of HEADING_PATTERNS) {
    const match = pattern.exec(trimmed);
    if (!match) continue;

    // Digabung kembali apa adanya, bukan disusun dari grup-grupnya: nomor pasal
    // adalah bagian dari judulnya, dan judul tanpa nomornya tidak bisa dipakai
    // sebagai kutipan.
    const heading = trimmed.replace(/^#{1,6}\s+/, "").trim();
    return heading.slice(0, 180);
  }

  return null;
}

/**
 * Memotong satu dokumen jadi potongan yang bisa dicari dan dikutip.
 *
 * Halaman dihitung dari FORM FEED (\f), yang bukan pilihan sembarangan: itu yang
 * ditulis `pdftotext` di antara halaman, jadi nomor halaman di kutipan adalah
 * nomor halaman di PDF yang dipegang orangnya — bukan hitungan yang dikarang di
 * sini. Sumber tanpa form feed tetap diterima; halamannya null, dan kutipannya
 * menyebut pasalnya saja.
 */
export function chunkDocument(text: string): Chunk[] {
  const chunks: Chunk[] = [];

  // \r\n dulu: sebuah dokumen dari Windows yang tidak dinormalkan menghasilkan
  // "\r" di ujung setiap judul, dan judul dengan \r tidak cocok dengan pola apa
  // pun di atas.
  const pages = text.replace(/\r\n?/g, "\n").split("\f");

  let heading: string | null = null;
  let buffer: string[] = [];
  let bufferPage = 1;
  let length = 0;

  const flush = () => {
    const content = buffer.join("\n\n").trim();
    buffer = [];
    length = 0;
    if (!content) return;
    chunks.push({
      ord: chunks.length,
      heading,
      page: pages.length > 1 ? bufferPage : null,
      content,
    });
  };

  for (const [index, page] of pages.entries()) {
    const pageNumber = index + 1;

    for (const block of page.split(/\n\s*\n/)) {
      const trimmed = block.trim();
      if (!trimmed) continue;

      // Judul dicari di baris PERTAMA blok saja. Sebuah judul yang berada di
      // tengah blok berarti bloknya memang satu kesatuan teks, dan memotongnya
      // di situ memisahkan judul dari kalimat yang menjelaskannya.
      const first = trimmed.split("\n", 1)[0] ?? "";
      const found = headingOf(first);

      if (found) {
        if (length >= MIN_BEFORE_BREAK) flush();
        heading = found;
      }

      for (const piece of split(trimmed)) {
        if (length > 0 && length + piece.length > TARGET_CHARS) flush();
        if (buffer.length === 0) bufferPage = pageNumber;
        buffer.push(piece);
        length += piece.length;
      }
    }

    /**
     * Sebuah potongan TIDAK BOLEH melintasi halaman.
     *
     * Ditemukan oleh tesnya sendiri, dan bentuknya persis kegagalan yang fitur
     * ini ada untuk menghilangkan: tiga halaman pendek digabung jadi satu
     * potongan, `page` mencatat halaman tempat potongan itu DIMULAI, dan
     * kutipannya menyebut "hal. 1" untuk kalimat yang sebenarnya ada di halaman
     * tiga. Orangnya membuka dokumen aslinya di halaman 1, tidak menemukan apa
     * yang dikutip, dan yang ia simpulkan bukan "nomor halamannya bergeser"
     * melainkan bahwa sistem ini mengarang kutipan.
     *
     * Harganya nyata dan dibayar dengan sadar: pasal yang terbelah pergantian
     * halaman jadi dua potongan, dan tidak satu pun memuat kalimatnya secara
     * utuh — sehingga kueri AND bisa gagal pada keduanya. Yang menangkap itu
     * tahap OR di search_standard_chunks, dan kedua belahannya tetap naik.
     * Kutipan yang salah halaman tidak punya penangkap apa pun.
     */
    flush();
  }

  flush();
  return chunks;
}

/**
 * Blok yang lebih panjang dari MAX_CHARS, dipecah di batas kalimat.
 *
 * Di batas kalimat dan bukan di jumlah karakter, karena yang dipotong di tengah
 * angka berhenti berarti apa pun: "KHA 116" yang terpisah dari satuannya dan
 * dari syarat pemasangannya adalah angka yang akan dikutip tanpa keduanya.
 * Kalau tidak ada batas kalimat sama sekali — sebuah tabel — barulah ia dipotong
 * di batas baris.
 */
function split(block: string): string[] {
  if (block.length <= MAX_CHARS) return [block];

  const units = block.includes(". ") ? block.split(/(?<=\.)\s+/) : block.split("\n");
  const out: string[] = [];
  let current = "";

  for (const unit of units) {
    if (current && current.length + unit.length > MAX_CHARS) {
      out.push(current.trim());
      current = "";
    }
    current += (current ? " " : "") + unit;
  }

  if (current.trim()) out.push(current.trim());

  // Satu unit yang sendirian lebih panjang dari MAX_CHARS tetap lewat apa
  // adanya. Memotongnya di tengah kata tidak menyelamatkan apa pun, dan
  // anggaran sumber di buildSources sudah menjaga batas sebenarnya.
  return out.length ? out : [block];
}

/** Berapa karakter sumber yang boleh masuk prompt sekali jawab. */
export const MAX_SOURCE_CHARS = 8_000;

/**
 * Nama sebuah dokumen sebagaimana ia harus muncul di kutipan.
 *
 * Edisinya ikut, dan itu bukan hiasan: pasal yang benar dari edisi yang bukan
 * yang dipakai proyeknya adalah jawaban yang salah, dan satu-satunya cara
 * pembacanya bisa tahu adalah kalau edisinya tertulis.
 */
export function labelOf(chunk: FoundChunk): string {
  const parts = [chunk.doc_code];
  if (chunk.doc_edition) parts.push(`(${chunk.doc_edition})`);
  if (chunk.heading) parts.push(`— ${chunk.heading}`);
  if (chunk.page !== null && chunk.page !== undefined) parts.push(`— hal. ${chunk.page}`);
  return parts.join(" ");
}

/** Sumber yang ikut dikirim ke browser untuk ditampilkan di bawah jawaban. */
export interface SourceRef {
  n: number;
  label: string;
}

export interface Sources {
  /** Blok bernomor untuk prompt. Kosong berarti tidak ada sumber yang cocok. */
  block: string;
  /** Daftar untuk layar, bernomor SAMA dengan blok di atas. */
  refs: SourceRef[];
}

/**
 * Blok SUMBER dan daftarnya untuk layar — disusun SEKALI, bersama.
 *
 * Bernomor, karena kutipan yang tidak bisa ditunjuk tidak bisa diperiksa. `[2]`
 * di dalam jawaban harus bisa dilacak ke satu potongan tertentu dari satu
 * dokumen tertentu di satu halaman tertentu; itu seluruh gunanya fitur ini ada.
 *
 * Keduanya keluar dari satu fungsi dan satu perulangan, dan itu bukan soal
 * kerapian. Nomor yang dilihat model dan nomor yang dilihat pembaca harus sama
 * persis. Dua perulangan yang menghitung anggaran yang sama adalah dua
 * perulangan yang akan berbeda pada perubahan pertama — dan bentuk perbedaannya
 * adalah `[2]` di kalimat menunjuk dokumen yang BERBEDA dari `[2]` di daftar.
 * Kutipan yang menunjuk dokumen yang salah lebih buruk daripada tidak ada
 * kutipan sama sekali, karena ia mengundang orang memeriksanya lalu menyesatkan
 * pemeriksaannya.
 *
 * Dipotong pada anggaran, dan yang dibuang yang PALING BAWAH: urutannya sudah
 * peringkat dari pencarian, jadi yang tersisa yang paling mungkin memuat
 * jawabannya. Yang tidak muat tidak disebut-sebut kepada model — sumber yang
 * dikatakan ada tapi isinya tidak dikirim adalah sumber yang akan dikutip dari
 * ingatan.
 */
export function buildSources(chunks: FoundChunk[], maxChars = MAX_SOURCE_CHARS): Sources {
  const parts: string[] = [];
  const refs: SourceRef[] = [];
  let total = 0;

  for (const chunk of chunks) {
    const n = parts.length + 1;
    const label = labelOf(chunk);
    const entry = `[${n}] ${label}\n${chunk.content.trim()}`;

    // `parts.length > 0` supaya satu potongan yang sendirian lebih besar dari
    // anggaran tetap terkirim. Sumber tunggal yang terlalu panjang lebih baik
    // daripada jawaban tanpa sumber sama sekali — dan itu memang terjadi:
    // sebuah tabel KHA bisa lebih panjang dari seluruh anggaran ini.
    if (total + entry.length > maxChars && parts.length > 0) break;

    parts.push(entry);
    refs.push({ n, label });
    total += entry.length;
  }

  return { block: parts.join("\n\n"), refs };
}

/**
 * Mencari sumber untuk sebuah pertanyaan.
 *
 * TIDAK PERNAH melempar, dan itu bukan kelalaian. Korpus yang belum diisi,
 * migrasi 0013 yang belum diterapkan, RPC yang belum ada — ketiganya wajar dan
 * tidak satu pun boleh menjatuhkan pertanyaan yang seharusnya tetap terjawab.
 * Yang terjadi kalau pencariannya gagal: jawaban tanpa sumber, yaitu persis
 * perilaku halaman ini sebelum korpusnya ada, lengkap dengan keterangan bahwa
 * jawabannya dari ingatan.
 *
 * Dipanggil dengan klien SESI, jadi RLS pemanggilnya yang berlaku: akun berkelas
 * `no_standard` tidak mendapat satu potongan pun, ditegakkan database.
 */
export async function retrieveSources(
  supabase: SupabaseClient,
  question: string,
  want = 6
): Promise<Sources> {
  const empty: Sources = { block: "", refs: [] };

  // Pertanyaan yang terlalu pendek bukan kueri. "apa?" mencocokkan apa pun yang
  // memuat kata itu, dan sumber yang tidak berhubungan lebih merugikan daripada
  // tidak ada sumber: model akan berusaha memakainya.
  const query = question.trim();
  if (query.length < 8) return empty;

  try {
    const { data, error } = await supabase.rpc("search_standard_chunks", {
      q: query.slice(0, 1_000),
      want,
    });

    if (error) {
      // Dicatat sekali, dengan pesannya, karena inilah tempat "kok tidak ada
      // sumbernya?" akan dijawab: migrasi belum jalan, atau RPC-nya tidak ada.
      console.error("[standards] pencarian sumber gagal", error.message);
      return empty;
    }

    return buildSources((data ?? []) as FoundChunk[]);
  } catch (err) {
    console.error("[standards] pencarian sumber gagal", err);
    return empty;
  }
}
