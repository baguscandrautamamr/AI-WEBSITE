import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MODEL } from "./anthropic";

/**
 * Telemetri per pemanggilan model bahasa — tabel `ai_events` (migrasi 0011).
 *
 * Ada karena deteksi kegagalannya sudah lengkap dan tidak ada yang menghitungnya.
 * `mentionsCommand` (model menulis perintah sebagai teks), `redoReason` (jawaban
 * yang mengirim "[diagram]" alih-alih gambar), `strayWords` (kata beraksara
 * asing) — ketiganya sudah menyala di tempatnya masing-masing, dan yang
 * dihasilkan nyalanya cuma `console.warn` yang tenggelam di log Vercel. Jadi
 * "seberapa sering model menulis perintah sebagai teks?" tidak bisa dijawab —
 * termasuk untuk membuktikan bahwa perbaikan berikutnya memperbaiki sesuatu.
 *
 * YANG TIDAK IKUT: isi pertanyaan, isi jawaban, argumen perintah, nama ruangan,
 * nama family. Itu data proyek orang. Yang dicatat cuma bentuk kejadiannya.
 */

/** Kolom `outcome`: apa yang akhirnya route kembalikan ke browser. */
export type AiOutcome =
  | "command"
  | "batch"
  | "choose"
  | "incomplete"
  | "reply"
  | "unavailable_tool"
  | "truncated"
  | "answer"
  | "error";

export interface AiEvent {
  mode: "electrical" | "standard";
  outcome: AiOutcome;
  model_served?: string | null;
  stop_reason?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_tokens?: number | null;
  latency_ms?: number | null;
  tool?: string | null;
  /**
   * Pembacaan otomatis yang ke berapa dalam satu pertanyaan; 0 = giliran yang
   * benar-benar diketik orang.
   *
   * Ini yang menjawab pertanyaan yang muncul begitu loop baca berantai ada:
   * berapa langkah yang sebenarnya dipakai sebuah pertanyaan. Kalau ternyata
   * hampir semuanya menyentuh batas, batasnya yang salah — atau urutan
   * pembacaan di prompt yang tidak efisien. Tanpa kolom ini keduanya cuma bisa
   * dikira-kira.
   */
  step?: number;
  wrote_command_as_text?: boolean;
  forced_retry?: boolean;
  redo?: string | null;
  stray_words?: number;
  /**
   * Berapa potongan dokumen standar yang ikut sebagai SUMBER; 0 = dijawab dari
   * pengetahuan model.
   *
   * Ini angka yang mengatakan apakah perpustakaan standarnya perlu diisi lebih
   * banyak. Tanpa kolom ini pertanyaan itu hanya bisa dijawab dari perasaan
   * orang yang paling terakhir bertanya.
   */
  sources?: number;
  error?: string | null;
}

/**
 * Angka pemakaian dan penanda berhenti dari sebuah jawaban.
 *
 * Dipisah sebagai fungsi murni supaya bisa diuji tanpa memanggil gateway, dan
 * supaya kedua route memetakan kolom yang sama dengan cara yang sama — dua
 * pemetaan yang ditulis terpisah adalah dua pemetaan yang akan berbeda pada
 * perubahan pertama.
 *
 * `usage` sengaja dibaca defensif. Yang menjawab adalah gateway pihak ketiga
 * (lihat lib/anthropic.ts), jadi tidak ada jaminan setiap medan yang dijanjikan
 * SDK benar-benar ikut di setiap jawaban — dan telemetri yang melempar karena
 * sebuah medan kosong akan menjatuhkan permintaan yang jawabannya sudah benar.
 */
export function statsOf(response: {
  model?: string;
  stop_reason?: unknown;
  usage?: Partial<Anthropic.Usage> | null;
}): Pick<
  AiEvent,
  "model_served" | "stop_reason" | "input_tokens" | "output_tokens" | "cache_read_tokens"
> {
  const usage = response.usage ?? {};
  return {
    model_served: response.model ?? null,
    stop_reason: typeof response.stop_reason === "string" ? response.stop_reason : null,
    input_tokens: num(usage.input_tokens),
    output_tokens: num(usage.output_tokens),
    cache_read_tokens: num(usage.cache_read_input_tokens),
  };
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Menyimpan satu baris. TIDAK PERNAH melempar, dan tidak pernah menunda jawaban
 * yang sudah siap.
 *
 * Urutannya disengaja: pemanggil memanggil ini SETELAH jawabannya disusun, dan
 * kegagalan menyimpannya ditelan di sini. Telemetri yang bisa menjatuhkan
 * permintaan adalah telemetri yang lebih merugikan daripada tidak punya
 * telemetri sama sekali.
 *
 * Ditulis lewat klien sesi, bukan service role: route AI tidak perlu memegang
 * kunci yang bisa membaca seluruh database, dan policy `ai_events_insert_self`
 * yang menentukan barisnya milik siapa. Tanpa `.select()` — RLS tabel ini tidak
 * mengizinkan user biasa membaca, dan insert yang meminta barisnya kembali akan
 * ditolak justru karena itu.
 */
export async function logAiEvent(
  supabase: SupabaseClient,
  userId: string,
  event: AiEvent
): Promise<void> {
  try {
    const { error } = await supabase.from("ai_events").insert({
      user_id: userId,
      mode: event.mode,
      model_requested: MODEL,
      model_served: event.model_served ?? null,
      stop_reason: event.stop_reason ?? null,
      input_tokens: event.input_tokens ?? null,
      output_tokens: event.output_tokens ?? null,
      cache_read_tokens: event.cache_read_tokens ?? null,
      latency_ms: event.latency_ms ?? null,
      tool: event.tool ?? null,
      step: event.step ?? 0,
      outcome: event.outcome,
      wrote_command_as_text: event.wrote_command_as_text ?? false,
      forced_retry: event.forced_retry ?? false,
      redo: event.redo ?? null,
      stray_words: event.stray_words ?? 0,
      sources: event.sources ?? 0,
      error: event.error ?? null,
    });

    // Dicatat, tidak dilempar. Sebab yang paling mungkin adalah migrasi 0011
    // belum diterapkan ke project Supabase-nya, dan itu tidak boleh membuat
    // asisten berhenti bekerja.
    if (error) console.error("[aiEvents] gagal menyimpan", error.message);
  } catch (err) {
    console.error("[aiEvents] gagal menyimpan", err);
  }
}
