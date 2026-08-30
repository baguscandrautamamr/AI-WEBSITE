import Anthropic from "@anthropic-ai/sdk";

// PENTING: baseURL di bawah menunjuk ke proxy pihak ketiga (bukan endpoint
// resmi Anthropic). Pastikan kamu percaya operatornya sebelum mengirim data
// proyek lewat sini. API key HARUS berasal dari env var server, tidak pernah
// dari client/browser.
export const anthropic = new Anthropic({
  apiKey: process.env.AI_GATEWAY_API_KEY,
  baseURL: process.env.AI_GATEWAY_BASE_URL ?? "https://gateway.olagon.site/anthropic",
});

// Catatan: pada Claude Sonnet 5 adaptive thinking aktif secara default, dan
// `max_tokens` membatasi thinking + teks jawaban sekaligus. Beri ruang cukup
// di setiap pemanggilan supaya jawaban tidak terpotong di tengah.
//
// JANGAN menambahkan sufiks tanggal pada nilai ini. `claude-sonnet-5` sudah ID
// yang lengkap dan eksak; bentuk seperti `claude-sonnet-5-20251114` bukan
// "versi yang dikunci" melainkan ID yang tidak ada, dan ia ditolak.
//
// Akibatnya tidak ada cara mengunci versi model dari sini — dan itu berarti
// sesuatu bagi repo ini, karena hampir setiap aturan di ELECTRICAL_SYSTEM_PROMPT
// dan systemPrompt() di /api/ai/standard ditulis terhadap kebiasaan satu model
// tertentu (menulis perintah sebagai teks, menyalin `Family: Type` utuh,
// menyisipkan kata beraksara asing). Kalau yang melayani berganti, yang berubah
// bukan "kualitas bergeser sedikit": salah satu penjagaan itu bisa berhenti
// relevan sementara yang lain mulai perlu.
//
// Jadi penjagaannya bukan pinning, melainkan pengamatan: `ai_events.model_served`
// mencatat model yang BENAR-BENAR menjawab setiap permintaan (lihat
// lib/aiEvents.ts). Pergantiannya jadi terlihat di data, bukan di laporan
// pengguna. Ini juga alasan kedua kolom itu dipisah dari `model_requested` —
// request ini lewat gateway pihak ketiga di atas, jadi yang menjawab tidak
// sepenuhnya di bawah kendali repo ini.
export const MODEL = process.env.AI_MODEL ?? "claude-sonnet-5";

/**
 * Seberapa dalam model boleh berpikir sebelum menjawab.
 *
 * `low`, karena giliran mode Electrical adalah penerjemahan: satu kalimat jadi
 * satu panggilan tool, dengan katalog yang sudah menyebutkan setiap argumen dan
 * rentangnya, dan hasilnya divalidasi ulang di `buildPayload` dan
 * `resolveFamilies` sebelum berangkat ke mana pun. Bawaan API adalah `high`, dan
 * pada giliran seperti ini yang ditambahkannya bukan ketepatan melainkan
 * detik-detik yang dihabiskan orangnya menatap "Menyusun perintah…".
 *
 * Env, bukan konstanta, karena satu-satunya cara mengetahui bahwa sebuah bentuk
 * permintaan menuntut lebih adalah menemukannya — dan menemukannya tidak boleh
 * berarti menunggu deploy.
 */
export const EFFORT =
  (process.env.AI_EFFORT as "low" | "medium" | "high" | "xhigh" | "max" | undefined) ?? "low";
