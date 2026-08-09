import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Diagnosa konfigurasi deployment.
 *
 * Ada karena kegagalan konfigurasi di Vercel muncul sebagai halaman 500 tanpa
 * keterangan (`MIDDLEWARE_INVOCATION_FAILED`), dan log-nya tidak selalu mudah
 * dijangkau dari HP. Route ini menjawab pertanyaan yang sebenarnya: variabel
 * mana yang belum terpasang, dan apakah Supabase-nya betul-betul bisa dihubungi.
 *
 * TIDAK pernah menampilkan nilai rahasia — hanya ada/tidaknya, dan host yang
 * dituju (yang memang sudah publik di bundle browser).
 */
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;

  const env = {
    NEXT_PUBLIC_SUPABASE_URL: Boolean(url),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    AI_GATEWAY_API_KEY: Boolean(process.env.AI_GATEWAY_API_KEY),
  };

  let supabaseHost: string | null = null;
  let urlValid = false;
  try {
    if (url) {
      supabaseHost = new URL(url.trim()).host;
      urlValid = true;
    }
  } catch {
    // URL-nya ada tapi tidak bisa di-parse — persis yang membuat middleware
    // melempar. Dilaporkan sebagai urlValid: false, bukan dilempar lagi.
  }

  // Endpoint publik; balasan apa pun (termasuk 401) membuktikan host-nya hidup.
  let reachable: boolean | null = null;
  if (urlValid) {
    try {
      const res = await fetch(`${url!.trim().replace(/\/$/, "")}/auth/v1/health`, {
        signal: AbortSignal.timeout(5000),
      });
      reachable = res.status < 500;
    } catch {
      reachable = false;
    }
  }

  const ok = env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY && urlValid;

  return NextResponse.json(
    {
      ok,
      env,
      supabase: { host: supabaseHost, urlValid, reachable },
      hint: ok
        ? undefined
        : "Env var dibaca saat BUILD, bukan saat request. Setelah menambah atau memperbaikinya di Vercel, wajib deploy ulang.",
    },
    { status: ok ? 200 : 503 }
  );
}
