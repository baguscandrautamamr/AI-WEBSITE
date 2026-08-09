import { createBrowserClient } from "@supabase/ssr";

/** Konfigurasi Supabase sudah ikut ter-build ke bundle ini. */
export function isSupabaseConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

// Dipakai di Client Component ("use client").
//
// Panggil saat benar-benar dibutuhkan (di dalam useEffect atau event handler),
// jangan di badan komponen: badan komponen ikut dijalankan saat prerender, dan
// tanpa env var terpasang seluruh build gagal di halaman itu.
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Konfigurasi Supabase belum terpasang. Set NEXT_PUBLIC_SUPABASE_URL dan NEXT_PUBLIC_SUPABASE_ANON_KEY di environment variables, lalu deploy ulang — nilainya dibaca saat build, bukan saat request."
    );
  }

  return createBrowserClient(url, anonKey);
}
