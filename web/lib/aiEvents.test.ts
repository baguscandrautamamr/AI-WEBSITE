import { describe, expect, it } from "vitest";
import { statsOf } from "./aiEvents";

// Yang diuji di sini bukan "apakah pemetaannya benar" — itu sepele — melainkan
// apakah ia tetap memetakan sesuatu ketika jawabannya TIDAK berbentuk seperti
// yang dijanjikan SDK. Yang menjawab route ini adalah penyedia pihak ketiga
// (lihat lib/llm.ts), dan telemetri yang melempar karena satu medan kosong akan
// menjatuhkan permintaan yang jawabannya sudah benar.
//
// Sejak pindah ke Chat Completions, bentuk yang dibaca berubah seluruhnya:
// `usage.prompt_tokens`/`completion_tokens` menggantikan
// `input_tokens`/`output_tokens`, dan penanda berhentinya pindah dari medan
// puncak `stop_reason` ke `choices[0].finish_reason`. Kolom databasenya tetap
// bernama `stop_reason` — artinya sama, kosakata nilainya yang berbeda.

const completion = (
  finish: unknown,
  usage?: Record<string, unknown> | null,
  model = "openai/gpt-5.6-luna"
) => ({ model, choices: [{ finish_reason: finish }], usage: usage as never });

describe("statsOf", () => {
  it("membaca model, finish_reason, dan angka pemakaian", () => {
    expect(
      statsOf(
        completion("tool_calls", {
          prompt_tokens: 1200,
          completion_tokens: 340,
          prompt_tokens_details: { cached_tokens: 1024 },
        })
      )
    ).toEqual({
      model_served: "openai/gpt-5.6-luna",
      stop_reason: "tool_calls",
      input_tokens: 1200,
      output_tokens: 340,
      cache_read_tokens: 1024,
    });
  });

  it("model_served merekam yang MENJAWAB, bukan yang diminta", () => {
    // Inti kolom itu. Tidak ada varian bertanggal untuk mengunci versi model,
    // jadi satu-satunya cara mengetahui yang melayani sudah berganti adalah
    // mencatat apa yang menjawab — dan itu makin berarti sekarang, karena yang
    // menjawab ada di belakang gateway yang katalognya bisa berubah kapan saja.
    expect(statsOf(completion("stop", null, "openai/gpt-5.6-mini")).model_served).toBe(
      "openai/gpt-5.6-mini"
    );
  });

  it("jawaban tanpa usage tidak melempar", () => {
    expect(statsOf(completion("stop"))).toEqual({
      model_served: "openai/gpt-5.6-luna",
      stop_reason: "stop",
      input_tokens: null,
      output_tokens: null,
      cache_read_tokens: null,
    });
  });

  it("choices kosong tidak melempar", () => {
    // Potongan TERAKHIR sebuah aliran membawa `usage` dengan `choices` kosong.
    // Pembaca yang mengandaikan `choices[0]` selalu ada melempar tepat di akhir
    // jawaban yang sudah utuh di layar orangnya.
    expect(statsOf({ model: "x", choices: [], usage: { prompt_tokens: 7 } })).toEqual({
      model_served: "x",
      stop_reason: null,
      input_tokens: 7,
      output_tokens: null,
      cache_read_tokens: null,
    });
  });

  it("usage null, dan jawaban yang kosong sama sekali", () => {
    expect(statsOf({ usage: null }).input_tokens).toBeNull();
    expect(statsOf({}).model_served).toBeNull();
  });

  it("medan yang bukan angka jadi null, bukan NaN", () => {
    // NaN lolos `typeof === "number"` dan sampai ke Postgres sebagai galat;
    // kolomnya integer. Yang ditulis harus null.
    const stats = statsOf(
      completion("stop", { prompt_tokens: NaN, completion_tokens: "340" })
    );
    expect(stats.input_tokens).toBeNull();
    expect(stats.output_tokens).toBeNull();
  });

  it("finish_reason yang bukan string jadi null", () => {
    expect(statsOf(completion({ kind: "refusal" })).stop_reason).toBeNull();
  });

  it("caching yang tidak dilaporkan jadi null, bukan nol", () => {
    // Bedanya penting sejak `cache_control` hilang bersama perpindahan: null di
    // kolom ini berarti "penyedia tidak melaporkannya", bukan "tidak kena
    // cache". Menuliskannya nol akan terbaca sebagai caching yang tidak pernah
    // bekerja.
    expect(statsOf(completion("stop", { prompt_tokens: 10 })).cache_read_tokens).toBeNull();
  });

  it("nol dicatat sebagai nol, bukan dianggap tidak ada", () => {
    // `?? null` pada nilai 0 adalah kesalahan yang mudah ditulis dan sulit
    // dilihat: completion_tokens 0 memang mungkin (jawaban yang ditolak), dan
    // mencatatnya sebagai null berarti angkanya hilang dari rata-rata.
    expect(statsOf(completion("stop", { completion_tokens: 0 })).output_tokens).toBe(0);
  });
});
