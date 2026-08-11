import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { accessClassOf, DEFAULT_ACCESS_CLASS, landingFor } from "@/lib/access";

// Halaman ini membaca cookie sesi, jadi memang tidak pernah bisa dirender
// statis. Dinyatakan di sini supaya Next tidak mencoba — percobaan itu bekerja
// dengan melempar error khusus, dan blok catch di bawah akan menelannya.
export const dynamic = "force-dynamic";

// Route "/" tidak punya halaman sendiri — semua konten ada di grup (dashboard)
// dan (auth), yang tidak menambah segmen URL. Tanpa file ini `/` tidak ada
// sama sekali dan Vercel membalas 404 di root domain.
export default async function RootPage() {
  let signedIn = false;
  let landing = landingFor(DEFAULT_ACCESS_CLASS);

  // Halaman ini adalah pintu masuk pertama sebuah domain. Kalau konfigurasi
  // Supabase bermasalah, membiarkannya melempar berarti orang yang membuka
  // alamat utama hanya melihat 500 tanpa keterangan. Diperlakukan sebagai
  // "belum login" saja: /login yang menjelaskan apa yang salah.
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    signedIn = Boolean(user);

    // Mendarat di halaman yang memang boleh dibuka.
    //
    // Sebelumnya semua orang dikirim ke /electrical. Untuk akun yang hanya boleh
    // membuka halaman Standar, halaman itu adalah penolakan — dan itu hal
    // pertama yang ia lihat setiap kali membuka alamat utama.
    if (user) landing = landingFor(await accessClassOf(supabase, user.id));
  } catch (err) {
    console.error("[/] gagal memeriksa sesi", err);
  }

  // redirect() bekerja dengan melempar, jadi harus di luar blok try di atas.
  redirect(signedIn ? landing : "/login");
}
