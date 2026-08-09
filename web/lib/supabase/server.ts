import { createServerClient, type CookieOptions } from "@supabase/ssr";
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

// Dipakai di Server Component / Route Handler
export function createClient() {
  const cookieStore = cookies();
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
export function createServiceClient() {
  const { createClient: createSupabaseClient } = require("@supabase/supabase-js");
  return createSupabaseClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY")
  );
}
