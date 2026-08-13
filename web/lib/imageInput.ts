/**
 * Gambar yang ikut dikirim bersama pertanyaan.
 *
 * Model ini bisa MELIHAT — jadi foto papan nama panel, potret gambar kerja, atau
 * tangkapan layar tabel bisa jadi bagian dari pertanyaannya, bukan sesuatu yang
 * harus diketik ulang lebih dulu. Yang ada di berkas ini hanya pemeriksaannya,
 * dan sengaja terpisah dari route supaya bisa diuji tanpa Supabase maupun
 * gateway.
 *
 * Semua batas di sini dijaga DI SERVER. Halaman web memang mengecilkan gambarnya
 * lebih dulu, tapi yang menentukan bukan halaman itu: sebuah `curl` bisa
 * mengirim apa saja, dan yang dibayar per gambar adalah kami.
 */

/**
 * Yang bisa dibaca model. Bukan daftar "format gambar yang populer" —
 * di luar keempat ini permintaannya ditolak gateway dengan 400, dan yang
 * membacanya cuma log kami.
 */
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

export type ImageType = (typeof IMAGE_TYPES)[number];

export function isImageType(value: unknown): value is ImageType {
  return typeof value === "string" && (IMAGE_TYPES as readonly string[]).includes(value);
}

/**
 * Berapa gambar boleh menempel pada satu pertanyaan.
 *
 * Tiga, bukan satu: "bandingkan panel ini dengan yang ini" adalah pertanyaan
 * yang wajar. Dan bukan sepuluh: tiap gambar dibaca ulang pada SETIAP giliran
 * berikutnya kalau ikut disimpan, dan tiap gambar punya harganya sendiri.
 */
export const MAX_IMAGES = 3;

/** Batas per gambar SESUDAH base64 dibongkar — batas API-nya 5 MB, ini di bawahnya. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export interface ImageInput {
  media_type: ImageType;
  /** base64 murni, tanpa awalan `data:...;base64,`. */
  data: string;
}

/** Hanya alfabet base64. Yang lain tidak akan pernah jadi gambar di ujung sana. */
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Ukuran asli sebuah base64, tanpa membongkarnya.
 *
 * Membongkar dulu untuk mengukur berarti mengalokasikan seluruh gambar di
 * memori sebelum tahu ia terlalu besar — persis yang ingin dicegah batasnya.
 */
export function base64Bytes(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

export type ImageCheck =
  | { ok: true; images: ImageInput[] }
  | { ok: false; reason: string };

/**
 * Isi `images` dari sebuah permintaan, atau alasan penolakannya.
 *
 * Alasannya dikembalikan sebagai kalimat yang dibaca orangnya, bukan kode:
 * yang melampirkan gambar 12 MB perlu tahu bahwa itu terlalu besar, bukan
 * bahwa `IMAGE_TOO_LARGE`.
 */
export function checkImages(value: unknown): ImageCheck {
  if (value === undefined || value === null) return { ok: true, images: [] };

  if (!Array.isArray(value)) {
    return { ok: false, reason: "`images` harus berupa daftar" };
  }

  if (value.length > MAX_IMAGES) {
    return { ok: false, reason: `maksimal ${MAX_IMAGES} gambar per pertanyaan` };
  }

  const images: ImageInput[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") {
      return { ok: false, reason: "setiap gambar harus berupa objek" };
    }

    const { media_type: mediaType, data } = item as { media_type?: unknown; data?: unknown };

    if (!isImageType(mediaType)) {
      return {
        ok: false,
        reason: `format gambar harus salah satu dari: ${IMAGE_TYPES.join(", ")}`,
      };
    }

    if (typeof data !== "string" || !data) {
      return { ok: false, reason: "isi gambar kosong" };
    }

    // Awalan data URL dibuang di sini, bukan ditolak: yang mengirimnya biasanya
    // menyalin apa adanya dari FileReader, dan menolak permintaannya karena
    // sebuah awalan yang bisa dipotong sendiri tidak menjaga apa pun.
    const clean = data.replace(/^data:[^,]*,/, "");

    if (!BASE64.test(clean)) {
      return { ok: false, reason: "isi gambar bukan base64 yang sah" };
    }

    if (base64Bytes(clean) > MAX_IMAGE_BYTES) {
      return {
        ok: false,
        reason: `gambar maksimal ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB per berkas`,
      };
    }

    images.push({ media_type: mediaType, data: clean });
  }

  return { ok: true, images };
}

/**
 * Penanda gambar untuk RIWAYAT, bukan untuk model yang sedang menjawab.
 *
 * Gambarnya sendiri tidak ikut disimpan ke `standards_threads`: satu foto
 * berukuran megabyte di dalam kolom JSON akan dibaca ulang setiap kali halaman
 * dibuka dan setiap kali giliran berikutnya dikirim, dan tabel itu dipakai
 * bersama bot Telegram yang bentuk barisnya cuma `{ role, text }`.
 *
 * Yang disimpan karena itu satu baris keterangan. Ia jujur tentang apa yang
 * terjadi — pertanyaan berikutnya yang berbunyi "tadi yang di gambar itu
 * berapa?" akan dijawab model dengan mengaku tidak lagi melihatnya, bukan
 * dengan mengarang.
 */
export function attachmentNote(count: number): string {
  if (count <= 0) return "";
  return `[${count} gambar dilampirkan pada pertanyaan ini; gambarnya tidak tersimpan di riwayat]`;
}

/** Pertanyaan bawaan kalau yang dikirim hanya gambar, tanpa satu kata pun. */
export const IMAGE_ONLY_QUESTION =
  "Tolong baca gambar ini dan jelaskan apa yang terlihat, kaitkan dengan standar yang relevan.";
