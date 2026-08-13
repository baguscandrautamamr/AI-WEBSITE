import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { canSeeUserDirectory, guardArea, isAccessClass, isGlobalAdmin } from "@/lib/access";

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
async function adminProjectIds(supabase: SupabaseClient): Promise<string[]> {
  const { data } = await supabase
    .from("user_project_access")
    .select("project_id, role")
    .eq("role", "admin")
    .returns<{ project_id: string; role: Role }[]>();
  return (data ?? []).map((r) => r.project_id);
}

/** Sesi + daftar proyek yang boleh dikelola, atau respons error yang sudah jadi. */
async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  // Kelas akun sebelum peran proyek.
  //
  // Keduanya perlu, dan urutannya penting untuk pesan yang dibaca orangnya:
  // sebuah akun bisa berkelas standard_only DAN masih memegang baris admin dari
  // sebelum kelasnya dipersempit. Diperiksa dengan urutan terbalik, ia lolos.
  const gate = await guardArea(supabase, user.id, "grant");
  if (!gate.ok) {
    return { error: NextResponse.json({ error: gate.reason }, { status: 403 }) };
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

/**
 * Sesi saja, plus proyek yang boleh dikelola — yang boleh kosong.
 *
 * Dipakai GET, bukan requireAdmin: seorang viewer boleh melihat siapa saja
 * anggota proyeknya tanpa bisa mengubahnya, dan menolaknya dengan 403 berarti
 * halaman ini kosong bahkan untuk orang yang memang ada di dalam proyek.
 *
 * Yang TIDAK ikut longgar adalah daftar akun orang lain — lihat
 * `canSeeUserDirectory`.
 */
async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  // MELIHAT halaman ini boleh untuk kelas apa pun — termasuk standard_only, yang
  // memang diminta bisa melihat daftar anggota tanpa bisa mengubahnya. Yang
  // dijaga adalah MEMBERI, dan itu dinyatakan di sini sebagai satu boolean supaya
  // UI tidak menampilkan tombol yang pasti ditolak.
  const gate = await guardArea(supabase, user.id, "grant");

  return {
    userId: user.id,
    projectIds: await adminProjectIds(supabase),
    canGrant: gate.ok,
  };
}

/** Kolom user yang boleh keluar dari route ini. Tidak lebih dari ini. */
const USER_COLUMNS = "id, full_name, auth_provider, is_active, access_class";

/** Jumlah hasil pencarian yang dikembalikan sekali jalan. */
const SEARCH_LIMIT = 20;

/** Panjang minimal kata kunci — mencegah "a" dipakai sebagai dump terselubung. */
const SEARCH_MIN_CHARS = 2;

/** Berapa akun menunggu yang ditampilkan sekaligus. */
const PENDING_LIMIT = 50;

/**
 * Seberapa jauh ke belakang akun menunggu dicari.
 *
 * Dibatasi supaya query-nya tidak tumbuh bersama tabel `users`. Konsekuensinya
 * jujur: akun yang mendaftar sangat lama dan tidak pernah diberi akses bisa
 * lewat dari daftar ini kalau sudah ada banyak pendaftar yang lebih baru — ia
 * masih bisa ditemukan lewat pencarian nama.
 */
const PENDING_SCAN = 200;

/**
 * `%` dan `_` adalah wildcard di LIKE. Tanpa di-escape, kata kunci "%" cocok
 * dengan semua orang — persis dump yang sedang dihindari di sini.
 */
