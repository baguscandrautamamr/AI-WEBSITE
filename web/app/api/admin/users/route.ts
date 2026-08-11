import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isGlobalAdmin } from "@/lib/access";

export const runtime = "nodejs";

/**
 * Menghapus sebuah akun — kedua sisinya.
 *
 * Terpisah dari /api/admin/access karena yang dijawabnya pertanyaan yang berbeda:
 * yang di sana mengatur AKSES seseorang pada sebuah proyek, yang di sini
 * menghapus ORANGNYA. Digabung, "delete" akan punya dua arti di satu endpoint,
 * dan yang salah kirim menghapus akun ketika maksudnya mencabut satu peran.
 *
 * KEDUA SISI, dan itu inti route ini. `public.users` tidak punya foreign key ke
 * `auth.users` — id-nya kebetulan sama karena trigger `handle_new_web_user`
 * menyalinnya, bukan karena database memaksanya. Jadi menghapus akun dari panel
 * Authentication Supabase meninggalkan barisnya di `public.users`, dan halaman
 * admin — yang membaca `public.users` — tetap menampilkan orang yang sudah tidak
 * bisa login. Kebalikannya lebih buruk: menghapus barisnya saja meninggalkan
 * identitas login yang masih bisa dipakai masuk.
 *
 * Urutannya karena itu: identitas login dulu, barisnya kemudian. Kalau yang
 * pertama gagal, tidak ada yang berubah. Kalau yang kedua gagal, yang tertinggal
 * adalah baris yang tidak bisa dipakai login — jelek, tapi tidak berbahaya, dan
 * dikatakan apa adanya supaya adminnya mencoba lagi.
 */
export async function DELETE(req: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const service = createServiceClient();

  // Menghapus akun berlaku global dan tidak bisa dibatalkan, jadi syaratnya
  // bukan "admin di setidaknya satu proyek" — syarat yang bisa dipenuhi siapa
  // pun dengan membuat satu proyek sendiri.
  if (!(await isGlobalAdmin(service, user.id))) {
    return NextResponse.json(
      { error: "hanya admin global yang boleh menghapus akun" },
      { status: 403 }
    );
  }

  const userId = new URL(req.url).searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "parameter `userId` wajib" }, { status: 400 });
  }

  if (userId === user.id) {
    return NextResponse.json({ error: "tidak bisa menghapus akunmu sendiri" }, { status: 400 });
  }

  const { data: target } = await service
    .from("users")
    .select("id, full_name, auth_provider")
    .eq("id", userId)
    .maybeSingle();

  if (!target) return NextResponse.json({ error: "akun tidak ditemukan" }, { status: 404 });

  /**
   * Hanya akun yang belum punya akses proyek.
   *
   * Tombolnya memang berada di daftar "Menunggu akses", tapi syaratnya ditegakkan
   * di sini — bukan dipercayakan pada tempat tombolnya. Sebuah akun yang sudah
   * bekerja di sebuah proyek membawa perintah, riwayat, dan kredensial yang ikut
   * terhapus bersamanya (semuanya `on delete cascade`), dan itu keputusan yang
   * pantas didahului satu langkah sadar: cabut aksesnya lebih dulu.
   */
  const { count } = await service
    .from("user_project_access")
    .select("project_id", { count: "exact", head: true })
    .eq("user_id", userId);

  if ((count ?? 0) > 0) {
    return NextResponse.json(
      {
        error:
          "akun ini masih punya akses proyek. Cabut aksesnya dulu di daftar anggota, " +
          "lalu hapus dari daftar yang menunggu.",
      },
      { status: 409 }
    );
  }

  // Akun Telegram tidak punya identitas Supabase Auth untuk dihapus; yang ada
  // hanya barisnya.
  if (target.auth_provider === "web") {
    const { error: authError } = await service.auth.admin.deleteUser(userId);

    if (authError) {
      console.error("[api/admin/users] gagal menghapus identitas login", authError);
      return NextResponse.json(
        { error: `gagal menghapus identitas login: ${authError.message}` },
        { status: 500 }
      );
    }
  }

  const { error } = await service.from("users").delete().eq("id", userId);

  if (error) {
    console.error("[api/admin/users] gagal menghapus baris users", error);
    return NextResponse.json(
      {
        error:
          "identitas login sudah dihapus, tapi barisnya gagal dihapus — " +
          "akun itu tidak bisa login lagi. Tekan Hapus sekali lagi untuk membersihkannya.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, name: target.full_name });
}
