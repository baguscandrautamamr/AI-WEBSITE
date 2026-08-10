import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProjectsProvider } from "@/lib/useProjects";
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

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      signedIn = true;
      const { data: access } = await supabase
        .from("user_project_access")
        .select("role")
        .returns<{ role: "viewer" | "editor" | "admin" }[]>();
      roles = (access ?? []).map((a) => a.role);
    }
  } catch (err) {
    // Konfigurasi atau Supabase bermasalah. Menampilkan 500 di sini menutup
    // seluruh dashboard tanpa jalan keluar; /login memberi keterangannya.
    console.error("[dashboard] gagal memuat sesi", err);
  }

  if (!signedIn) redirect("/login");

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
        <DashboardNav role={highest} />

        {/* min-w-0 adalah inti perbaikannya.
            Anak sebuah flex container punya min-width:auto, artinya ia menolak
            menyusut di bawah lebar isinya. Satu tabel lebar atau satu blok kode
            panjang karena itu melebarkan seluruh halaman, dan yang terlihat
            adalah aplikasi yang bisa digeser ke kanan dengan latar kosong.
            Dengan min-w-0 ia boleh menyusut, dan isi yang lebar menggulir di
            dalam kotaknya sendiri. */}
        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>
    </ProjectsProvider>
  );
}
