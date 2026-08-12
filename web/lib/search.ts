import { splitDiagrams } from "./diagrams";

/**
 * Mencari di dalam percakapan Standar.
 *
 * Jawaban di halaman itu panjang — tabel dimensi, daftar standar, beberapa
 * paragraf sekaligus — dan utasnya menyimpan beberapa giliran terakhir. Menemukan
 * kembali "yang kemarin soal cable tray" berarti menggulir melewati semuanya,
 * dan yang digulir bukan daftar melainkan halaman berisi tabel.
 */

/**
 * Isi yang boleh dicari: teksnya, tanpa gambarnya.
 *
 * SVG sebuah diagram penuh kata yang bukan kata: `rect`, `stroke`, `text`,
 * `fill`, `path`. Dicari apa adanya, "text" cocok dengan SETIAP jawaban yang
 * memuat gambar, dan pencarian yang mengembalikan semuanya sama tidak bergunanya
 * dengan yang tidak mengembalikan apa pun.
 */
export function searchableText(content: string): string {
  return splitDiagrams(content)
    .filter((segment) => segment.kind === "text")
    .map((segment) => segment.value)
    .join(" ");
}

/**
 * Kata-kata pencarian, dipisah spasi.
 *
 * Semuanya harus ada, urutannya tidak penting. "tray lantai" menemukan jawaban
 * yang menyebut keduanya walau terpisah dua paragraf — dan itu bentuk pertanyaan
 * yang sebenarnya diingat orang, bukan potongan kalimat yang persis.
 */
function terms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
}

/** Apakah sebuah giliran cocok dengan yang dicari. */
export function matchesQuery(content: string, query: string): boolean {
  const wanted = terms(query);
  if (wanted.length === 0) return true;

  const haystack = searchableText(content).toLowerCase();
  return wanted.every((word) => haystack.includes(word));
}
