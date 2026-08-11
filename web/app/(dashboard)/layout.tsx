import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { accessClassOf, DEFAULT_ACCESS_CLASS, type AccessClass } from "@/lib/access";
import { ProjectsProvider } from "@/lib/useProjects";
import AccessGuard from "./AccessGuard";
import DashboardNav from "./DashboardNav";

// Seluruh dashboard bergantung pada cookie sesi. Lihat catatan di app/page.tsx:
// tanpa ini, catch di bawah menelan sinyal bail-out milik Next.
export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Peran di sistem ini per-proyek (user_project_access), bukan global — orang
  // yang sama bisa editor di satu proyek dan viewer di proyek lain. Nav hanya
  // butuh tahu apakah ada SATU proyek tempat dia admin, untuk memutuskan
  // menampilkan menu admin atau tidak; izin sebenarnya tetap ditegakkan RLS
  // dan pemeriksaan peran di /api/commands.
  let roles: string[] = [];
  let signedIn = false;

  /**
   * Kelas akun, dibaca sekali di sini.
   *
   * Di layout, bukan di tiap halaman: layout ini satu-satunya tempat di seluruh
   * dashboard yang pasti berjalan di server untuk SETIAP halaman di bawahnya.
   * Halaman-halamannya sendiri komponen klien, jadi tidak ada satu pun dari
   * mereka yang bisa memeriksa ini sendiri tanpa dipecah dua.
   */
  let access: AccessClass = DEFAULT_ACCESS_CLASS;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      signedIn = true;
      const { data: granted } = await supabase
        .from("user_project_access")
        .select("role")
        .returns<{ role: "viewer" | "editor" | "admin" }[]>();
      roles = (granted ?? []).map((a) => a.role);
      access = await accessClassOf(supabase, user.id);
    }
  } catch (err) {
    // Konfigurasi atau Supabase bermasalah. Menampilkan 500 di sini menutup
    // seluruh dashboard tanpa jalan keluar; /login memberi keterangannya.
    console.error("[dashboard] gagal memuat sesi", err);
  }

  if (!signedIn) redirect("/login");

  /**
   * Sudah dimasukkan admin ke sebuah proyek, dengan peran apa pun.
   *
   * Dihitung dari daftar yang sudah diambil di atas, bukan dengan query kedua.
   * Yang dijaga olehnya cuma satu halaman — Standar — tapi justru halaman itulah
   * yang tidak punya proyek untuk dijadikan pagar, jadi tanpa ini sebuah akun
   * yang menunggu diberi akses tetap bisa membukanya.
   */
  const granted = roles.length > 0;

  const highest = roles.includes("admin")
    ? "admin"
    : roles.includes("editor")
      ? "editor"
      : "viewer";

  return (
    // Provider di layout, bukan di tiap halaman: layout bertahan lintas
    // navigasi, jadi daftar proyek diambil sekali — bukan setiap klik menu.
    <ProjectsProvider>
      {/* Menumpuk di HP, bersebelahan mulai layar sedang. Sebelumnya selalu
          bersebelahan, jadi sidebar 224px memakan lebar layar telepon dan
          sisanya terdorong keluar. */}
      <div className="flex min-h-screen flex-col md:flex-row">
        <DashboardNav role={highest} access={access} granted={granted} />

        {/* min-w-0 adalah inti perbaikannya.
            Anak sebuah flex container punya min-width:auto, artinya ia menolak
            menyusut di bawah lebar isinya. Satu tabel lebar atau satu blok kode
            panjang karena itu melebarkan seluruh halaman, dan yang terlihat
            adalah aplikasi yang bisa digeser ke kanan dengan latar kosong.
            Dengan min-w-0 ia boleh menyusut, dan isi yang lebar menggulir di
            dalam kotaknya sendiri. */}
        <main className="min-w-0 flex-1 p-4 md:p-6">
          <AccessGuard access={access} granted={granted}>
            {children}
          </AccessGuard>
        </main>
      </div>
    </ProjectsProvider>
  );
}
