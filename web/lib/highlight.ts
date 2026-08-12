/**
 * Memecah teks pada bagian yang cocok dengan pencarian.
 *
 * Menyaring gelembung saja tidak cukup. Satu jawaban di halaman Standar bisa
 * sepanjang dua layar — perhitungan beban pendingin, tabel dimensi, daftar
 * langkah — dan menemukan gelembung yang benar hanya memindahkan pekerjaan
 * berikutnya: membaca semuanya untuk menemukan kata yang tadi dicari. Yang
 * ditandai kuning menghapus langkah itu.
 *
 * Fungsi ini sengaja tidak tahu apa-apa soal React maupun HTML: ia menerima
 * teks, mengembalikan potongan. Yang membungkusnya jadi <mark> ada di tempat
 * lain — dan karena itu aturan pemotongannya bisa diuji tanpa merender apa pun.
 */

export interface Piece {
  text: string;
  /** Bagian ini cocok dengan salah satu kata yang dicari. */
  hit: boolean;
}

/** Satu rentang yang cocok, dalam indeks karakter. */
interface Span {
  start: number;
  end: number;
}

/**
 * Rentang setiap kemunculan, digabung kalau bertindihan.
 *
 * Bertindihan itu wajar, bukan kasus pinggiran: mencari "beban pendingin"
 * memberi dua kata, dan pada tulisan "beban pendinginan" keduanya menutupi
 * huruf yang sama. Tanpa digabung, potongannya jadi bersarang dan yang tergambar
 * adalah dua kotak kuning yang saling menimpa di tengah kata.
 */
function spansOf(haystack: string, terms: string[]): Span[] {
  const found: Span[] = [];

  for (const term of terms) {
    if (!term) continue;

    let at = haystack.indexOf(term);
    while (at !== -1) {
      found.push({ start: at, end: at + term.length });
      // Dicari dari SATU huruf setelah awal kecocokan, bukan dari ujungnya:
      // pada "aaaa", kata "aa" muncul tiga kali dan yang kedua dimulai di
      // tengah yang pertama.
      at = haystack.indexOf(term, at + 1);
    }
  }

  if (found.length === 0) return [];

  found.sort((a, b) => a.start - b.start || a.end - b.end);

  const merged: Span[] = [found[0]];
  for (const span of found.slice(1)) {
    const last = merged[merged.length - 1];
    if (span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push(span);
  }

  return merged;
}

/**
 * Teks yang sama, dipotong pada bagian yang cocok.
 *
 * Tanpa kata pencarian — atau tanpa satu pun yang cocok — hasilnya satu potong
 * yang tidak ditandai. Pemanggilnya bisa mengandalkan itu untuk tidak mengubah
 * apa pun ketika tidak ada yang dicari.
 */
export function splitHighlights(text: string, terms: string[]): Piece[] {
  if (!text) return [];

  const wanted = terms.map((term) => term.toLowerCase()).filter(Boolean);
  if (wanted.length === 0) return [{ text, hit: false }];

  const spans = spansOf(text.toLowerCase(), wanted);
  if (spans.length === 0) return [{ text, hit: false }];

  const pieces: Piece[] = [];
  let at = 0;

  for (const span of spans) {
    if (span.start > at) pieces.push({ text: text.slice(at, span.start), hit: false });
    // Dipotong dari teks ASLINYA, bukan dari yang sudah dikecilkan hurufnya:
    // yang dicari boleh huruf kecil, yang tampil harus tetap seperti aslinya.
    pieces.push({ text: text.slice(span.start, span.end), hit: true });
    at = span.end;
  }

  if (at < text.length) pieces.push({ text: text.slice(at), hit: false });

  return pieces;
}
