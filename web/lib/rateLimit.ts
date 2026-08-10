import { NextResponse } from "next/server";

/**
 * Pembatas laju per user, jendela tetap, di dalam memori proses.
 *
 * Jujur soal jangkauannya: Vercel menjalankan banyak instance serverless dan
 * masing-masing punya memori sendiri, jadi hitungan ini per instance, bukan
 * global. Untuk yang dijaga di sini — kuota token gateway AI dan unggahan
 * Cloudinary oleh akun yang sah — itu sudah jauh lebih baik daripada keadaan
 * sebelumnya, yang tidak punya batas sama sekali. Kalau nanti butuh batas yang
 * benar-benar global, tempatnya di Postgres atau Upstash, bukan di sini.
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

/**
 * Batas jumlah kunci yang disimpan. Tanpa ini, instance yang hidup lama
 * mengumpulkan satu entri per user selamanya.
 */
const MAX_KEYS = 10_000;

export interface RateLimitResult {
  ok: boolean;
  /** Detik sampai jendela berikutnya; 0 kalau tidak sedang dibatasi. */
  retryAfter: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const current = windows.get(key);

  if (!current || current.resetAt <= now) {
    if (windows.size >= MAX_KEYS) evict(now);
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }

  current.count += 1;
  if (current.count > limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
  }
  return { ok: true, retryAfter: 0 };
}

/**
 * Buang jendela yang sudah lewat. Kalau ternyata semuanya masih aktif —
 * lonjakan dari sangat banyak user sekaligus — seluruh peta dikosongkan.
 * Kehilangan hitungan sesaat lebih baik daripada memori yang tumbuh tanpa
 * batas, dan jendela berikutnya langsung membangunnya kembali.
 */
function evict(now: number) {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
  if (windows.size >= MAX_KEYS) windows.clear();
}

/** Respons 429 baku, lengkap dengan header `Retry-After`. */
export function tooManyRequests(result: RateLimitResult) {
  return NextResponse.json(
    {
      error: `terlalu banyak permintaan — coba lagi dalam ${result.retryAfter} detik`,
      retryAfter: result.retryAfter,
    },
    { status: 429, headers: { "Retry-After": String(result.retryAfter) } }
  );
}
