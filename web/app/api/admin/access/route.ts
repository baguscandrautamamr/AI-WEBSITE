import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const ROLES = ["viewer", "editor", "admin"] as const;
type Role = (typeof ROLES)[number];

/**
 * Proyek tempat pemanggil berperan admin.
 *
 * Dibaca lewat klien sesi, bukan service role: policy `upa_self_read` hanya
 * mengembalikan baris milik user sendiri, jadi daftar ini tidak mungkin
 * dibesar-besarkan oleh request yang berbohong.
 */
async function adminProjectIds(supabase: ReturnType<typeof createClient>): Promise<string[]> {
  const { data } = await supabase
    .from("user_project_access")
    .select("project_id, role")
    .eq("role", "admin")
    .returns<{ project_id: string; role: Role }[]>();
  return (data ?? []).map((r) => r.project_id);
}

/** Sesi + daftar proyek yang boleh dikelola, atau respons error yang sudah jadi. */
async function requireAdmin() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  const projectIds = await adminProjectIds(supabase);
  if (projectIds.length === 0) {
    return {
      error: NextResponse.json(
        { error: "kamu bukan admin di proyek mana pun" },
        { status: 403 }
      ),
    };
  }

  return { userId: user.id, projectIds };
}

// GET — proyek yang bisa dikelola, semua user, dan akses yang sudah diberikan.
//
// Daftar user butuh service role: RLS `users_self_read` sengaja menutup baris
// orang lain, dan melonggarkannya akan membuka data itu untuk semua orang.
// Melayaninya lewat route ini menjaga kunci tetap di server dan pemeriksaan
// admin tetap di satu tempat.
export async function GET() {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const service = createServiceClient();

  const [{ data: projects }, { data: users }, { data: access }] = await Promise.all([
    service.from("projects").select("id, code, name").in("id", guard.projectIds).order("code"),
    service
      .from("users")
      .select("id, full_name, auth_provider, is_active")
      .order("full_name"),
    service
      .from("user_project_access")
      .select("user_id, project_id, role")
      .in("project_id", guard.projectIds),
  ]);

  return NextResponse.json({
    projects: projects ?? [],
    users: users ?? [],
    access: access ?? [],
  });
}

// POST — beri atau ubah peran seseorang di satu proyek.
export async function POST(req: Request) {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  let body: { userId?: string; projectId?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body harus JSON" }, { status: 400 });
  }

  const { userId, projectId, role } = body;
  if (!userId || !projectId || !role) {
    return NextResponse.json(
      { error: "`userId`, `projectId`, dan `role` wajib diisi" },
      { status: 400 }
    );
  }

  if (!ROLES.includes(role as Role)) {
    return NextResponse.json(
      { error: `role harus salah satu dari: ${ROLES.join(", ")}` },
      { status: 400 }
    );
  }

  // Admin di proyek A tidak boleh memberi akses ke proyek B.
  if (!guard.projectIds.includes(projectId)) {
    return NextResponse.json({ error: "kamu bukan admin di proyek itu" }, { status: 403 });
  }

  const { error } = await createServiceClient()
    .from("user_project_access")
    .upsert({ user_id: userId, project_id: projectId, role }, { onConflict: "user_id,project_id" });

  if (error) {
    console.error("[api/admin/access] grant failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// DELETE — cabut akses seseorang dari satu proyek.
export async function DELETE(req: Request) {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  const projectId = url.searchParams.get("projectId");

  if (!userId || !projectId) {
    return NextResponse.json({ error: "`userId` dan `projectId` wajib" }, { status: 400 });
  }

  if (!guard.projectIds.includes(projectId)) {
    return NextResponse.json({ error: "kamu bukan admin di proyek itu" }, { status: 403 });
  }

  // Seorang admin yang mencabut aksesnya sendiri akan mengunci dirinya keluar
  // dari halaman ini, dan tidak ada jalan kembali lewat UI.
  if (userId === guard.userId) {
    return NextResponse.json(
      { error: "tidak bisa mencabut akses dirimu sendiri" },
      { status: 400 }
    );
  }

  const { error } = await createServiceClient()
    .from("user_project_access")
    .delete()
    .eq("user_id", userId)
    .eq("project_id", projectId);

  if (error) {
    console.error("[api/admin/access] revoke failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
