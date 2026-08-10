/**
 * Family Revit per kategori, dari model yang sedang terbuka.
 *
 * `model_info` mengembalikan `family_types` — peta kategori ke nama tipe yang
 * benar-benar ada di file .rvt. Yang tidak pernah dijanjikan siapa pun adalah
 * EJAAN kunci-kunci peta itu: add-in menamainya menurut kategori Revit
 * ("Lighting Fixtures", "lighting_fixtures", "lighting"), sementara form di sini
 * menamai kolomnya menurut argumen perintah (`fixture_type`).
 *
 * Sebelum file ini, jalan dari kolom ke daftar adalah membuang akhiran `_type`
 * dari nama kolom: `fixture_type` → `fixture`. Kunci itu tidak pernah ada, jadi
 * daftarnya selalu kosong dan kolom "Tipe armatur" selalu jatuh kembali menjadi
 * kotak teks — persis kolom yang seluruh gunanya adalah TIDAK boleh diketik dari
 * ingatan. Nama family yang salah satu huruf pun tidak ditolak di sini; ia
 * ditolak Revit, beberapa menit kemudian, dengan gambar yang tetap kosong.
 *
 * Jadi kategorinya sekarang dinyatakan di katalog perintah, dan pencocokan
 * kuncinya dibuat tahan ejaan: huruf besar-kecil, spasi, garis bawah, dan
 * bentuk jamak diabaikan.
 */

export type FamilyCategory =
  | "lighting"
  | "lighting_device"
  | "receptacle"
  | "fire_alarm"
  | "telephone"
  | "lan"
  | "security"
  | "communication"
  | "hanger"
  | "cable_tray";

/**
 * Ejaan lain yang mungkin dipakai add-in untuk kategori yang sama.
 *
 * Daftar ini sengaja longgar. Kunci yang tidak dikenali berarti dropdown-nya
 * hilang dan kolomnya kembali jadi kotak teks — kegagalan yang sunyi, jenis yang
 * baru ketahuan setelah sebuah perintah gagal di Revit. Menebak satu ejaan
 * tambahan tidak memakan biaya apa pun.
 */
const ALIASES: Record<FamilyCategory, string[]> = {
  lighting: [
    "lighting",
    "lighting_fixture",
    "lighting_fixtures",
    "light_fixture",
    "lightingfixtures",
    "fixture",
    "lights",
    "lamp",
    "armatur",
    "lampu",
  ],
  lighting_device: [
    "lighting_device",
    "lighting_devices",
    "lightingdevices",
    "switch",
    "switches",
    "saklar",
  ],
  receptacle: [
    "receptacle",
    "receptacles",
    "electrical_fixture",
    "electrical_fixtures",
    "electricalfixtures",
    "outlet",
    "outlets",
  ],
  fire_alarm: [
    "fire_alarm",
    "fire_alarms",
    "fire_alarm_device",
    "fire_alarm_devices",
    "firealarmdevices",
  ],
  telephone: ["telephone", "telephones", "telephone_device", "telephone_devices"],
  lan: ["lan", "data", "data_device", "data_devices", "datadevices", "network"],
  security: ["security", "security_device", "security_devices", "securitydevices", "cctv"],
  communication: [
    "communication",
    "communications",
    "communication_device",
    "communication_devices",
    "communicationdevices",
  ],
  hanger: ["hanger", "hangers", "cable_tray_hanger", "duct_hanger", "pipe_hanger"],
  cable_tray: ["cable_tray", "cable_trays", "cabletrays", "tray"],
};

/**
 * Nama family-nya saja, dari sebuah entri `model_info`.
 *
 * Add-in melaporkan tipe dalam bentuk tampilan Revit: `Family: Type` —
 * "ACT_E_DOWNLIGHT 22WATT: DOWNLIGHT 22 WATT". Yang dikirim balik sebagai
 * argumen TIDAK boleh berbentuk itu: perintah dengan
 * `fixture_type="ACT_E_DOWNLIGHT 22WATT: DOWNLIGHT 22 WATT"` berjalan tanpa
 * galat, melaporkan sepuluh armatur terpasang, dan yang benar-benar dipasang
 * adalah family bawaan add-in — RECESSED 600x600, bukan downlight yang diminta.
 * Kegagalan pencocokan namanya tidak diteruskan ke mana pun; ia hanya jadi
 * gambar yang salah.
 *
 * Yang dikirim sekarang bagian sebelum titik dua, dan itu bentuk yang sama
 * dengan contoh di katalog (`fixture_type=act_e_downlight`).
 */
export function familyNameOf(entry: string): string {
  const cut = entry.indexOf(":");
  return (cut === -1 ? entry : entry.slice(0, cut)).trim();
}

/**
 * Family per kategori — satu baris per family, bukan satu per tipe.
 *
 * Yang dipilih orang dan yang dikirim ke add-in adalah nama family, jadi dua
 * tipe dari family yang sama tidak boleh muncul sebagai dua pilihan yang
 * mengirim nilai yang persis sama.
 */
export interface RevitFamily {
  /** Nama family — inilah yang dikirim sebagai argumen. */
  name: string;
  /** Nama tipe di dalamnya, seperti dilaporkan model_info. */
  types: string[];
}

export function familiesFor(
  familyTypes: Record<string, string[]> | undefined | null,
  category: string | undefined | null
): RevitFamily[] {
  const grouped = new Map<string, string[]>();

  for (const entry of familyTypesFor(familyTypes, category)) {
    const name = familyNameOf(entry);
    if (!name) continue;
    const cut = entry.indexOf(":");
    const type = cut === -1 ? "" : entry.slice(cut + 1).trim();

    const types = grouped.get(name) ?? [];
    if (type && !types.includes(type)) types.push(type);
    grouped.set(name, types);
  }

  return [...grouped].map(([name, types]) => ({ name, types }));
}

/** Huruf dan angka saja, tanpa akhiran jamak — supaya "Lighting Fixtures" = "lighting_fixture". */
function normalize(key: string): string {
  const flat = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return flat.endsWith("s") ? flat.slice(0, -1) : flat;
}

/**
 * Nama tipe family untuk satu kategori, kosong kalau modelnya belum dibaca atau
 * kategori itu memang tidak punya family apa pun di file ini.
 */
export function familyTypesFor(
  familyTypes: Record<string, string[]> | undefined | null,
  category: string | undefined | null
): string[] {
  if (!familyTypes || !category) return [];

  const wanted = new Set<string>([normalize(category)]);
  for (const alias of ALIASES[category as FamilyCategory] ?? []) wanted.add(normalize(alias));

  const found: string[] = [];
  for (const [key, names] of Object.entries(familyTypes)) {
    if (!Array.isArray(names) || !wanted.has(normalize(key))) continue;
    for (const name of names) {
      if (typeof name === "string" && name.trim() && !found.includes(name)) found.push(name);
    }
  }
  return found;
}

/** Kategori mana saja yang benar-benar punya family di model ini. */
export function categoriesWithFamilies(
  familyTypes: Record<string, string[]> | undefined | null
): FamilyCategory[] {
  return (Object.keys(ALIASES) as FamilyCategory[]).filter(
    (category) => familyTypesFor(familyTypes, category).length > 0
  );
}
