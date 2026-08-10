import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    // Pesan bawaan Supabase ("Your project's URL and API key are required")
    // tidak menyebut variabel mana yang kosong, dan di Vercel penyebabnya
    // hampir selalu env var yang belum di-set atau belum ikut ter-build.
    throw new Error(
      `${name} belum terpasang. Set di environment variables project, lalu deploy ulang.`
    );
  }
  return value;
}

// Dipakai di Server Component / Route Handler.
//
// Async sejak Next 15: `cookies()` mengembalikan Promise, dan memakainya tanpa
// await hanya menghasilkan objek Promise yang tidak punya `.get`.
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          cookieStore.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          cookieStore.set({ name, value: "", ...options });
        },
      },
    }
  );
}

// Client khusus server-side dengan service_role key — HANYA dipakai di
// route handler tepercaya (misal /api/admin/access, yang perlu membaca daftar
// user yang ditutup RLS). JANGAN pernah expose service_role key ke browser.
//
// Di-import statis dan diberi tipe kembalian: dengan `require()` di dalam
// fungsi, hasilnya `any` dan seluruh query yang memakainya — nama tabel, nama
// kolom, bentuk barisnya — lolos dari typecheck. Salah ketik nama kolom baru
// ketahuan saat request di produksi, bukan saat build.
export function createServiceClient(): SupabaseClient {
  return createSupabaseClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
    // Kunci ini melewati RLS dan hidup hanya selama satu request; tidak ada
    // sesi yang perlu disimpan atau di-refresh.
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
