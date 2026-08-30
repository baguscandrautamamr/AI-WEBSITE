import OpenAI from "openai";

/**
 * Klien model bahasa, berbicara Chat Completions (bentuk OpenAI).
 *
 * PENTING: `baseURL` di bawah menunjuk ke penyedia pihak ketiga. Pastikan kamu
 * percaya operatornya sebelum mengirim data proyek lewat sini. API key HARUS
 * berasal dari env var server, tidak pernah dari client/browser.
 *
 * Sebelumnya repo ini memakai Anthropic Messages API (`/v1/messages`). Yang
 * berpindah bukan cuma alamat: bentuk kawatnya berbeda seluruhnya — tool
 * dideklarasikan sebagai `function`, argumennya kembali sebagai STRING JSON,
 * `system` jadi sebuah pesan alih-alih medan tersendiri, dan `finish_reason`
 * menggantikan `stop_reason`. Itu sebabnya ini bukan penggantian env var, dan
 * sebabnya berkas ini tidak lagi bernama `anthropic.ts`.
 *
 * YANG HILANG BERSAMA PERPINDAHAN INI, dan sebaiknya diingat sebelum ada yang
 * mencari-cari kenapa jawabannya melambat:
 *
 * - **Prompt caching.** `cache_control` milik Anthropic; Chat Completions tidak
 *   punya padanan yang bisa disetel dari sini. Katalog tool dan prompt sistem
 *   dibayar penuh di setiap giliran. Sebagian penyedia melakukan caching sendiri
 *   dan melaporkannya di `usage.prompt_tokens_details.cached_tokens` — kolom
 *   `cache_read_tokens` di `ai_events` tetap dibaca dari situ kalau ada.
 * - **`output_config.effort`.** Juga milik Anthropic. Tidak ada penggantinya
 *   yang berlaku umum, jadi kedalaman berpikir model sekarang di luar kendali
 *   repo ini.
 */
export const llm = new OpenAI({
  /**
   * Placeholder saat env-nya kosong, bukan `undefined`.
   *
   * SDK OpenAI MELEMPAR di konstruktor kalau tidak ada key — berbeda dari SDK
   * Anthropic yang membiarkannya sampai permintaan pertama. Karena berkas ini
   * dimuat di puncak modul, lemparan itu menjatuhkan apa pun yang mengimpornya
   * di lingkungan yang memang tidak punya key: unit test, `next build` di CI,
   * dan siapa pun yang baru meng-clone repo ini.
   *
   * Yang benar adalah gagal saat permintaan, bukan saat impor: 401 dari
   * penyedia menunjuk langsung ke env var yang belum diisi, sementara lemparan
   * di konstruktor muncul sebagai modul yang tidak bisa dimuat — sebab yang
   * jauh dari akibatnya.
   */
  apiKey: process.env.AI_GATEWAY_API_KEY || "tanpa-key",
  // Harus memuat `/v1`: SDK menambahkan `/chat/completions` di belakangnya.
  baseURL: process.env.AI_GATEWAY_BASE_URL ?? "https://api.vikey.ai/v1",
});

/**
 * Model yang diminta.
 *
 * Sama seperti sebelumnya, tidak ada versi yang bisa dikunci dari sini — dan
 * itu tetap berarti sesuatu bagi repo ini, karena hampir setiap aturan di
 * ELECTRICAL_SYSTEM_PROMPT dan systemPrompt() di /api/ai/standard ditulis
 * terhadap kebiasaan satu model tertentu. Kalau yang melayani berganti, yang
 * berubah bukan "kualitas bergeser sedikit": salah satu penjagaan itu bisa
 * berhenti relevan sementara yang lain mulai perlu.
 *
 * Penjagaannya bukan pinning, melainkan pengamatan: `ai_events.model_served`
 * mencatat model yang BENAR-BENAR menjawab setiap permintaan.
 */
export const MODEL = process.env.AI_MODEL ?? "openai/gpt-5.6-luna";

/**
 * Batas token jawaban — TIDAK dikirim kecuali disetel.
 *
 * Sengaja begitu. Penyedia yang berbeda menerima nama medan yang berbeda untuk
 * hal yang sama (`max_tokens` pada API klasik, `max_completion_tokens` pada
 * model penalar), dan menebak yang salah bukan menghasilkan jawaban yang lebih
 * panjang atau lebih pendek — ia menghasilkan 400 pada SETIAP permintaan.
 * Membiarkannya kosong berarti penyedia memakai bawaannya sendiri, yang selalu
 * bentuk yang ia mengerti.
 *
 * Isi `AI_MAX_TOKENS` hanya kalau memang terbukti perlu dibatasi.
 */
export const MAX_TOKENS = numberFromEnv(process.env.AI_MAX_TOKENS);

/** Batas untuk mode Standar, yang jawabannya memuat gambar SVG utuh. */
export const STANDARD_MAX_TOKENS = numberFromEnv(process.env.AI_MAX_TOKENS_STANDARD);

function numberFromEnv(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** `max_tokens` yang hanya ikut kalau memang disetel. */
export function tokenCap(limit: number | undefined): { max_tokens?: number } {
  return limit === undefined ? {} : { max_tokens: limit };
}