function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// GET — proyek yang bisa dikelola, akses yang sudah diberikan, dan nama-nama
// yang dibutuhkan untuk menampilkannya. Dengan `?q=`, ikut mengembalikan hasil
// pencarian user untuk ditambahkan.
//
// Data user butuh service role: RLS `users_self_read` sengaja menutup baris
// orang lain, dan melonggarkannya akan membuka data itu untuk semua orang.
//
// Yang dikembalikan sengaja dibatasi. Sebelumnya route ini mengirimkan seluruh
// tabel `users`, sehingga admin satu proyek kecil ikut menerima daftar setiap
// pengguna sistem. Sekarang ada tiga kelompok, masing-masing dengan alasannya:
//
//   members — orang yang SUDAH ada di proyek si admin. Perlu, untuk menuliskan
//             namanya di daftar anggota.
//   pending — akun yang belum punya akses ke proyek mana pun. Ini justru yang
//             harus terlihat tanpa dicari: orang yang baru mendaftar lewat
//             email tidak bisa berbuat apa-apa sampai seorang admin memberinya
//             akses, dan menyuruh admin menebak namanya lebih dulu membuat
//             pendaftaran terasa seperti rusak.
//   matches — hasil pencarian nama, untuk menambahkan orang yang sudah aktif di
//             proyek lain.
export async function GET(req: Request) {
  const guard = await requireUser();
  if ("error" in guard) return guard.error;

  const service = createServiceClient();
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();

  const [{ data: projects }, { data: access }] = await Promise.all([
    service.from("projects").select("id, code, name").in("id", guard.projectIds).order("code"),
    service
      .from("user_project_access")
      .select("user_id, project_id, role")
      .in("project_id", guard.projectIds),
  ]);

  const memberIds = [...new Set((access ?? []).map((a) => a.user_id as string))];

  const { data: members } = memberIds.length
    ? await service.from("users").select(USER_COLUMNS).in("id", memberIds).order("full_name")
    : { data: [] };

  /**
   * Boleh membaca akun DI LUAR proyeknya sendiri.
   *
   * Sampai baris ini ada, `pending` dan `matches` dikirim ke siapa pun yang
   * sudah login: sebuah akun yang baru mendaftar, belum diberi proyek apa pun,
   * cukup membuka halaman ini untuk menerima daftar 50 akun terbaru beserta id,
   * nama, kelas, dan status aktifnya. Halamannya memang tidak menampilkan
   * tombol apa pun untuknya — tapi yang bocor bukan tombolnya, melainkan
   * jawaban JSON-nya, dan itu terbaca dengan satu `curl`.
   */
  const globalAdmin = await isGlobalAdmin(service, guard.userId);
  const directory = canSeeUserDirectory({
    globalAdmin,
    canGrant: guard.canGrant,
    adminProjects: guard.projectIds.length,
  });

  const { data: matches } =
    directory && q.length >= SEARCH_MIN_CHARS
      ? await service
          .from("users")
          .select(USER_COLUMNS)
          .ilike("full_name", `%${escapeLike(q)}%`)
          .eq("is_active", true)
          .order("full_name")
          .limit(SEARCH_LIMIT)
      : { data: [] };

  // Dua izin yang berbeda, dinyatakan terpisah supaya UI tidak perlu menebaknya
  // dari daftar proyek: memberi peran di sebuah proyek (admin proyek), dan
  // mengubah kelas akun (admin global). Yang tidak boleh melakukannya tidak
  // melihat kontrolnya — bukan melihat lalu ditolak setelah menekannya.

  return NextResponse.json({
    projects: projects ?? [],
    access: access ?? [],
    members: members ?? [],
    matches: matches ?? [],
    pending: directory ? await pendingUsers(service) : [],
    searchMinChars: SEARCH_MIN_CHARS,
    // Hanya soal KELAS: apakah akun ini boleh memberi peran sama sekali.
    // Batas per-proyek tetap ditegakkan POST dan DELETE, yang memang tahu
    // proyek mana yang dimaksud — di sini belum ada proyek untuk ditanyakan.
    canGrant: guard.canGrant,
    /**
     * Membuat proyek — wewenang yang TERPISAH dari memberi peran.
     *
     * Dulu formulirnya ikut `canGrant`, dan karena kelas bawaan setiap akun
     * baru adalah 'full', formulir itu tampil untuk semua orang yang mendaftar.
     * Menekannya menjadikan mereka admin proyek, yaitu jalan pintas mengelilingi
     * seluruh pemberian akses di halaman ini.
     */
    canCreateProject: globalAdmin,
    // Barisnya sendiri tidak bisa diubah, dan UI perlu tahu baris mana itu —
    // supaya kendalinya mati sejak awal, bukan ditolak setelah ditekan.
    me: guard.userId,
    // Satu wewenang, satu nama. Ia menentukan dua hal yang keduanya berlaku
    // global — mengubah kelas akun dan menghapus akun — jadi menamainya menurut
    // salah satunya akan menyesatkan pemakai berikutnya.
    isGlobalAdmin: globalAdmin,
  });
}

