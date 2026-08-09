import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Route "/" tidak punya halaman sendiri — semua konten ada di grup (dashboard)
// dan (auth), yang tidak menambah segmen URL. Tanpa file ini `/` tidak ada
// sama sekali dan Vercel membalas 404 di root domain.
export default async function RootPage() {
  let signedIn = false;

  // Halaman ini adalah pintu masuk pertama sebuah domain. Kalau konfigurasi
  // Supabase bermasalah, membiarkannya melempar berarti orang yang membuka
  // alamat utama hanya melihat 500 tanpa keterangan. Diperlakukan sebagai
  // "belum login" saja: /login yang menjelaskan apa yang salah.
  try {
    const {
      data: { user },
    } = await createClient().auth.getUser();
    signedIn = Boolean(user);
  } catch (err) {
    console.error("[/] gagal memeriksa sesi", err);
  }

  // redirect() bekerja dengan melempar, jadi harus di luar blok try di atas.
  redirect(signedIn ? "/electrical" : "/login");
}
