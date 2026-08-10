/**
 * Tata letak grid dari sebuah jumlah.
 *
 * Ini bukan kemudahan; ini yang menentukan gambarnya benar atau tidak.
 * "Pasang 10 lampu" tanpa grid dibaca add-in sebagai "cari grid yang cukup
 * memuat 10", dan yang cukup memuat 10 adalah 4x3 — dua belas titik, sepuluh
 * terpakai, DUA LUBANG di deret terakhir. Di gambar listrik itu bukan sekadar
 * kurang rapi: jarak antar armatur jadi tidak seragam, perhitungan lux per
 * titiknya tidak lagi mewakili apa pun, dan orang yang memasang di lapangan
 * melihat baris yang menggantung tanpa alasan.
 *
 * Sepuluh titik punya jawaban yang tepat: 5 kolom x 2 baris. Fungsi di bawah
 * mencari jawaban itu — pasangan faktor yang hasil kalinya PERSIS jumlahnya,
 * dipilih yang paling mendekati persegi — dan mengirimkannya bersama perintah,
 * sehingga tidak ada yang perlu menebak dan tidak ada titik yang tersisa.
 */

export interface Grid {
  cols: number;
  rows: number;
}

/** Semua pasangan faktor `count`, kolom >= baris, dari paling lonjong ke paling persegi. */
export function factorPairs(count: number): Grid[] {
  if (!Number.isInteger(count) || count < 1) return [];

  const pairs: Grid[] = [];
  for (let a = 1; a * a <= count; a++) {
    if (count % a !== 0) continue;
    const b = count / a;
    pairs.push({ cols: Math.max(a, b), rows: Math.min(a, b) });
  }
  return pairs;
}

/**
 * Grid yang muat PERSIS `count` titik, sedekat mungkin dengan persegi.
 *
 * Lanskap secara bawaan (kolom >= baris): ruangan pada denah arsitektur lebih
 * sering lebih lebar daripada dalam, dan kalaupun tidak, membalik 5x2 jadi 2x5
 * adalah satu ketukan di form — sementara tata letak yang berlubang tidak bisa
 * diperbaiki tanpa menghapus dan memasang ulang.
 */
export function autoGrid(
  count: number,
  opts?: { orientation?: "landscape" | "portrait" }
): Grid | null {
  const pairs = factorPairs(count);
  if (!pairs.length) return null;

  // Yang terakhir adalah yang paling persegi: a menaik sampai sqrt(count), jadi
  // selisih |cols - rows| mengecil di setiap langkah.
  const squarest = pairs[pairs.length - 1];
  return opts?.orientation === "portrait" ? flip(squarest) : squarest;
}

export function flip(grid: Grid): Grid {
  return { cols: grid.rows, rows: grid.cols };
}

export function formatGrid(grid: Grid): string {
  return `${grid.cols}x${grid.rows}`;
}

export function parseGrid(raw: unknown): Grid | null {
  const m = /^\s*(\d+)\s*[xX]\s*(\d+)\s*$/.exec(String(raw ?? ""));
  if (!m) return null;
  const cols = Number(m[1]);
  const rows = Number(m[2]);
  if (cols < 1 || rows < 1) return null;
  return { cols, rows };
}

export function gridCount(grid: Grid): number {
  return grid.cols * grid.rows;
}

/**
 * Jumlah yang satu-satunya grid tepatnya adalah satu deret lurus.
 *
 * Bilangan prima: 7 titik hanya bisa 7x1. Itu tetap tata letak yang seragam —
 * tidak ada lubang — tapi di ruangan yang bukan koridor ia salah, dan yang
 * benar adalah mengubah jumlahnya. Jadi ini disebutkan, bukan diperbaiki
 * diam-diam: mengubah 7 jadi 8 tanpa diminta berarti memasang satu armatur
 * yang tidak pernah diminta siapa pun.
 */
export function awkwardCount(count: number): boolean {
  return count > 3 && factorPairs(count).length === 1;
}

/** Jumlah terdekat di atas dan di bawah yang punya grid dua baris atau lebih. */
export function friendlierCounts(count: number): number[] {
  const out: number[] = [];
  for (let n = count - 1; n >= Math.max(2, count - 4); n--) {
    if (!awkwardCount(n) && factorPairs(n).length > 1) {
      out.push(n);
      break;
    }
  }
  for (let n = count + 1; n <= count + 4; n++) {
    if (!awkwardCount(n) && factorPairs(n).length > 1) {
      out.push(n);
      break;
    }
  }
  return out.sort((a, b) => a - b);
}
