import { createServerClient, type SetAllCookies } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Memperbarui sesi Supabase sebelum halaman dirender.
 *
 * Bernama `proxy.ts`, bukan `middleware.ts`: Next 16 masih menerima nama lama
 * tapi memperingatkannya sebagai usang pada setiap build, dan peringatan yang
 * dibiarkan menumpuk adalah peringatan yang berhenti dibaca.
 *
 * Token akses berumur satu jam. Yang memperbaruinya adalah panggilan Supabase
 * pertama setelah ia kedaluwarsa — dan untuk menyimpan token barunya, pustakanya
 * harus menulis cookie. Sebuah Server Component tidak boleh menulis cookie, jadi
 * sampai file ini ada, tidak ada satu pun tempat di alur halaman yang bisa
 * menyimpan hasil perbaruan itu:
 *
 *   - halaman melempar saat mencoba menyimpannya (lihat lib/supabase/server.ts),
 *     dan lemparannya membunuh request tanpa status — `GET / ---` di log Vercel
 *   - kalau lemparannya ditelan saja, tokennya diperbarui lalu HILANG, jadi
 *     request berikutnya mengulanginya dari awal dan orangnya keluar sendiri
 *     setiap satu jam
 *
 * Berkas ini berjalan SEBELUM respons dimulai, jadi di sini cookie masih boleh
 * ditulis. Ini satu-satunya tempat di alur sebuah halaman yang begitu.
 *
 * Route Handler (`app/api/…`) tidak butuh ini — ia memang boleh menulis cookie
 * sendiri. Karena itu `/api` dikeluarkan dari matcher di bawah, dan itu bukan
 * penghematan sepele: halaman perintah memanggil `/api/commands?id=` setiap dua
 * detik selama sebuah perintah berjalan, dan `getUser()` memvalidasi token ke
 * server Supabase setiap kali dipanggil.
 */
export default async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Tanpa env-nya, tidak ada sesi untuk diperbarui. Diteruskan apa adanya, bukan
  // dilempar: middleware yang gagal menjatuhkan SETIAP halaman sekaligus, dan
  // /login lah yang menjelaskan konfigurasi yang belum lengkap.
  if (!url || !key) return response;

  try {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(items: Parameters<SetAllCookies>[0]) {
          // Dua kali, dan keduanya perlu. Yang pertama supaya kode setelah ini
          // dalam request yang sama membaca token yang baru; yang kedua supaya
          // browsernya ikut menyimpannya.
          for (const { name, value } of items) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of items) {
            response.cookies.set(name, value, options);
          }
        },
      },
    });

    // Panggilan inilah yang memicu perbaruan kalau tokennya sudah kedaluwarsa.
    // Hasilnya tidak dipakai di sini: yang menentukan boleh-tidaknya sebuah
    // halaman dibuka tetap halaman itu sendiri beserta RLS, bukan middleware.
    await supabase.auth.getUser();
  } catch (err) {
    // Supabase sedang tidak bisa dihubungi, atau cookie-nya rusak. Keduanya bukan
    // alasan menjatuhkan halamannya: yang hilang cuma perbaruan sesi, dan halaman
    // yang menemukan sesinya tidak sah akan mengalihkan ke /login sendiri.
    console.error("[proxy] gagal memperbarui sesi", err);
  }

  return response;
}

export const config = {
  /**
   * Halaman saja.
   *
   * `api` dikeluarkan karena Route Handler boleh menulis cookie sendiri, dan
   * memasang pemeriksaan sesi di depan endpoint yang dipolling tiap dua detik
   * berarti satu perjalanan ke server Supabase untuk setiap poll.
   *
   * Berkas statis dikeluarkan karena tidak ada sesi yang perlu diperbarui untuk
   * mengirim sebuah ikon — dan pemeriksaan di depannya membuat setiap aset
   * membayar sekali panggilan jaringan.
   */
  matcher: [
    "/((?!api|_next/static|_next/image|icons|favicon.ico|manifest.json|sw.js|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|txt|xml)$).*)",
  ],
};
