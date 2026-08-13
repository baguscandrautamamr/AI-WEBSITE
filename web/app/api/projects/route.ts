import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { DENIED_CREATE_PROJECT, isGlobalAdmin } from "@/lib/access";
import { rateLimit, tooManyRequests } from "@/lib/rateLimit";

export const runtime = "nodejs";

/** 10 proyek per jam per user — jauh di atas kerja normal, cukup untuk menahan salah pencet berulang. */
const PROJECTS_PER_HOUR = 10;

const MAX_NAME = 120;
const MAX_CODE = 40;

/**
 * Kode proyek dari namanya.
 *
 * `code` unik dan ikut terlihat di daftar, jadi ia diturunkan dari nama supaya
 * orang tidak perlu memikirkan dua hal untuk satu proyek. Huruf, angka, dan
 * tanda hubung saja: kode ini dipakai bot Telegram dan muncul di pesan.
 */
function codeFrom(name: string) {
  const slug = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_CODE - 5);
  return slug || "PROJECT";
}

/** Kode yang belum dipakai, dengan akhiran hanya kalau memang bentrok. */
async function freeCode(service: SupabaseClient, base: string) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const { data } = await service
      .from("projects")
      .select("id")
      .eq("code", candidate)
      .maybeSingle();
    if (!data) return candidate;
  }
  // Dua puluh nama yang sama adalah kejadian yang cukup aneh untuk pantas
  // dijawab dengan kode yang jelas-jelas dibuat mesin.
  return `${base}-${Date.now().toString(36).toUpperCase()}`;
}

// POST — membuat proyek baru. HANYA admin global (users.role = 'admin').
//
// Route ini pernah terbuka untuk siapa pun yang sudah login, dengan alasan yang
// terdengar masuk akal: tanpa itu proyek baru hanya bisa lahir dari SQL editor.
// Yang tidak dihitung adalah apa yang dilakukannya di baris-baris bawah — ia
// menulis `user_project_access` dengan peran ADMIN untuk pembuatnya. Jadi
// urutan ini terbuka bagi siapa saja yang punya alamat email:
//
//   daftar → login → POST /api/projects → admin proyek → `granted` → seluruh
//   aplikasi terbuka, termasuk halaman yang menyentuh model Revit orang lain
//
// Kelas akun tidak menahannya, karena kelas bawaan setiap akun baru adalah
// 'full'. Yang menahannya sekarang adalah peran global, dan peran itu tidak
// bisa diberikan lewat aplikasi ini kepada diri sendiri: ia hanya diubah lewat
// SQL editor (lihat supabase/README.md).
//
// Pembuatnya tetap jadi admin proyek itu — kalau tidak, ia baru saja membuat
// sesuatu yang tidak bisa ia kelola. Admin global lain ikut diberi baris admin
// di proyek yang sama: RLS di seluruh sistem membaca user_project_access, jadi
// "admin bisa melihat dan mengakses penuh" harus berupa baris yang benar-benar
// ada, bukan pengecualian yang ditambal di setiap query.
export async function POST(req: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const service = createServiceClient();

  // Service role, bukan klien sesi: yang ditanyakan adalah wewenang paling luas
  // di sistem ini, dan jawabannya tidak boleh bergantung pada policy RLS yang
  // bisa berubah. `isGlobalAdmin` juga memeriksa is_active, jadi akun yang sudah
  // dinonaktifkan tidak lagi bisa membuat apa pun.
  if (!(await isGlobalAdmin(service, user.id))) {
    return NextResponse.json({ error: DENIED_CREATE_PROJECT }, { status: 403 });
  }

  const limit = rateLimit(`project:${user.id}`, PROJECTS_PER_HOUR, 60 * 60 * 1000);
  if (!limit.ok) return tooManyRequests(limit);

  let body: { name?: string; client?: string; location?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body harus JSON" }, { status: 400 });
  }

  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "nama proyek wajib diisi" }, { status: 400 });
  }
  if (name.length > MAX_NAME) {
    return NextResponse.json(
      { error: `nama proyek maksimal ${MAX_NAME} karakter` },
      { status: 400 }
    );
  }

  const { data: project, error } = await service
    .from("projects")
    .insert({
      code: await freeCode(service, codeFrom(name)),
      name,
      client: (body.client ?? "").trim() || null,
      location: (body.location ?? "").trim() || null,
    })
    .select("id, code, name")
    .single();

  if (error || !project) {
    console.error("[api/projects] create failed", error);
    return NextResponse.json({ error: error?.message ?? "gagal membuat proyek" }, { status: 500 });
  }

  // Admin global ikut, supaya proyek yang dibuat siapa pun tetap terlihat dan
  // terkelola tanpa harus diminta.
  const { data: globalAdmins } = await service
    .from("users")
    .select("id")
    .eq("role", "admin")
    .eq("is_active", true);

  const adminIds = new Set<string>([user.id, ...(globalAdmins ?? []).map((a) => a.id as string)]);

  const { error: grantError } = await service.from("user_project_access").upsert(
    [...adminIds].map((userId) => ({
      user_id: userId,
      project_id: project.id as string,
      role: "admin",
    })),
    { onConflict: "user_id,project_id" }
  );

  if (grantError) {
    // Proyek tanpa satu pun admin tidak bisa dikelola oleh siapa pun dan tidak
    // muncul di daftar mana pun — lebih baik dibatalkan daripada ditinggalkan
    // sebagai baris yatim yang menempati kodenya.
    console.error("[api/projects] grant failed, rolling back", grantError);
    await service.from("projects").delete().eq("id", project.id);
    return NextResponse.json(
      { error: "proyek dibuat tapi aksesnya gagal diberikan — dibatalkan, coba lagi" },
      { status: 500 }
    );
  }

  return NextResponse.json({ project }, { status: 201 });
}
