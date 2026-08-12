import { createServerClient, type SetAllCookies } from "@supabase/ssr";
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

/**
 * Klien Supabase untuk Server Component dan Route Handler.
 *
 * Async sejak Next 15: `cookies()` mengembalikan Promise, dan memakainya tanpa
 * await hanya menghasilkan objek Promise yang tidak punya `.get`.
 *
 * PENULISAN COOKIE DI SINI BOLEH GAGAL, DAN ITU BUKAN KEGAGALAN.
 *
 * Token akses Supabase berumur satu jam. Ketika ia kedaluwarsa, panggilan
 * `auth.getUser()` berikutnya menukarnya dengan yang baru — dan untuk menyimpan
 * yang baru, pustakanya menulis cookie. Di dalam Route Handler itu sah. Di dalam
 * Server Component, Next MELARANGNYA: responsnya sudah mulai dialirkan, jadi
 * header cookie tidak bisa lagi ditambahkan, dan `cookies().set()` melempar
 * "Cookies can only be modified in a Server Action or Route Handler".
 *
 * Lemparan itu terjadi di dalam pustaka, di luar `try` mana pun yang ditulis
 * pemanggilnya, jadi ia menjadi unhandledRejection — dan sebuah unhandledRejection
 * saat merender halaman berarti request itu mati TANPA status. Di log Vercel
 * barisnya berbunyi `GET / ---`, dan yang dilihat orangnya adalah halaman yang
 * tidak pernah selesai memuat.
 *
 * Bentuknya paling menyesatkan justru karena ia berjadwal: selama token masih
 * hidup, semuanya normal. Satu jam kemudian, halaman pertama yang dibuka mati.
 * Itu yang terlihat seperti "kadang website tidak bisa dibuka".
 *
 * Jadi kegagalan menulisnya ditelan di sini, dan yang benar-benar memperbarui
 * sesinya adalah `proxy.ts` — satu-satunya tempat di siklus request yang
 * memang boleh menulis cookie sebelum respons dimulai.
 */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(items: Parameters<SetAllCookies>[0]) {
          try {
            for (const { name, value, options } of items) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Dipanggil dari Server Component. Sesinya tetap diperbarui —
            // proxy.ts yang melakukannya, pada request yang sama, sebelum
            // halaman ini mulai dirender.
          }
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
