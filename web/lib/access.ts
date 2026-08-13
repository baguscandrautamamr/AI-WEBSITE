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
 *   grant    — memberi akses ke orang lain di proyek yang memang dia admini
 *
 * MEMBUAT PROYEK tidak termasuk di sini, dan itu perbaikan atas lubang yang
 * nyata. Ia dulu ikut `grant` dengan alasan "membuat proyek adalah bentuk lain
 * dari memberi akses" — benar, tapi kesimpulannya terbalik: kelas bawaan setiap
 * akun baru adalah `full`, jadi siapa pun yang mendaftar dengan email lolos
 * gerbang itu, membuat satu proyek, dan detik itu juga menjadi admin proyek
 * dengan `granted = true` — yang membuka SELURUH aplikasi untuk orang yang belum
 * pernah disetujui siapa pun. Sekarang syaratnya admin global; lihat
 * `isGlobalAdmin`.
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
 * Keadaan sebuah akun, selengkapnya yang dibutuhkan untuk memutuskan.
 *
 * Kelas saja tidak cukup, dan itu baru terlihat setelah kelas akun ada: sebuah
 * akun yang baru mendaftar berkelas `full` — itu bawaannya, dan bawaan apa pun
 * yang lain akan mencabut akses dari semua orang saat migrasinya jalan — tapi ia
 * belum diberi proyek apa pun oleh admin. Untuk halaman yang menyentuh Revit itu
 * sudah tertutup dengan sendirinya: tidak ada proyek berarti tidak ada peran,
 * dan setiap route Revit menuntut peran.
 *
 * Halaman Standar tidak punya proyek untuk dijadikan pagar. Jadi ia satu-satunya
 * halaman yang lolos: akun yang menunggu diberi akses, yang tidak bisa membuka
 * apa pun yang lain, tetap bisa membuka halaman itu dan memakai model bahasa di
 * belakangnya.
 */
export interface Standing {
  access: AccessClass;
  /** Admin sudah memberi akun ini setidaknya satu proyek, dengan peran apa pun. */
  granted: boolean;
}

/**
 * Keputusan sebenarnya: kelas DAN sudah-diberi-akses.
 *
 * `standard_only` dikecualikan dari syarat proyek, dan itu bukan celah — itu
 * artinya kelas itu. Kelas itu sendiri adalah pemberian akses yang eksplisit:
 * seorang admin memilihnya untuk akun tertentu, dan yang dipilihnya adalah
 * "orang ini boleh bertanya soal standar, tanpa proyek". Menuntut proyek untuk
 * kelas itu berarti menuntut hal yang kelas itu ada untuk menghindarinya.
 */
export function canOpenArea(standing: Standing, area: Area): boolean {
  if (!canOpen(standing.access, area)) return false;
  if (area !== "standard") return true;
  return standing.access === "standard_only" || standing.granted;
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
 * Sebab yang berbeda, dan karena itu kalimat yang berbeda.
 *
 * "Kelas akunmu tidak mencakup halaman ini" salah untuk akun yang menunggu:
 * kelasnya justru mencakupnya, yang belum ada adalah pemberian aksesnya. Dan
 * yang membacanya perlu tahu bedanya, karena yang harus ia lakukan berbeda —
 * bukan minta kelasnya diubah, melainkan minta dimasukkan ke sebuah proyek.
 */
export const DENIED_WAITING =
  "akunmu belum diberi akses proyek, jadi belum ada halaman yang bisa dibuka. " +
  "Minta admin memasukkanmu ke sebuah proyek dulu.";

/**
 * Membuat proyek ditolak — dan alasannya disebut, bukan disamarkan.
 *
 * Orang yang menekannya sedang mencoba mulai bekerja, bukan menyusup. Kalimat
 * ini harus menyebutkan apa yang harus ia lakukan berikutnya, karena tidak ada
 * apa pun di halaman itu yang bisa ia lakukan sendiri.
 */
export const DENIED_CREATE_PROJECT =
  "hanya admin sistem yang boleh membuat proyek. Minta admin membuat proyeknya " +
  "lalu memasukkanmu ke dalamnya.";

/**
 * Boleh melihat daftar akun orang lain — nama, kelas, aktif atau tidak.
 *
 * Dipisahkan dari "boleh membuka halaman admin", dan itu bukan kerapian: GET
 * `/api/admin/access` sempat mengembalikan daftar `pending` — sampai 50 akun
 * lain beserta id dan kelasnya — kepada SIAPA PUN yang sudah login, karena
 * penjaganya hanya menuntut sesi. Sebuah akun yang belum diberi apa pun bisa
 * membaca direktori pengguna sistem dari halaman yang tidak menampilkan tombol
 * apa-apa untuknya.
 *
 * Yang berhak adalah orang yang memang akan MENAMBAHKAN seseorang: admin di
 * setidaknya satu proyek (dan kelasnya masih boleh memberi), atau admin global.
 */
export function canSeeUserDirectory(opts: {
  globalAdmin: boolean;
  canGrant: boolean;
  adminProjects: number;
}): boolean {
  return opts.globalAdmin || (opts.canGrant && opts.adminProjects > 0);
}

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

  if (!canOpen(access, area)) return { ok: false, access, reason: DENIED[area] };

  // Hanya untuk `standard`, dan hanya kalau perlu: bagian lain sudah tertutup
  // oleh peran proyek masing-masing, dan satu query tambahan pada setiap
  // pengiriman perintah adalah biaya untuk pemeriksaan yang tidak menambah apa
  // pun.
  if (area === "standard" && access !== "standard_only") {
    if (!(await hasAnyProject(supabase, userId))) {
      return { ok: false, access, reason: DENIED_WAITING };
    }
  }

  return { ok: true, access };
}

