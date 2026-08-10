import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "./commands";

/**
 * Peran seseorang pada satu proyek, atau null kalau dia tidak punya akses.
 *
 * Dipakai bersama oleh setiap route yang bisa menyentuh proyek — perintah,
 * chat, dan unggahan. Ditaruh di satu tempat supaya tidak ada route yang lahir
 * tanpa pemeriksaan ini: yang pertama lupa adalah `/api/files/upload`, yang
 * sempat menerima unggahan dari akun yang belum diberi proyek apa pun.
 *
 * `supabase` harus klien yang membawa sesi user, bukan service role — policy
 * `upa_self_read` hanya mengembalikan baris milik si pemanggil, jadi jawaban
 * ini tidak bisa dibesar-besarkan oleh request yang berbohong.
 */
export async function roleForProject(
  supabase: SupabaseClient,
  userId: string,
  projectId: string
): Promise<Role | null> {
  const { data } = await supabase
    .from("user_project_access")
    .select("role")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .maybeSingle();
  return (data?.role as Role) ?? null;
}
