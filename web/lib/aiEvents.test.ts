import { describe, expect, it } from "vitest";
import { statsOf } from "./aiEvents";

// Yang diuji di sini bukan "apakah pemetaannya benar" — itu sepele — melainkan
// apakah ia tetap memetakan sesuatu ketika jawabannya TIDAK berbentuk seperti
// yang dijanjikan SDK. Yang menjawab route ini adalah gateway pihak ketiga
// (lihat lib/anthropic.ts), dan telemetri yang melempar karena satu medan
// kosong akan menjatuhkan permintaan yang jawabannya sudah benar.

describe("statsOf", () => {
  it("membaca model, stop_reason, dan angka pemakaian", () => {
    expect(
      statsOf({
        model: "claude-sonnet-5",
        stop_reason: "tool_use",
        usage: { input_tokens: 1200, output_tokens: 340, cache_read_input_tokens: 1024 },
      })
    ).toEqual({
      model_served: "claude-sonnet-5",
      stop_reason: "tool_use",
      input_tokens: 1200,
      output_tokens: 340,
      cache_read_tokens: 1024,
    });
  });

  it("model_served merekam yang MENJAWAB, bukan yang diminta", () => {
    // Inti kolom itu. `claude-sonnet-5` sudah ID lengkap dan eksak — tidak ada
    // varian bertanggal untuk mengunci versinya — jadi satu-satunya cara
    // mengetahui yang melayani sudah berganti adalah mencatat apa yang menjawab.
    expect(statsOf({ model: "claude-sonnet-4-6" }).model_served).toBe("claude-sonnet-4-6");
  });

  it("jawaban tanpa usage tidak melempar", () => {
    expect(statsOf({ model: "claude-sonnet-5", stop_reason: "end_turn" })).toEqual({
      model_served: "claude-sonnet-5",
      stop_reason: "end_turn",
      input_tokens: null,
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
    const stats = statsOf({
      usage: { input_tokens: NaN, output_tokens: "340" as unknown as number },
    });
    expect(stats.input_tokens).toBeNull();
    expect(stats.output_tokens).toBeNull();
  });

  it("stop_reason yang bukan string jadi null", () => {
    expect(statsOf({ stop_reason: { type: "refusal" } }).stop_reason).toBeNull();
  });

  it("nol dicatat sebagai nol, bukan dianggap tidak ada", () => {
    // `?? null` pada nilai 0 adalah kesalahan yang mudah ditulis dan sulit
    // dilihat: output_tokens 0 memang mungkin (jawaban yang ditolak), dan
    // mencatatnya sebagai null berarti angkanya hilang dari rata-rata.
    expect(statsOf({ usage: { output_tokens: 0 } }).output_tokens).toBe(0);
  });
});
