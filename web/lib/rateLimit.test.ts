import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimit } from "./rateLimit";

// Jendelanya berbasis Date.now(), jadi waktunya dipalsukan — tes yang menunggu
// satu menit sungguhan bukan tes yang akan dijalankan orang.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

/** Kunci unik per tes: peta jendelanya hidup di level modul. */
let n = 0;
const key = () => `test-${++n}`;

describe("rateLimit", () => {
  it("mengizinkan tepat sebanyak batasnya", () => {
    const k = key();
    for (let i = 0; i < 3; i++) {
      expect(rateLimit(k, 3, 60_000).ok, `permintaan ke-${i + 1}`).toBe(true);
    }
    expect(rateLimit(k, 3, 60_000).ok).toBe(false);
  });

  it("melaporkan sisa detik sampai jendela berikutnya", () => {
    const k = key();
    rateLimit(k, 1, 60_000);
    vi.advanceTimersByTime(20_000);

    const blocked = rateLimit(k, 1, 60_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBe(40);
  });

  it("tidak pernah melaporkan 0 detik saat sedang memblokir", () => {
    // retryAfter 0 akan dibaca client sebagai "coba lagi sekarang", dan itu
    // langsung ditolak lagi.
    const k = key();
    rateLimit(k, 1, 60_000);
    vi.advanceTimersByTime(59_999);

    const blocked = rateLimit(k, 1, 60_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThanOrEqual(1);
  });

  it("membuka lagi setelah jendelanya lewat", () => {
    const k = key();
    rateLimit(k, 1, 60_000);
    expect(rateLimit(k, 1, 60_000).ok).toBe(false);

    vi.advanceTimersByTime(60_001);
    expect(rateLimit(k, 1, 60_000).ok).toBe(true);
  });

  it("menghitung tiap kunci secara terpisah", () => {
    const a = key();
    const b = key();
    rateLimit(a, 1, 60_000);
    expect(rateLimit(a, 1, 60_000).ok).toBe(false);
    expect(rateLimit(b, 1, 60_000).ok).toBe(true);
  });
});
