/**
 * Tabel yang digambar dengan karakter, dibaca kembali jadi tabel sungguhan.
 *
 * Prompt sudah melarangnya dengan alasannya, dan ia tetap datang: baris-baris
 * berisi `|` dan `-` yang dilebarkan dengan spasi yang dihitung model sendiri.
 * Satu sel yang lebih panjang dari perkiraannya membuat seluruh sisi kanannya
 * bergerigi — persis yang terlihat di layar pengguna, dengan garis penutup yang
 * tidak bertemu apa pun. Dan karena ia berada di dalam blok kode, ia tidak
 * pernah melipat baris: di telepon, tabel selebar 70 karakter dibaca sambil
 * menggeser, baris demi baris.
 *
 * Diperbaiki di sini, bukan dengan aturan yang lebih tegas. Yang datang tetap
 * apa adanya; yang berubah adalah ia dibaca kembali menjadi baris dan kolom,
 * lalu digambar sebagai <table> yang lebarnya diatur browser.
 *
 * Sengaja berhati-hati. Blok kode yang salah dikira tabel adalah kode yang
 * HILANG dari layar, jadi yang diterima hanya yang benar-benar berbentuk tabel:
 * beberapa baris berkolom DAN sebuah garis pemisah. Perintah shell yang penuh
 * tanda `|` tidak punya garis pemisah, dan tidak akan pernah lolos.
 */

export interface AsciiTable {
  head: string[];
  rows: string[][];
}

/** Garis vertikal versi gambar-kotak, disamakan dengan `|` biasa. */
const VERTICAL = /[\u2502\u2503\u2506\u2507\u250A\u250B\u2551]/g;

/** Baris yang cuma garis: `-----`, `+---+---+`, `├───┼───┤`. */
const SEPARATOR = /^[\s|+*=\u2500-\u257F-]*$/;

/** Sel yang isinya cuma garis. */
const RULE_CELL = /^[\s=\u2500-\u257F-]*$/;

function cellsOf(line: string): string[] {
  return line
    .replace(VERTICAL, "|")
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

/**
 * Isi blok kode sebagai tabel, atau null kalau ia memang bukan tabel.
 */
export function asciiTable(source: string): AsciiTable | null {
  const lines = source.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 3) return null;

  const ruled = lines.some(
    (line) => SEPARATOR.test(line) && /[-=\u2500-\u257F]{3,}/.test(line)
  );
  if (!ruled) return null;

  const rows: string[][] = [];
  let stray = 0;

  for (const line of lines) {
    if (SEPARATOR.test(line)) continue;

    if (!/[|\u2502\u2503\u2506\u2507\u250A\u250B\u2551]/.test(line)) {
      // Baris yang bukan garis dan bukan kolom: ini bukan tabel murni, dan
      // membacanya sebagai tabel akan membuang isinya.
      stray += 1;
      continue;
    }

    const cells = cellsOf(line);
    if (cells.length < 2) {
      stray += 1;
      continue;
    }
    if (cells.every((cell) => !cell)) continue;
    if (cells.every((cell) => RULE_CELL.test(cell))) continue;

    const filled = cells.filter(Boolean);
    const previous = rows[rows.length - 1];

    // Sel yang meluber ke baris berikutnya — "(generic tinned copper)" di bawah
    // nama mereknya. Dibaca sebagai baris tersendiri, ia jadi baris tabel yang
    // hampir seluruhnya kosong.
    if (previous && filled.length === 1) {
      const at = cells.findIndex(Boolean);
      if (previous[at]) {
        previous[at] = `${previous[at]} ${cells[at]}`.trim();
        continue;
      }
    }

    rows.push(cells);
  }

  if (stray > 0) return null;
  if (rows.length < 2) return null;

  const columns = Math.max(...rows.map((row) => row.length));
  if (columns < 2) return null;

  const padded = rows.map((row) => [...row, ...Array(columns - row.length).fill("")]);

  return { head: padded[0], rows: padded.slice(1) };
}
