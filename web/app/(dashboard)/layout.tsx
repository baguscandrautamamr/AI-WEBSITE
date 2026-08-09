import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DashboardNav from "./DashboardNav";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Peran di sistem ini per-proyek (user_project_access), bukan global — orang
  // yang sama bisa editor di satu proyek dan viewer di proyek lain. Nav hanya
  // butuh tahu apakah ada SATU proyek tempat dia admin, untuk memutuskan
  // menampilkan menu admin atau tidak; izin sebenarnya tetap ditegakkan RLS
  // dan pemeriksaan peran di /api/commands.
  const { data: access } = await supabase
    .from("user_project_access")
    .select("role")
    .returns<{ role: "viewer" | "editor" | "admin" }[]>();

  const roles = (access ?? []).map((a) => a.role);
  const highest = roles.includes("admin")
    ? "admin"
    : roles.includes("editor")
      ? "editor"
      : "viewer";

  return (
    <div className="flex min-h-screen">
      <DashboardNav role={highest} />
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
