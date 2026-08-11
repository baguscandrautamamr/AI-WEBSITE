import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "./commands";

/**
 * Kelas akun: halaman mana yang boleh dibuka.
 *
 * Pertanyaan yang berbeda dari peran proyek, dan karena itu nilai yang berbeda
 * pula. Peran menjawab APA yang boleh dilakukan pada satu model; kelas menjawab
 * halaman mana yang ada bagi akun ini. Keduanya berlaku bersamaan — akun 'full'
 * yang di sebuah proyek hanya viewer tetap tidak boleh memasang apa pun di sana.
 */
export const ACCESS_CLASSES = ["full", "standard_only", "no_standard"] as const;
export type AccessClass = (typeof ACCESS_CLASSES)[number];

/** Kelas bawaan, dipakai kalau barisnya tidak terbaca. Lihat catatan di `accessClassOf`. */
export const DEFAULT_ACCESS_CLASS: AccessClass = "full";

export function isAccessClass(value: unknown): value is AccessClass {
  return typeof value === "string" && (ACCESS_CLASSES as readonly string[]).includes(value);
}

/**
 * Bagian aplikasi yang dijaga kelas akun.
 *
 * Tiga, bukan satu per halaman. Halaman datang dan pergi, dan daftar yang
 * disusun per halaman adalah daftar yang halaman berikutnya lupa dimasukkan —
 * lolos tanpa gejala, karena yang tidak terdaftar tidak dijaga. Yang tiga ini
 * adalah pemisahan yang benar-benar diminta:
 *
 *   standard — halaman Standar & Regulasi, dan route AI-nya
 *   revit    — semua yang menyentuh model: perintah, pembacaan, impor, ekspor,
 *              riwayat
 *   grant    — memberi akses ke orang lain, dan membuat proyek (yang memberi
 *              akses admin kepada pembuatnya, jadi ia bentuk lain dari hal yang
 *              sama)
 */
export type Area = "standard" | "revit" | "grant";

/**
 * Apakah kelas ini boleh membuka bagian itu.
 *
 * Tabelnya ditulis penuh, bukan diturunkan dari aturan: "full kecuali standar"
 * dan "hanya standar" adalah dua kalimat yang mudah diringkas jadi satu rumus
 * yang salah, dan yang salah di sini adalah halaman yang terbuka untuk akun
 * yang seharusnya tidak melihatnya.
 */
const ALLOWED: Record<AccessClass, Record<Area, boolean>> = {
  full: { standard: true, revit: true, grant: true },
  standard_only: { standard: true, revit: false, grant: false },
  no_standard: { standard: false, revit: true, grant: true },
};

export function canOpen(cls: AccessClass, area: Area): boolean {
  return ALLOWED[cls][area];
}

/**
 * Halaman mana milik bagian mana.
 *
 * `/admin/users` sengaja TIDAK ada di sini: halaman itu boleh dibuka kelas apa
 * pun. Yang dijaga di dalamnya bukan melihat, melainkan memberi akses — dan itu
 * bagian `grant`, dijaga di route-nya. Sebuah akun yang boleh melihat siapa
 * anggota proyeknya tanpa bisa mengubahnya adalah hal yang wajar; yang tidak
 * wajar adalah tombol yang ada tapi selalu ditolak, jadi tombolnya yang hilang.
 */
const AREA_BY_PREFIX: [string, Area][] = [
  ["/standard", "standard"],
  ["/electrical", "revit"],
  ["/inspect", "revit"],
  ["/import", "revit"],
  ["/export-import", "revit"],
  ["/history", "revit"],
];

/** Bagian yang dimiliki sebuah path, atau null kalau path itu tidak dijaga. */
export function areaOfPath(pathname: string): Area | null {
  // Yang terpanjang lebih dulu: `/import` adalah awalan `/import` DAN
  // `/import-something`, sementara `/export-import` bukan bagian dari `/import`.
  // Dicocokkan per segmen supaya `/importir` tidak pernah terbaca `/import`.
  for (const [prefix, area] of AREA_BY_PREFIX) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return area;
  }
  return null;
}

/** Halaman pertama yang boleh dibuka kelas ini, untuk mendarat setelah login. */
export function landingFor(cls: AccessClass): string {
  return canOpen(cls, "revit") ? "/electrical" : "/standard";
}

/**
 * Kelas akun seseorang.
 *
 * `users_self_read` dari migrasi 0001 sudah mengizinkan sebuah akun membaca
 * barisnya sendiri, jadi klien sesi cukup — dan itu yang benar: jawaban ini
 * tidak boleh bisa dibesar-besarkan oleh permintaan yang berbohong.
 *
 * Baris yang tidak terbaca dijawab 'full', sama dengan default kolomnya. Itu
 * pilihan yang perlu dinyatakan: gagal-tertutup di sini berarti satu gangguan
 * jaringan sesaat mengunci orang keluar dari halaman yang memang miliknya,
 * sementara yang benar-benar menjaga model tetap peran proyek dan RLS — dan
 * keduanya tidak ikut melunak kalau baris ini gagal dibaca.
 */
export async function accessClassOf(
  supabase: SupabaseClient,
  userId: string
): Promise<AccessClass> {
  const { data } = await supabase
    .from("users")
    .select("access_class")
    .eq("id", userId)
    .maybeSingle();

  const value = (data as { access_class?: unknown } | null)?.access_class;
  return isAccessClass(value) ? value : DEFAULT_ACCESS_CLASS;
}

/** Alasan penolakan, dalam bahasa yang dibaca orangnya — bukan nama kelasnya. */
export const DENIED: Record<Area, string> = {
  standard: "kelas akunmu tidak mencakup halaman Standar & Regulasi.",
  revit: "kelas akunmu hanya mencakup halaman Standar & Regulasi, bukan yang menyentuh model Revit.",
  grant: "hanya akun berkelas penuh yang boleh memberi akses. Kamu tetap bisa melihat daftarnya.",
};

/**
 * Penjaga kelas untuk sebuah route.
 *
 * Ada supaya tidak ada route yang lahir tanpa pemeriksaan ini — alasan yang sama
 * dengan `roleForProject` di atas, dan alasan itu bukan kehati-hatian teoretis:
 * `/api/files/upload` pernah menerima unggahan dari akun tanpa proyek apa pun,
 * karena pemeriksaannya ditulis ulang di setiap route dan yang terakhir lupa.
 *
 * Route adalah lapis yang BENAR-BENAR menjaga. Menu yang disaring dan halaman
 * yang tidak digambar hanya menghilangkan jalan yang mudah; sebuah permintaan
 * HTTP tidak melewati keduanya. Tanpa lapis ini, akun 'standard_only' masih bisa
 * memanggil /api/commands dengan curl dan menjalankan perintah di model orang.
 */
export async function guardArea(
  supabase: SupabaseClient,
  userId: string,
  area: Area
): Promise<{ ok: true; access: AccessClass } | { ok: false; access: AccessClass; reason: string }> {
  const access = await accessClassOf(supabase, userId);
  return canOpen(access, area)
    ? { ok: true, access }
    : { ok: false, access, reason: DENIED[area] };
}

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
