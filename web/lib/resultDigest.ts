/**
 * Isi sebuah hasil Revit, dirapikan untuk DIBACA MODEL — bukan untuk dibaca
 * orang.
 *
 * Ini pasangan `summarizeResult`, bukan penggantinya, dan bedanya menentukan
 * apakah loop baca berantai berguna atau sia-sia. Ringkasan itu satu baris untuk
 * mata manusia: "12 parameter". Benar, cukup sebagai judul gelembung — dan tidak
 * mungkin dipakai untuk memutuskan langkah berikutnya, karena yang dibutuhkan
 * langkah berikutnya justru NAMA kedua belas parameter itu. Prompt-nya sendiri
 * melarang menebaknya, dengan alasan yang tepat: kolom yang namanya salah kembali
 * KOSONG, dan kosong tidak bisa dibedakan dari model yang memang tidak punya
 * nilainya.
 *
 * Jadi yang dikirim balik ke model adalah isinya. Yang tersisa cuma pertanyaan
 * berapa banyak, dan itu yang dijawab file ini.
 *
 * SENGAJA TIDAK TAHU BENTUK PER PERINTAH. Aturannya umum — skalar lebih dulu,
 * lalu daftar, keduanya dibatasi — dan itu pilihan yang diambil sesudah melihat
 * apa yang sudah dua kali menyakiti repo ini: setiap tempat yang menyalin bentuk
 * keluaran add-in akan berbeda dari add-in pada perubahan pertama, dan yang
 * berbeda diam-diam adalah yang paling mahal. Fungsi yang tidak tahu nama satu
 * pun perintah tidak bisa basi.
 *
 * Skalar didahulukan karena justru medan kecil yang paling penting: `total`,
 * `shown`, `room`, `family_used`. Kalau pemotongan harus terjadi, yang hilang
 * baris ke-38 dari sebuah daftar, bukan angka yang ditanyakan orangnya.
 */

type Dict = Record<string, unknown>;

const isDict = (value: unknown): value is Dict =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Batas bawaan. Dipotong lagi di server oleh MAX_TURN_CHARS; ini yang pertama. */
export const MAX_DIGEST_CHARS = 3_000;

/** Berapa butir sebuah daftar yang disebut sebelum sisanya dihitung saja. */
const MAX_ITEMS = 40;

/** Berapa medan sebuah butir yang disebut — sebuah baris elemen bisa punya puluhan. */
const MAX_FIELDS = 8;

export function digestResult(value: unknown, maxChars = MAX_DIGEST_CHARS): string {
  if (value === null || value === undefined) return "";
  if (!isDict(value)) return cut(scalar(value), maxChars);

  const scalars: string[] = [];
  const lists: string[] = [];

  for (const [key, item] of Object.entries(value)) {
    if (item === null || item === undefined) continue;

    if (Array.isArray(item)) {
      lists.push(list(key, item));
      continue;
    }

    // Objek bersarang dirapikan satu tingkat saja. Yang lebih dalam dari itu
    // belum pernah muncul di hasil add-in, dan rekursi tanpa batas pada data
    // yang datang dari luar adalah cara membuat satu hasil aneh menghabiskan
    // seluruh jatah token.
    if (isDict(item)) {
      const inner = fields(item);
      if (inner) scalars.push(`${key}: { ${inner} }`);
      continue;
    }

    scalars.push(`${key}: ${scalar(item)}`);
  }

  return cut([...scalars, ...lists].filter(Boolean).join("\n"), maxChars);
}

/** Satu daftar: namanya, jumlah sebenarnya, lalu butir-butirnya. */
function list(key: string, items: unknown[]): string {
  if (!items.length) return `${key}: (kosong)`;

  const shown = items.slice(0, MAX_ITEMS).map((item) => {
    if (isDict(item)) return `- ${fields(item)}`;
    return `- ${scalar(item)}`;
  });

  // Jumlah SEBENARNYA disebut, bukan jumlah yang ditampilkan. Daftar 200 baris
  // yang dipotong jadi 40 tanpa mengatakannya adalah 40 yang dibaca model
  // sebagai seluruhnya, dan kesimpulan yang ditariknya dari situ salah tanpa
  // satu pun tanda.
  const rest = items.length - shown.length;
  const head = rest > 0 ? `${key} (${items.length}, ${shown.length} pertama):` : `${key} (${items.length}):`;

  return [head, ...shown, rest > 0 ? `- … ${rest} lagi tidak ditampilkan` : ""]
    .filter(Boolean)
    .join("\n");
}

/** Medan skalar sebuah butir, `k=v` dipisah spasi. */
function fields(item: Dict): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(item)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      parts.push(`${key}=[${value.length}]`);
      continue;
    }
    if (isDict(value)) continue;
    parts.push(`${key}=${scalar(value)}`);
    if (parts.length >= MAX_FIELDS) break;
  }

  return parts.join(" ");
}

function scalar(value: unknown): string {
  if (typeof value === "number") {
    // 128.4, bukan 128.40000000000001 — angka yang sama dengan yang dilihat
    // orangnya di panel hasil, supaya model tidak menyebut angka ketiga.
    return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value).trim();
}

/**
 * Dipotong dengan MENGATAKANNYA.
 *
 * Pemotongan diam adalah hal yang sama dengan daftar yang dipendekkan tanpa
 * keterangan: yang membacanya menganggap itu seluruhnya. Model yang tahu
 * hasilnya terpotong bisa mempersempit perintah bacanya; model yang tidak tahu
 * akan menjawab dari sebagian data dengan yakin.
 */
function cut(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n… (isi hasil dipotong di sini karena panjang — persempit perintah bacanya kalau yang kamu butuhkan belum kelihatan)`;
}