/**
 * Apakah admin sudah memasukkan akun ini ke setidaknya satu proyek.
 *
 * Klien sesi, jadi `upa_self_read` yang menentukan barisnya — jawaban ini tidak
 * bisa dibesar-besarkan oleh permintaan yang berbohong. `head: true` supaya yang
 * dikirim balik hanya jumlahnya: yang ditanyakan bukan proyek mana, hanya apakah
 * ada.
 */
export async function hasAnyProject(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { count } = await supabase
    .from("user_project_access")
    .select("project_id", { count: "exact", head: true })
    .eq("user_id", userId);

  return (count ?? 0) > 0;
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

/**
 * Admin GLOBAL — `users.role = 'admin'`, bukan admin sebuah proyek.
 *
 * Pembedaan ini bukan kerapian. "Admin di setidaknya satu proyek" adalah syarat
 * yang bisa dipenuhi siapa pun: membuat proyek menjadikan pembuatnya admin di
 * situ. Jadi apa pun yang berlaku GLOBAL — kelas akun, menghapus akun — tidak
 * boleh bergantung pada syarat itu, atau ia bukan syarat sama sekali.
 *
 * Butuh service role: `users_self_read` hanya mengembalikan baris sendiri, dan
 * meski yang ditanyakan di sini memang baris sendiri, peran global tidak boleh
 * bergantung pada policy yang bisa berubah.
 *
 * `is_active` ikut diperiksa di sini walaupun belum diperiksa saat login — akun
 * yang sudah dinonaktifkan tidak boleh tetap memegang wewenang yang paling luas.
 */
export async function isGlobalAdmin(
  service: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { data } = await service
    .from("users")
    .select("role, is_active")
    .eq("id", userId)
    .maybeSingle();

  const row = data as { role?: unknown; is_active?: unknown } | null;
  return row?.role === "admin" && row?.is_active !== false;
}

/**
 * Peran global menurut baris sendiri, dibaca dengan klien sesi.
 *
 * Untuk MENGGAMBAR, bukan untuk mengizinkan. Menu Admin harus tetap ada bagi
 * admin sistem yang belum punya proyek satu pun — di pemasangan baru dialah
 * satu-satunya yang bisa membuat proyek pertama, dan menu yang disembunyikan
 * darinya berarti tidak ada jalan masuk sama sekali. Layout adalah Server
 * Component tanpa service role, dan `users_self_read` memang mengembalikan
 * baris ini.
 *
 * Yang MENGIZINKAN tetap `isGlobalAdmin` di route, dengan service role. Nilai
 * di sini paling jauh bisa membuat sebuah tautan muncul; setiap tombol di
 * baliknya diperiksa ulang di server.
 */
export async function selfIsGlobalAdmin(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("users")
    .select("role, is_active")
    .eq("id", userId)
    .maybeSingle();

  const row = data as { role?: unknown; is_active?: unknown } | null;
  return row?.role === "admin" && row?.is_active !== false;
}
