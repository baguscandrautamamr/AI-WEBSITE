import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Refresh session Supabase di setiap request (pola standar @supabase/ssr).
//
// Middleware berjalan SEBELUM halaman mana pun, di setiap route yang cocok
// dengan matcher di bawah. Artinya apa pun yang dilempar di sini menjatuhkan
// seluruh situs sekaligus — termasuk /login, satu-satunya halaman yang bisa
// dipakai untuk keluar dari keadaan itu. Vercel menampilkannya sebagai
// `MIDDLEWARE_INVOCATION_FAILED` 500, tanpa petunjuk apa pun soal penyebabnya.
//
// Karena itu seluruh isinya gagal-lunak. Menyegarkan sesi adalah kemudahan,
// bukan gerbang keamanan: yang benar-benar menjaga data adalah RLS di Supabase
// dan pemeriksaan `auth.getUser()` di layout serta route handler. Sesi yang
// gagal disegarkan cukup berarti "belum login", dan halaman berikutnya yang
// memutuskan harus diapakan — bukan halaman error yang mematikan semuanya.
export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request: { headers: request.headers } });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Nilai ini dipasang saat build. Kalau kosong atau bukan URL yang sah —
  // misalnya env var di Vercel salah ketik, terbawa spasi, atau di-set setelah
  // deploy terakhir sehingga belum ikut ter-build — createServerClient akan
  // melempar dan menjatuhkan seluruh situs. Diperiksa lebih dulu di sini.
  if (!isUsableUrl(url) || !anonKey) {
    console.error(
      "[middleware] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY tidak terpasang dengan benar saat build — sesi tidak disegarkan. Lihat /api/health."
    );
    return response;
  }

  try {
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          response.cookies.set({ name, value: "", ...options });
        },
      },
    });

    await supabase.auth.getUser();
  } catch (err) {
    // Supabase tidak bisa dihubungi, cookie sesi rusak, apa pun itu: teruskan
    // request tanpa sesi yang disegarkan. Situs tetap hidup.
    console.error("[middleware] gagal menyegarkan sesi Supabase", err);
  }

  return response;
}

function isUsableUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export const config = {
  // Route handler membuat klien Supabase sendiri dan memeriksa sesinya sendiri,
  // jadi /api tidak butuh middleware — mengeluarkannya berarti satu kesalahan
  // di sini tidak ikut menjatuhkan seluruh API.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|manifest.json|sw.js|workbox-.*|icons/.*).*)",
  ],
};