/**
 * Akun yang belum punya baris di `user_project_access` sama sekali.
 *
 * Dihitung dengan dua query lalu disaring di sini, bukan dengan satu
 * `not.in.(…)`: daftar id yang sudah punya akses ikut masuk ke URL pada bentuk
 * itu, dan URL-nya tumbuh bersama jumlah pemberian akses sampai ditolak.
 */
async function pendingUsers(service: SupabaseClient) {
  const [{ data: granted }, { data: recent }] = await Promise.all([
    service.from("user_project_access").select("user_id"),
    service
      .from("users")
      .select(`${USER_COLUMNS}, created_at`)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(PENDING_SCAN),
  ]);

  const hasAccess = new Set((granted ?? []).map((row) => row.user_id as string));

  return (recent ?? [])
    .filter((user) => !hasAccess.has(user.id as string))
    .slice(0, PENDING_LIMIT);
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

  // Sejak route ini juga dipakai untuk MENGUBAH peran — ia upsert, jadi memberi
  // ulang dengan peran lain mengganti yang ada — ia bisa dipakai menurunkan peran
  // sendiri. Seorang admin yang menjadikan dirinya viewer kehilangan halaman ini,
  // dan tidak ada jalan kembali lewat UI. Alasan yang sama dengan larangan
  // mencabut akses sendiri di DELETE.
  if (userId === guard.userId) {
    return NextResponse.json(
      { error: "tidak bisa mengubah peranmu sendiri" },
      { status: 400 }
    );
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

/**
 * Admin GLOBAL — `users.role = 'admin'`, bukan admin sebuah proyek.
 *
 * Pembedaan ini bukan kerapian: kelas akun berlaku untuk SELURUH akun, di semua
 * proyek dan di halaman yang tidak punya proyek sama sekali. Kalau yang boleh
 * mengubahnya adalah "admin di setidaknya satu proyek" — arti `requireAdmin()`
 * di atas — maka siapa pun yang membuat satu proyek sendiri (dan pembuatnya
 * otomatis jadi admin di situ) bisa menaikkan kelasnya sendiri jadi penuh. Itu
 * membuat seluruh pembatasan ini tidak berarti apa-apa.
 *
 * Dibaca dengan service role: `users_self_read` hanya mengembalikan baris
 * sendiri, dan yang ditanyakan di sini memang baris sendiri — tapi kolom `role`
 * global tidak boleh bergantung pada policy yang bisa berubah.
 */
async function requireGlobalAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  if (!(await isGlobalAdmin(createServiceClient(), user.id))) {
    return {
      error: NextResponse.json(
        { error: "hanya admin global yang boleh mengubah kelas akun" },
        { status: 403 }
      ),
    };
  }

  return { userId: user.id };
}

/**
 * PATCH — mengubah kelas akun seseorang.
 *
 * Terpisah dari POST, yang memberi PERAN pada satu proyek, karena keduanya
 * menjawab pertanyaan yang berbeda dan salah satunya berlaku global. Digabung
 * dalam satu endpoint, keduanya akan terbaca seperti hal yang sama — dan itu
 * persis kekeliruan yang membuat "standard_only" terdengar seperti peran proyek.
 */
export async function PATCH(req: Request) {
  const guard = await requireGlobalAdmin();
  if ("error" in guard) return guard.error;

  let body: { userId?: string; accessClass?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body harus JSON" }, { status: 400 });
  }

  const { userId, accessClass } = body;

  if (!userId || !isAccessClass(accessClass)) {
    return NextResponse.json(
      { error: "`userId` wajib, dan `accessClass` harus full, standard_only, atau no_standard" },
      { status: 400 }
    );
  }

  // Menurunkan kelas diri sendiri adalah cara mengunci diri keluar dari satu-
  // satunya halaman tempat kelas bisa diubah kembali. Sama dengan alasan
  // seorang admin tidak boleh mencabut aksesnya sendiri di DELETE di atas.
  if (userId === guard.userId && accessClass !== "full") {
    return NextResponse.json(
      { error: "tidak bisa mempersempit kelas akunmu sendiri" },
      { status: 400 }
    );
  }

  const { error } = await createServiceClient()
    .from("users")
    .update({ access_class: accessClass, updated_at: new Date().toISOString() })
    .eq("id", userId);

  if (error) {
    console.error("[api/admin/access] set access_class failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
