// Katalog command — sumbernya `docs/COMMANDS.md` di repo electrical_ai.
//
// Ini SATU-SATUNYA tempat parameter command didefinisikan di website. Halaman
// electrical dan export-import membangun formnya dari sini, jadi menambah satu
// parameter cukup diubah di file ini dan UI-nya ikut.
//
// `name` harus sama persis dengan yang dibaca add-in dari commands_queue.
// command_type di sana adalah nama kanonik tanpa garis miring, mis.
// "place_lighting" — alias Indonesia (/pasang_lampu dsb.) hanya urusan parser
// Telegram dan tidak dipakai website, karena di sini command dipilih dari
// tombol, bukan diketik.

import type { FamilyCategory } from "./families";

export type Role = "viewer" | "editor" | "admin";

export type FieldType = "text" | "number" | "integer" | "boolean" | "select" | "grid";

export interface CommandField {
  name: string;
  type: FieldType;
  /** Wajib diisi user sebelum command boleh dikirim. */
  required?: boolean;
  /** Nilai default add-in; ditampilkan sebagai placeholder, tidak ikut dikirim jika kosong. */
  default?: string | number | boolean;
  options?: string[];
  /**
   * Pilihan yang hanya bisa dijawab model yang sedang terbuka — nama Print
   * Setup dan DWG Export Setup yang tersimpan di file .rvt itu. Diisi UI dari
   * hasil /model_info, dan dibiarkan kosong kalau modelnya belum ditanya.
   *
   * Tetap boleh diketik bebas: daftarnya hanya sebaik model yang terakhir
   * dibaca, dan add-in yang menolak nama yang salah sudah menyebutkan nama apa
   * saja yang ada.
   */
  optionsFrom?: "print_setups" | "cad_setups";
  /**
   * Kolom ini berisi nama family Revit, dan daftar pilihannya adalah family
   * kategori ini yang ada di model yang sedang terbuka.
   *
   * Dinyatakan di sini, bukan diterka dari nama kolom. Terkaannya dulu
   * "buang akhiran `_type`", yang mengubah `fixture_type` jadi `fixture` —
   * kunci yang tidak pernah dikirim add-in, sehingga dropdown-nya tidak pernah
   * muncul dan kolom nama family selalu berupa kotak teks kosong.
   */
  familyCategory?: FamilyCategory;
  /**
   * Kategori family-nya ditentukan nilai kolom lain, bukan tetap.
   *
   * Untuk /modify_devices: kolom "Kategori" (`what`) yang memutuskan apakah
   * "Tipe" berarti armatur, saklar, atau kamera — jadi daftarnya harus ikut
   * berubah saat kategorinya diganti.
   */
  familyCategoryFrom?: string;
  /**
   * Kolom ini hanya berlaku kalau kolom lain bernilai salah satu dari ini.
   *
   * "Jarak dari pintu" tidak berarti apa-apa untuk /modify_devices yang sedang
   * menata ulang armatur; kolom yang tetap terlihat di situ hanya mengundang
   * angka yang lalu ikut terkirim untuk kategori yang tidak memakainya.
   */
  showWhen?: { field: string; is: string[] };
  min?: number;
  max?: number;
  /** Keterangan singkat di bawah field. */
  hint?: { id: string; en: string };
  label: { id: string; en: string };
}

export interface CommandSpec {
  /** command_type yang ditulis ke commands_queue. */
  name: string;
  label: { id: string; en: string };
  description: { id: string; en: string };
  /** Peran minimum yang boleh menjalankan. */
  role: Role;
  /** Kelompok tab di UI. */
  group: "device" | "layout" | "read" | "export";
  /** Argumen posisional pertama (mis. nama ruangan) — dikirim di command_json. */
  positional?: CommandField;
  fields: CommandField[];
  /** Perlu konfirmasi sebelum dikirim (lihat COMMANDS.md: delete & undo). */
  confirm?: boolean;
  /**
   * Tidak muncul sebagai tombol berformulir.
   *
   * Untuk command yang argumennya tidak bisa diketik manusia — import_excel
   * butuh URL file yang baru ada setelah diunggah — sehingga halamannya
   * menyediakan alurnya sendiri. Tetap ada di katalog ini karena /api/commands
   * hanya menerima nama yang terdaftar, dan validasinya tetap berlaku.
   */
  hidden?: boolean;
  example: string;
}

const room = (labelId: string, labelEn: string): CommandField => ({
  name: "room",
  type: "text",
  required: true,
  label: { id: labelId, en: labelEn },
  hint: {
    // Room maupun Space MEP sama-sama diterima add-in, dan itu perlu disebut:
    // model MEP yang ruangannya dibuat sebagai Space dulu terbaca seolah tidak
    // punya ruangan sama sekali, dan tidak ada apa pun di form ini yang
    // memberi tahu bahwa itulah sebabnya.
    id: "Tulis persis seperti di gambar, termasuk nomornya — mis. \"meeting 1\". Room maupun Space MEP sama-sama bisa. Isi `*` untuk SEMUA ruangan di model, atau beberapa nama dipisah koma; masing-masing jadi perintahnya sendiri.",
    en: "Type it exactly as on the drawing, including its number — e.g. \"meeting 1\". Either a Room or an MEP Space works. Use `*` for EVERY room in the model, or several names separated by commas; each becomes its own command.",
  },
});

const height = (def: number): CommandField => ({
  name: "height",
  type: "number",
  default: def,
  min: 0,
  max: 20,
  label: { id: "Ketinggian (m)", en: "Height (m)" },
});

const mounting = (def: string): CommandField => ({
  name: "mounting",
  type: "select",
  default: def,
  options: ["ceiling", "wall", "floor"],
  label: { id: "Pemasangan", en: "Mounting" },
});

/**
 * Jarak saklar dari tepi daun pintu.
 *
 * 300 mm adalah standarnya, dan itu yang dipakai add-in kalau kolom ini
 * dibiarkan kosong — jadi kolom ini bukan kewajiban baru, ia cara menyebut angka
 * LAIN untuk ruangan yang memang menuntutnya (daun pintu ganda, dinding yang
 * terlalu pendek, kusen yang lebih lebar dari biasanya).
 *
 * Sengaja tanpa `default`: nilai default ikut terisi di formulir dan karenanya
 * ikut terkirim setiap kali, dan argumen yang selalu terkirim adalah argumen
 * yang harus dimengerti add-in versi apa pun. Kosong = perilaku hari ini,
 * persis.
 */
const doorOffset = (showWhen?: CommandField["showWhen"]): CommandField => ({
  name: "door_offset",
  type: "number",
  min: 0,
  max: 3000,
  showWhen,
  label: { id: "Jarak dari pintu (mm)", en: "Distance from door (mm)" },
  hint: {
    id: "Standar 300 mm dari tepi daun pintu. Kosongkan untuk memakai standar itu.",
    en: "The standard is 300 mm from the door leaf. Leave empty to use it.",
  },
});

/**
 * Family Revit yang dipakai perangkat ini, dipilih dari model yang terbuka.
 *
 * Ada di SETIAP perintah perangkat, bukan hanya lampu dan saklar. Kolom "Tipe"
 * di sebelahnya bukan pengganti: ia daftar tertutup yang menyatakan MAKSUD —
 * `double_grounded`, `dual`, `dome` — dan add-in menerjemahkannya ke family
 * bawaannya sendiri. Family mana yang benar untuk sebuah proyek adalah
 * keputusan yang hanya bisa diambil dari isi file .rvt-nya, dan sampai kolom ini
 * ada, satu-satunya cara menyatakannya untuk enam dari delapan kategori adalah
 * tidak ada sama sekali.
 *
 * Kosong berarti add-in memakai bawaannya, persis seperti sebelumnya — jadi
 * perintah yang tidak menyentuh kolom ini berjalan sama seperti kemarin.
 */
const family = (category: FamilyCategory): CommandField => ({
  name: "family",
  type: "text",
  familyCategory: category,
  label: { id: "Family Revit", en: "Revit family" },
  hint: {
    id: "Dipilih dari family yang benar-benar ada di model. Kosongkan untuk memakai bawaan add-in.",
    en: "Picked from the families actually loaded in the model. Leave empty to use the add-in's default.",
  },
});

export const COMMANDS: CommandSpec[] = [
  // ---------------------------------------------------------------- devices
  {
    name: "place_lighting",
    label: { id: "Pasang Lampu", en: "Place Lighting" },
    description: {
      id: "Menyebar armatur pada grid plafon sesuai target lux, lalu membagi bebannya ke beberapa sirkuit.",
      en: "Places fixtures on a ceiling grid sized to hit a lux target, then splits the load across circuits.",
    },
    role: "editor",
    group: "device",
    positional: room("Ruangan", "Room"),
    fields: [
      {
        name: "count",
        type: "integer",
        min: 1,
        max: 500,
        label: { id: "Jumlah", en: "Count" },
        hint: {
          id: "Kosongkan agar dihitung dari target lux. Gridnya disusun otomatis dari jumlah ini.",
          en: "Leave empty to size it from the lux target. The grid is derived from this count.",
        },
      },
      {
        name: "grid",
        type: "grid",
        label: { id: "Grid (kolom x baris)", en: "Grid (columns x rows)" },
        hint: {
          id: "Kosongkan saja — disusun otomatis dari jumlah, hasil kalinya persis sama dengan jumlahnya.",
          en: "Leave it empty — derived from the count so the layout holds exactly that many points.",
        },
      },
      height(2.8),
      {
        name: "lux_target",
        type: "number",
        default: 300,
        min: 50,
        max: 2000,
        label: { id: "Target lux", en: "Lux target" },
      },
      {
        name: "fixture_type",
        type: "text",
        // Sengaja tanpa default.
        //
        // Dulu "LED_15W" — nama yang enak dibaca dan tidak ada di model mana
        // pun. Karena form mengisi nilai awalnya dari default katalog, nama itu
        // IKUT TERKIRIM setiap kali orang tidak menyentuh kolomnya, jadi
        // perintah yang tampak lengkap berangkat membawa family yang tidak ada.
        // Kosong berarti add-in memakai family bawaannya sendiri — satu-satunya
        // pihak di rantai ini yang tahu apa yang benar-benar termuat di file.
        familyCategory: "lighting",
        label: { id: "Tipe armatur", en: "Fixture type" },
        hint: {
          id: "Nama family di Revit. Kosongkan untuk memakai bawaan add-in.",
          en: "Revit family name. Leave empty to use the add-in's own default.",
        },
      },
      mounting("ceiling"),
      {
        name: "space",
        type: "number",
        label: { id: "Luas (m²)", en: "Space (m²)" },
        hint: {
          id: "Kosongkan agar dibaca dari space Revit.",
          en: "Leave empty to read it off the Revit space.",
        },
      },
    ],
    example: "/place_lighting Lounge count=6 height=3 fixture_type=act_e_downlight",
  },
  {
    name: "place_lighting_device",
    label: { id: "Pasang Saklar", en: "Place Switch" },
    description: {
      id: "Saklar dan dimmer — kategori Lighting Devices, bukan armatur. Default-nya di samping pintu, 300 mm dari tepi daun pintu.",
      en: "Switches and dimmers — the Lighting Devices category, not fixtures. Defaults beside the door, 300 mm from the door leaf.",
    },
    role: "editor",
    group: "device",
    positional: room("Ruangan", "Room"),
    fields: [
      {
        name: "type",
        type: "select",
        default: "single_gang",
        options: [
          "single_gang",
          "double_gang",
          "three_gang",
          "four_gang",
          "two_way",
          "dimmer",
          "occupancy_sensor",
        ],
        label: { id: "Tipe", en: "Type" },
        hint: { id: "three_gang = \"S3\" di gambar.", en: "three_gang is the \"S3\" on the drawing." },
      },
      family("lighting_device"),
      { name: "count", type: "integer", default: 1, min: 1, max: 50, label: { id: "Jumlah", en: "Count" } },
      height(1.2),
      {
        name: "placement",
        type: "select",
        default: "door",
        options: ["door", "walls", "manual"],
        label: { id: "Penempatan", en: "Placement" },
      },
      doorOffset(),
      {
        name: "controls",
        type: "text",
        label: { id: "Mengendalikan", en: "Controls" },
        hint: { id: "id sirkuit, mark armatur, atau nama grup.", en: "A circuit id, fixture mark, or group name." },
      },
    ],
    example: "/place_lighting_device Meeting_1 type=three_gang count=1 controls=LF-001",
  },
  {
    name: "place_receptacle",
    label: { id: "Pasang Stop Kontak", en: "Place Receptacle" },
    description: {
      id: "Beban yang dilaporkan dibaca dari data listrik outlet di Revit (Apparent Load), bukan dari angka desain.",
      en: "The reported load comes from the outlet's own electrical data in Revit (Apparent Load), not a design figure.",
    },
    role: "editor",
    group: "device",
    positional: room("Ruangan", "Room"),
    fields: [
      {
        name: "count",
        type: "integer",
        required: true,
        min: 1,
        max: 200,
        label: { id: "Jumlah", en: "Count" },
      },
      {
        name: "type",
        type: "select",
        default: "double_grounded",
        options: ["single", "double", "grounded", "double_grounded", "gfci", "20a"],
        label: { id: "Tipe", en: "Type" },
      },
      family("receptacle"),
      height(0.4),
      {
        name: "placement",
        type: "select",
        default: "walls",
        options: ["walls", "perimeter", "manual"],
        label: { id: "Penempatan", en: "Placement" },
      },
      {
        name: "load_per_outlet",
        type: "number",
        label: { id: "Beban per outlet (W)", en: "Load per outlet (W)" },
        hint: {
          id: "Hanya untuk beban yang tidak dinyatakan family-nya.",
          en: "Only for a load the family does not state.",
        },
      },
      { name: "breaker_size", type: "number", default: 20, label: { id: "Breaker (A)", en: "Breaker (A)" } },
      {
        name: "circuit_type",
        type: "select",
        default: "general",
        options: ["general", "dedicated"],
        label: { id: "Jenis sirkuit", en: "Circuit type" },
      },
      { name: "voltage", type: "number", default: 230, label: { id: "Tegangan (V)", en: "Voltage (V)" } },
    ],
    example: "/place_receptacle Office_A count=4 type=double_grounded height=0.4",
  },
  {
    name: "place_fire_alarm",
    label: { id: "Pasang Fire Alarm", en: "Place Fire Alarm" },
    description: {
      id: "Jarak sesuai NFPA 72, alamat loop otomatis, kepatuhan dilaporkan per aturan.",
      en: "NFPA 72 spacing, addressable loop assignment, compliance reported per rule.",
    },
    role: "editor",
    group: "device",
    positional: room("Ruangan", "Room"),
    fields: [
      {
        name: "loop_id",
        type: "text",
        required: true,
        label: { id: "Loop ID", en: "Loop ID" },
        hint: { id: "mis. FD-Loop-01", en: "e.g. FD-Loop-01" },
      },
      {
        name: "type",
        type: "select",
        default: "dual",
        options: ["smoke", "heat", "dual", "manual_call_point"],
        label: { id: "Tipe", en: "Type" },
      },
      family("fire_alarm"),
      {
        name: "standard",
        type: "select",
        default: "NFPA_72",
        options: ["NFPA_72", "SNI_3985"],
        label: { id: "Standar", en: "Standard" },
      },
      { name: "address", type: "text", default: "auto", label: { id: "Alamat", en: "Address" } },
      mounting("ceiling"),
      {
        name: "count",
        type: "integer",
        min: 1,
        label: { id: "Jumlah", en: "Count" },
        hint: {
          id: "Jika diisi, jumlah ini yang dipakai — kepatuhannya tetap dilaporkan.",
          en: "A stated count is obeyed; compliance is still reported against it.",
        },
      },
      {
        name: "coverage_target",
        type: "number",
        default: 100,
        label: { id: "Target cakupan (%)", en: "Coverage target (%)" },
      },
      {
        name: "roof_pitch_deg",
        type: "number",
        default: 0,
        label: { id: "Kemiringan atap (°)", en: "Roof pitch (°)" },
        hint: { id: "Di atas 14° memicu aturan apex.", en: "Above 14° triggers apex rules." },
      },
    ],
    example: "/place_fire_alarm Office_A type=dual loop_id=FD-Loop-01 mounting=ceiling",
  },
  {
    name: "place_telephone",
    label: { id: "Pasang Telepon", en: "Place Telephone" },
    description: { id: "Outlet telepon / data.", en: "Telephone and data outlets." },
    role: "editor",
    group: "device",
    positional: room("Ruangan", "Room"),
    fields: [
      { name: "count", type: "integer", required: true, min: 1, label: { id: "Jumlah", en: "Count" } },
      {
        name: "type",
        type: "select",
        default: "data_voice",
        options: ["data", "voice", "data_voice"],
        label: { id: "Tipe", en: "Type" },
      },
      family("telephone"),
      height(0.4),
    ],
    example: "/place_telephone Office_A type=data_voice count=2",
  },
  {
    name: "place_lan",
    label: { id: "Pasang LAN", en: "Place LAN" },
    description: {
      id: "Port dialokasikan dari yang pertama kosong; PoE dilaporkan terhadap anggaran switch 740 W.",
      en: "Ports are allocated from the first free one; PoE reports against a 740 W switch budget.",
    },
    role: "editor",
    group: "device",
    positional: room("Ruangan", "Room"),
    fields: [
      { name: "count", type: "integer", required: true, min: 1, label: { id: "Jumlah", en: "Count" } },
      {
        name: "type",
        type: "select",
        default: "1Gbps",
        options: ["1Gbps", "10Gbps", "PoE"],
        label: { id: "Tipe", en: "Type" },
      },
      family("lan"),
      { name: "poe_enabled", type: "boolean", default: false, label: { id: "PoE aktif", en: "PoE enabled" } },
      { name: "switch_panel", type: "text", default: "SW-01", label: { id: "Panel switch", en: "Switch panel" } },
      height(0.4),
    ],
    example: "/place_lan Office_A count=4 type=1Gbps poe_enabled=true",
  },
  {
    name: "place_security",
    label: { id: "Pasang CCTV", en: "Place Security" },
    description: {
      id: "Resolusi menentukan jangkauan berguna (2MP/4MP/8MP → 12/18/25 m).",
      en: "Resolution drives useful range (2MP/4MP/8MP → 12/18/25 m).",
    },
    role: "editor",
    group: "device",
    positional: room("Ruangan", "Room"),
    fields: [
      {
        name: "type",
        type: "select",
        default: "camera",
        options: ["camera", "motion_sensor", "door_sensor"],
        label: { id: "Tipe", en: "Type" },
      },
      family("security"),
      {
        name: "camera_type",
        type: "select",
        default: "dome",
        options: ["dome", "turret", "bullet"],
        label: { id: "Jenis kamera", en: "Camera type" },
      },
      {
        name: "resolution",
        type: "select",
        default: "4MP",
        options: ["2MP", "4MP", "8MP"],
        label: { id: "Resolusi", en: "Resolution" },
      },
      { name: "coverage_fov", type: "number", default: 90, label: { id: "Sudut pandang (°)", en: "Coverage FOV (°)" } },
      { name: "count", type: "integer", default: 1, min: 1, label: { id: "Jumlah", en: "Count" } },
      { name: "zone_id", type: "text", label: { id: "Zona", en: "Zone" } },
    ],
    example: "/place_security Lobby type=camera camera_type=dome resolution=4MP count=2",
  },
  {
    name: "place_communication",
    label: { id: "Pasang Speaker", en: "Place Communication" },
    description: { id: "Speaker, antena, mikrofon untuk sistem PA / intercom / emergency.", en: "Speakers, antennas, microphones for PA / intercom / emergency systems." },
    role: "editor",
    group: "device",
    positional: room("Ruangan", "Room"),
    fields: [
      {
        name: "type",
        type: "select",
        default: "speaker",
        options: ["speaker", "antenna", "microphone"],
        label: { id: "Tipe", en: "Type" },
      },
      family("communication"),
      {
        name: "system",
        type: "select",
        default: "pa",
        options: ["pa", "intercom", "emergency"],
        label: { id: "Sistem", en: "System" },
      },
      { name: "quantity", type: "integer", default: 1, min: 1, label: { id: "Jumlah", en: "Quantity" } },
      { name: "coverage_radius", type: "number", label: { id: "Radius cakupan (m)", en: "Coverage radius (m)" } },
      { name: "panel", type: "text", label: { id: "Panel", en: "Panel" } },
    ],
    example: "/place_communication Lobby type=speaker system=pa quantity=3",
  },

  // ---------------------------------------------------------------- layout
  {
    name: "create_cable_tray",
    label: { id: "Buat Cable Tray", en: "Create Cable Tray" },
    description: {
      id: "Dua cara menentukan jalur: antara dua titik (from/to), atau mengikuti garis yang sudah digambar (follow). Salah satu wajib.",
      en: "Two ways to say where it goes: between two named places (from/to), or along lines already drawn (follow). One is required.",
    },
    role: "editor",
    group: "layout",
    positional: {
      name: "tray_id",
      type: "text",
      required: true,
      label: { id: "ID Tray", en: "Tray ID" },
      hint: { id: "mis. CT-A1", en: "e.g. CT-A1" },
    },
    fields: [
      { name: "from", type: "text", label: { id: "Dari", en: "From" }, hint: { id: "mis. panel PA-01", en: "e.g. panel PA-01" } },
      { name: "to", type: "text", label: { id: "Ke", en: "To" }, hint: { id: "mis. Zone_A", en: "e.g. Zone_A" } },
      {
        name: "follow",
        type: "text",
        label: { id: "Ikuti line style", en: "Follow line style" },
        hint: {
          id: "mis. \"Thin Lines\" — satu tray per garis lurus, elbow di tiap sudut. Busur dilewati.",
          en: "e.g. \"Thin Lines\" — one tray per straight, an elbow at each corner. Arcs are skipped.",
        },
      },
      {
        name: "size",
        type: "text",
        default: "auto",
        label: { id: "Ukuran", en: "Size" },
        hint: { id: "auto atau mis. 300x300", en: "auto or e.g. 300x300" },
      },
      {
        name: "cable_type",
        type: "select",
        default: "power",
        options: ["power", "data", "mixed"],
        label: { id: "Jenis kabel", en: "Cable type" },
      },
      {
        name: "material",
        type: "select",
        default: "aluminum",
        options: ["aluminum", "steel", "stainless"],
        label: { id: "Material", en: "Material" },
      },
      {
        name: "installation",
        type: "select",
        default: "ceiling",
        options: ["ceiling", "wall", "floor"],
        label: { id: "Pemasangan", en: "Installation" },
      },
      {
        name: "hanger_spacing",
        type: "number",
        default: 1500,
        min: 100,
        max: 6000,
        label: { id: "Jarak hanger (mm)", en: "Hanger spacing (mm)" },
      },
      { name: "fill_target", type: "number", default: 50, label: { id: "Target isi (%)", en: "Fill target (%)" } },
      {
        name: "preserve_existing",
        type: "boolean",
        default: true,
        label: { id: "Pertahankan hanger lama", en: "Preserve existing hangers" },
      },
      {
        name: "hanger_family",
        type: "text",
        familyCategory: "hanger",
        label: { id: "Family hanger", en: "Hanger family" },
      },
    ],
    example: "/create_cable_tray CT-A1 follow=\"Thin Lines\" size=300x300",
  },
  {
    name: "add_hangers",
    label: { id: "Tambah Hanger", en: "Add Hangers" },
    description: { id: "Menggantung tray yang sudah ada. Mesin sama, tanpa routing.", en: "Hangs a tray that already exists. Same engine, no routing." },
    role: "editor",
    group: "layout",
    positional: { name: "tray_id", type: "text", label: { id: "ID Tray (opsional)", en: "Tray ID (optional)" } },
    fields: [
      { name: "spacing", type: "number", default: 1500, min: 100, max: 6000, label: { id: "Jarak (mm)", en: "Spacing (mm)" } },
      {
        name: "mode",
        type: "select",
        default: "fill",
        options: ["fill", "replace"],
        label: { id: "Mode", en: "Mode" },
      },
      { name: "preserve_existing", type: "boolean", default: true, label: { id: "Pertahankan yang ada", en: "Preserve existing" } },
      {
        name: "hanger_family",
        type: "text",
        familyCategory: "hanger",
        label: { id: "Family hanger", en: "Hanger family" },
      },
    ],
    example: "/add_hangers CT-A1 spacing=1500",
  },
  {
    name: "equip_room",
    label: { id: "Lengkapi Ruangan", en: "Equip Room" },
    description: {
      id: "Menjalankan semua kategori pada satu ruangan. Gagal di satu kategori tidak membatalkan sisanya. Isi 0 untuk melewati kategori.",
      en: "Runs every category against one room. A failure in one does not abort the rest. Set any count to 0 to skip it.",
    },
    role: "editor",
    group: "layout",
    positional: room("Ruangan", "Room"),
    fields: [
      height(2.8),
      { name: "lux_target", type: "number", default: 300, label: { id: "Target lux", en: "Lux target" } },
      { name: "switches", type: "integer", default: 1, min: 0, label: { id: "Saklar", en: "Switches" } },
      { name: "outlets", type: "integer", default: 4, min: 0, label: { id: "Stop kontak", en: "Outlets" } },
      { name: "phone_jacks", type: "integer", default: 2, min: 0, label: { id: "Jack telepon", en: "Phone jacks" } },
      { name: "lan_jacks", type: "integer", default: 4, min: 0, label: { id: "Jack LAN", en: "LAN jacks" } },
      { name: "security_cameras", type: "integer", default: 2, min: 0, label: { id: "Kamera", en: "Cameras" } },
      { name: "speakers", type: "integer", default: 2, min: 0, label: { id: "Speaker", en: "Speakers" } },
      { name: "fire_alarm", type: "text", default: "auto", label: { id: "Fire alarm", en: "Fire alarm" }, hint: { id: "auto atau none", en: "auto or none" } },
      { name: "cable_tray", type: "boolean", default: true, label: { id: "Cable tray", en: "Cable tray" } },
      { name: "hanger_spacing", type: "number", default: 1500, label: { id: "Jarak hanger (mm)", en: "Hanger spacing (mm)" } },
    ],
    example: "/equip_room Office_A outlets=4 lan_jacks=4 fire_alarm=auto",
  },
  {
    name: "modify_devices",
    label: { id: "Modifikasi", en: "Modify Devices" },
    description: {
      id: "Menata ulang satu kategori di satu ruangan. Mengganti, bukan menggeser — set lama dikeluarkan, set baru dipasang. Salah satu dari jumlah atau grid wajib.",
      en: "Re-lays out one category in one room. It replaces rather than edits. One of count or grid is required.",
    },
    role: "editor",
    group: "layout",
    positional: room("Ruangan", "Room"),
    fields: [
      {
        name: "what",
        type: "select",
        default: "lighting",
        options: [
          "lighting",
          "lighting_device",
          "receptacle",
          "fire_alarm",
          "telephone",
          "lan",
          "security",
          "communication",
        ],
        label: { id: "Kategori", en: "Category" },
      },
      {
        name: "count",
        type: "integer",
        min: 1,
        label: { id: "Jumlah baru", en: "New count" },
        hint: {
          id: "Gridnya disusun otomatis dari jumlah ini.",
          en: "The grid is derived from this count.",
        },
      },
      { name: "grid", type: "grid", label: { id: "Grid baru", en: "New grid" } },
      { name: "height", type: "number", label: { id: "Ketinggian (m)", en: "Height (m)" } },
      {
        name: "fixture_type",
        type: "text",
        // Daftarnya mengikuti kolom "Kategori" di sebelahnya: mengubah kategori
        // ke `security` harus mengubah pilihannya jadi kamera, bukan armatur.
        familyCategoryFrom: "what",
        label: { id: "Tipe / family", en: "Type / family" },
      },
      doorOffset({ field: "what", is: ["lighting_device"] }),
    ],
    example: "/modify_devices Meeting_1 what=lighting grid=2x3",
  },
  {
    name: "delete_devices",
    label: { id: "Hapus Perangkat", en: "Delete Devices" },
    description: {
      id: "Menghapus satu kategori dari satu ruangan. Ruangan DAN kategori dua-duanya wajib — sengaja dipersempit.",
      en: "Removes one category from one room. Both the room and a category are required — deliberately narrow.",
    },
    role: "editor",
    group: "layout",
    confirm: true,
    positional: room("Ruangan", "Room"),
    fields: [
      {
        name: "what",
        type: "select",
        default: "all",
        options: [
          "all",
          "lighting",
          "lighting_device",
          "receptacle",
          "fire_alarm",
          "telephone",
          "lan",
          "security",
          "communication",
        ],
        label: { id: "Kategori", en: "Category" },
      },
      {
        name: "marks",
        type: "text",
        label: { id: "Mark tertentu saja", en: "Only these marks" },
        hint: {
          id: "Dipisah koma, mis. LF-001,LF-002. Kosongkan untuk seluruh kategori di ruangan itu. Ini yang dipakai tombol \"Batalkan perintah ini\".",
          en: "Comma separated, e.g. LF-001,LF-002. Leave empty for the whole category in that room. This is what the \"Undo this command\" button uses.",
        },
      },
    ],
    example: "/delete_devices Pantry what=lighting",
  },
  {
    name: "undo",
    label: { id: "Batalkan", en: "Undo" },
    description: {
      id: "Menghapus apa yang ditambahkan penempatan terakhirmu. Menyasar mark, bukan ruangan — jadi perangkat yang ditambah orang lain tetap aman. Tidak bisa membatalkan penghapusan.",
      en: "Removes what your last placement added. Aimed at marks, not a room. It will not reverse a delete.",
    },
    role: "editor",
    group: "layout",
    confirm: true,
    fields: [],
    example: "/undo",
  },

  // ------------------------------------------------------------------ read
  {
    name: "query",
    label: { id: "Cek Model", en: "Query" },
    description: {
      // Angka-angka ini sudah dilaporkan add-in sejak lama dan tidak pernah
      // disebutkan di sini — jadi asisten menjawab "tidak ada tool untuk
      // mengukur panjang tray" untuk sesuatu yang sudah ia punya. Kemampuan
      // yang tidak tertulis di deskripsi tool adalah kemampuan yang tidak
      // pernah dipakai.
      id: "Membaca model dan melaporkan apa yang sudah ada, per kategori tetap. Bisa disaring per ruangan, per lantai, DAN per family (`family=`) — jadi \"berapa downlight 22W di lantai 1\" dijawab perintah ini, bukan dengan jumlah seluruh armatur. Ikut melaporkan TOTAL: meter untuk cable_tray, watt untuk lighting, m² untuk room. Tidak membuka transaksi Revit, jadi viewer boleh menjalankannya. Untuk kategori atau parameter di luar daftar ini, pakai /inspect.",
      en: "Reads the model and reports what is there, per fixed category. It filters by room, by level, AND by family (`family=`) — so \"how many 22W downlights on level 1\" is answered here, not with a count of every fixture. It also reports TOTALS: metres for cable_tray, watts for lighting, m² for room. Opens no Revit transaction. For categories or parameters outside this list, use /inspect.",
    },
    role: "viewer",
    group: "read",
    positional: {
      name: "room",
      type: "text",
      label: { id: "Ruangan (opsional)", en: "Room (optional)" },
      hint: { id: "Kosongkan untuk seluruh model.", en: "Leave empty to search the whole model." },
    },
    fields: [
      {
        name: "what",
        type: "select",
        default: "all",
        options: [
          "all",
          "lighting",
          "lighting_device",
          "receptacle",
          "cable_tray",
          "hanger",
          "fire_alarm",
          "telephone",
          "lan",
          "security",
          "communication",
          "panel",
          "room",
          "sheet",
        ],
        label: { id: "Kategori", en: "What" },
      },
      { name: "level", type: "text", label: { id: "Lantai", en: "Level" }, hint: { id: "mis. \"Level 1\"", en: "e.g. \"Level 1\"" } },
      {
        name: "family",
        type: "text",
        // Daftarnya mengikuti kolom "Kategori" di atasnya, sama seperti pada
        // /modify_devices: `what=lighting` berarti pilihannya family armatur,
        // `what=security` berarti kamera. `all` tidak punya daftar — dan memang
        // tidak seharusnya, karena satu family tidak berarti apa-apa untuk
        // sebelas kategori sekaligus.
        familyCategoryFrom: "what",
        label: { id: "Family (opsional)", en: "Family (optional)" },
        hint: {
          id: "Hitung hanya family ini. Kosongkan untuk seluruh kategori.",
          en: "Count only this family. Leave empty for the whole category.",
        },
      },
      {
        name: "detail",
        type: "select",
        default: "summary",
        options: ["summary", "list"],
        label: { id: "Rincian", en: "Detail" },
      },
      { name: "limit", type: "integer", default: 30, min: 1, max: 500, label: { id: "Batas item", en: "Limit" } },
    ],
    example: "/query Office_A what=lighting family=\"ACT_E_DOWNLIGHT 22WATT\" detail=list",
  },
  {
    name: "inspect",
    label: { id: "Baca Model", en: "Inspect Model" },
    description: {
      id: "Membaca APA PUN di model — kategori apa saja yang ada, parameter apa saja yang dimiliki sebuah kategori, lalu barisnya sendiri dengan kolom yang kamu sebut. Kolom Family, Type, Level, dan Room selalu ada dan bisa disaring (`where`) maupun dikelompokkan (`group_by`), jadi \"di ruangan ini family apa saja dan berapa\" satu perintah. `category` boleh beberapa dipisah koma, dan `where` boleh beberapa syarat dipisah koma yang semuanya harus terpenuhi. Tidak membuka transaksi Revit.",
      en: "Reads ANYTHING in the model — which categories exist, what a category can be asked about, then the rows themselves with the columns you name. The Family, Type, Level, and Room columns always exist and can be filtered on (`where`) and grouped by (`group_by`), so \"which families are in this room, and how many\" is one command. `category` takes several, comma separated, and `where` takes several conditions, comma separated, all of which must hold. Opens no Revit transaction.",
    },
    role: "viewer",
    group: "read",
    fields: [
      {
        name: "what",
        type: "select",
        default: "elements",
        options: ["categories", "parameters", "elements"],
        label: { id: "Mode", en: "Mode" },
        hint: {
          // Urutan ini bukan saran gaya. Sebuah parameter harus disebut namanya
          // dengan tepat untuk bisa dibaca, dan nama yang belum pernah dilihat
          // tidak bisa disebut — jadi dua mode pertama adalah cara sampai ke
          // yang ketiga, bukan pelengkapnya.
          id: "Mulai dari categories, lalu parameters, baru elements. Nama parameter harus persis; yang belum pernah dilihat tidak bisa ditebak.",
          en: "Start with categories, then parameters, then elements. A parameter name must be exact, and one never seen cannot be guessed.",
        },
      },
      {
        name: "category",
        type: "text",
        label: { id: "Kategori", en: "Category" },
        hint: {
          id: "Nama Revit (\"Doors\"), nama OST (\"OST_Doors\"), atau kata pendek yang dipakai perintah lain (\"lighting\"). BOLEH BEBERAPA, dipisah koma — mis. \"lighting, lighting_device, receptacle\". Wajib untuk parameters dan elements.",
          en: "A Revit name (\"Doors\"), an OST name (\"OST_Doors\"), or the short key the other commands use (\"lighting\"). SEVERAL are allowed, comma separated — e.g. \"lighting, lighting_device, receptacle\". Required for parameters and elements.",
        },
        showWhen: { field: "what", is: ["parameters", "elements"] },
      },
      {
        name: "params",
        type: "text",
        label: { id: "Kolom", en: "Columns" },
        hint: {
          id: "Dipisah koma, mis. Mark,Type,Length. Kosongkan untuk Id, Mark, Type, Level. Ambil namanya dari mode parameters.",
          en: "Comma separated, e.g. Mark,Type,Length. Leave empty for Id, Mark, Type, Level. Take the names from the parameters mode.",
        },
        showWhen: { field: "what", is: ["elements"] },
      },
      {
        name: "where",
        type: "text",
        label: { id: "Saringan", en: "Filter" },
        hint: {
          id: "Syarat: Width>800, Mark~LF-, Comments!=. Pakai ~ untuk \"mengandung\". BOLEH BEBERAPA dipisah koma, semuanya harus terpenuhi — mis. \"Family=ACT_E_DOWNLIGHT 22WATT, Width>800\". Kolom Family, Type, Level, dan Room ikut bisa disaring.",
          en: "Conditions: Width>800, Mark~LF-, Comments!=. Use ~ for \"contains\". SEVERAL are allowed, comma separated, all of which must hold — e.g. \"Family=ACT_E_DOWNLIGHT 22WATT, Width>800\". The Family, Type, Level, and Room columns can be filtered on too.",
        },
        showWhen: { field: "what", is: ["elements"] },
      },
      {
        name: "total",
        type: "text",
        label: { id: "Jumlahkan", en: "Sum" },
        hint: {
          id: "Nama parameter angka, dipisah koma — mis. Length. Dihitung atas SEMUA yang cocok, bukan atas baris yang tampil, dan dalam satuan proyek.",
          en: "Numeric parameter names, comma separated — e.g. Length. Computed over EVERYTHING that matched, not the rows shown, and in the project's units.",
        },
        showWhen: { field: "what", is: ["elements"] },
      },
      {
        name: "group_by",
        type: "text",
        label: { id: "Kelompokkan menurut", en: "Group by" },
        hint: {
          id: "Satu nama parameter — mis. Family, Type, Level, atau Room. Hasilnya berapa elemen per nilai.",
          en: "One parameter name — e.g. Family, Type, Level, or Room. The result is how many elements per value.",
        },
        showWhen: { field: "what", is: ["elements"] },
      },
      {
        name: "room",
        type: "text",
        label: { id: "Ruangan", en: "Room" },
        showWhen: { field: "what", is: ["elements"] },
      },
      {
        name: "level",
        type: "text",
        label: { id: "Lantai", en: "Level" },
        hint: { id: "mis. \"Level 1\"", en: "e.g. \"Level 1\"" },
        showWhen: { field: "what", is: ["elements"] },
      },
      {
        name: "limit",
        type: "integer",
        default: 30,
        min: 1,
        max: 200,
        label: { id: "Batas baris", en: "Row limit" },
        showWhen: { field: "what", is: ["elements"] },
      },
    ],
    example: "/inspect what=elements category=lighting room=\"LOUNGE 5\" where=\"Family=ACT_E_DOWNLIGHT 22WATT\" group_by=Type",
  },
  {
    name: "list_sheets",
    label: { id: "Daftar Sheet", en: "List Sheets" },
    description: {
      id: "Menampilkan sheet beserta nomornya. Nomor inilah yang dipakai Print PDF. Sheet placeholder tidak ikut.",
      en: "Lists the sheets with their numbers — exactly what print_pdf takes. Placeholder sheets are left out.",
    },
    role: "viewer",
    group: "export",
    fields: [],
    example: "/list_sheets",
  },
  {
    name: "print_pdf",
    label: { id: "Cetak PDF", en: "Print PDF" },
    description: {
      id: "Mencetak sheet jadi PDF, dipilih lewat nomor di kop gambar. Bukan hal yang sama dengan Export format=pdf, yang menulis laporan kepatuhan.",
      en: "Prints sheets to PDF by title-block number. Not the same as export format=pdf, which writes the compliance report.",
    },
    role: "viewer",
    group: "export",
    positional: {
      name: "sheets",
      type: "text",
      required: true,
      label: { id: "Sheet", en: "Sheets" },
      hint: {
        id: "Satu nomor, daftar dipisah koma, pola seperti E-1*, atau all.",
        en: "A number, a comma-separated list, a pattern like E-1*, or all.",
      },
    },
    fields: [
      {
        name: "combine",
        type: "boolean",
        default: true,
        label: { id: "Gabung jadi satu PDF", en: "Combine into one PDF" },
      },
      {
        name: "setup",
        type: "select",
        optionsFrom: "print_setups",
        label: { id: "Print setup", en: "Print setup" },
        hint: {
          id: "Setup yang tersimpan di model. Kosongkan untuk memakai bawaan Revit. Ukuran kertas tidak diambil dari setup — tiap kop gambar sudah menentukannya.",
          en: "A setup saved in the model. Leave empty for Revit's defaults. Paper size is not taken from the setup — each title block already states it.",
        },
      },
    ],
    example: "/print_pdf E-101,E-102 combine=true",
  },
  {
    name: "export_cad",
    label: { id: "Export DWG", en: "Export DWG" },
    description: {
      id: "Mengekspor sheet terpilih jadi DWG memakai DWG Export Setup yang tersimpan di model. Berbeda dengan Export format=dwg, yang mengekspor view yang sedang aktif.",
      en: "Exports the chosen sheets to DWG using a DWG Export Setup saved in the model. Not the same as Export format=dwg, which exports whichever view is active.",
    },
    role: "viewer",
    group: "export",
    positional: {
      name: "sheets",
      type: "text",
      required: true,
      label: { id: "Sheet", en: "Sheets" },
      hint: {
        id: "Satu nomor, daftar dipisah koma, pola seperti E-1*, atau all.",
        en: "A number, a comma-separated list, a pattern like E-1*, or all.",
      },
    },
    fields: [
      {
        name: "setup",
        type: "select",
        optionsFrom: "cad_setups",
        label: { id: "CAD export setup", en: "CAD export setup" },
        hint: {
          id: "Setup yang tersimpan di model — inilah yang menentukan layer, ketebalan garis, dan teks. Kosongkan hanya kalau memang mau bawaan Revit.",
          en: "A setup saved in the model — this is what decides layers, line weights, and text. Leave empty only if Revit's defaults are really what you want.",
        },
      },
    ],
    example: "/export_cad E-101,E-102 setup=\"DWG 2018\"",
  },
  {
    name: "model_info",
    label: { id: "Info Model", en: "Model info" },
    description: {
      id: "Melaporkan file .rvt yang sedang terbuka beserta nama print setup dan CAD export setup yang tersimpan di dalamnya.",
      en: "Reports the .rvt open right now, along with the print and CAD export setups saved inside it.",
    },
    role: "viewer",
    group: "read",
    hidden: true,
    fields: [],
    example: "/model_info",
  },
  {
    name: "export",
    label: { id: "Export", en: "Export" },
    description: {
      id: "Menulis schedule atau laporan kepatuhan ke Excel, PDF, DWG, DXF, atau IFC.",
      en: "Writes a schedule or the compliance report to Excel, PDF, DWG, DXF, or IFC.",
    },
    role: "viewer",
    group: "export",
    fields: [
      {
        name: "type",
        type: "select",
        default: "all",
        options: [
          "all",
          "lighting_schedule",
          "lighting_device_schedule",
          "receptacle_schedule",
          "cable_tray",
          "hanger_schedule",
          "fire_alarm_schedule",
          "telephone_schedule",
          "lan_schedule",
          "security_schedule",
          "communication_schedule",
          "panel_schedule",
          "compliance_report",
        ],
        label: { id: "Jenis", en: "Type" },
      },
      {
        name: "format",
        type: "select",
        default: "excel",
        options: ["excel", "pdf", "dwg", "dxf", "ifc"],
        label: { id: "Format", en: "Format" },
      },
    ],
    example: "/export type=hanger_schedule format=excel",
  },
  {
    name: "import_excel",
    label: { id: "Import Excel", en: "Import Excel" },
    description: {
      id: "Menulis isi spreadsheet kembali ke model. Kolom `Element Id` atau `Mark` menentukan elemennya; kolom lain dianggap nama parameter. Bentuknya sama dengan yang ditulis Export, jadi hasil export bisa disunting lalu dikirim balik.",
      en: "Writes a spreadsheet back into the model. An `Element Id` or `Mark` column identifies each row's element; every other column is a parameter name. Same shape Export writes, so an export can be edited and sent back.",
    },
    role: "editor",
    group: "export",
    hidden: true,
    fields: [
      {
        name: "file_url",
        type: "text",
        required: true,
        label: { id: "URL file", en: "File URL" },
        hint: {
          id: "Diisi otomatis setelah file diunggah.",
          en: "Filled in automatically once the file is uploaded.",
        },
      },
      {
        name: "sheet",
        type: "text",
        label: { id: "Nama sheet", en: "Sheet name" },
        hint: { id: "Kosongkan untuk memakai sheet pertama.", en: "Leave empty to use the first sheet." },
      },
      {
        name: "dry_run",
        type: "boolean",
        default: false,
        label: { id: "Uji coba saja", en: "Dry run" },
        hint: {
          id: "Menjalankan perubahannya lalu membatalkannya — untuk melihat apa yang akan terjadi.",
          en: "Runs the changes then rolls them back — to see what would happen.",
        },
      },
    ],
    example: "/import_excel file_url=… dry_run=true",
  },
  {
    name: "import_table",
    label: { id: "Import Tabel", en: "Import Table" },
    description: {
      id: "Menggambar isi spreadsheet apa adanya ke sebuah view Revit — lebar kolom, tinggi baris, dan sel yang di-merge ikut. Hasilnya gambar dari tabelnya, bukan schedule yang membaca model.",
      en: "Draws a spreadsheet into a Revit view as it stands — column widths, row heights, and merged cells included. The result is a picture of the table, not a schedule that reads the model.",
    },
    role: "editor",
    group: "export",
    hidden: true,
    fields: [
      {
        name: "file_url",
        type: "text",
        required: true,
        label: { id: "URL file", en: "File URL" },
        hint: {
          id: "Diisi otomatis setelah file diunggah.",
          en: "Filled in automatically once the file is uploaded.",
        },
      },
      {
        name: "target",
        type: "select",
        default: "schedule",
        options: ["schedule", "legend", "schedule_view"],
        label: { id: "Masuk ke", en: "Place in" },
        hint: {
          id: "schedule = drafting view baru, hanya bisa ditaruh di satu sheet. legend = legend view, bisa dipakai ulang di banyak sheet. schedule_view = Schedules/Quantities yang sebenarnya.",
          en: "schedule = a new drafting view, placeable on one sheet only. legend = a legend view, reusable across many sheets. schedule_view = a real Schedules/Quantities view.",
        },
      },
      {
        name: "sheet",
        type: "text",
        label: { id: "Sheet Excel", en: "Excel sheet" },
        hint: {
          id: "Kosongkan untuk memakai sheet pertama yang ada isinya.",
          en: "Leave empty to use the first sheet with anything on it.",
        },
      },
      {
        name: "name",
        type: "text",
        label: { id: "Nama view", en: "View name" },
        hint: {
          id: "Kosongkan untuk memakai nama sheet Excel-nya.",
          en: "Leave empty to use the Excel sheet's own name.",
        },
      },
    ],
    example: "/import_table file_url=… target=legend",
  },
];

/**
 * Uji coba, pada setiap perintah yang mengubah model.
 *
 * import_excel sudah punya ini sejak awal; perintah perangkat belum, dan itu
 * ketimpangan yang mahal. Satu kalimat yang salah tafsir — ruangan yang keliru,
 * jumlah yang kelebihan satu nol — langsung mengubah model yang sedang
 * dikerjakan orang lain, dan satu-satunya pembatalnya adalah Ctrl+Z di PC yang
 * mungkin bukan PC pengirimnya. Uji coba menjalankan perubahannya di dalam
 * transaksi lalu membatalkannya: jumlahnya terlaporkan, modelnya tidak
 * tersentuh.
 *
 * Ditambahkan di sini, bukan disalin ke tiap perintah: perintah perangkat
 * berikutnya harus ikut mendapatkannya tanpa ada yang perlu ingat
 * menambahkannya.
 */
const dryRun = (): CommandField => ({
  name: "dry_run",
  type: "boolean",
  default: false,
  label: { id: "Uji coba saja", en: "Dry run" },
  hint: {
    id: "Jalankan lalu batalkan — lihat berapa yang akan terpasang tanpa mengubah model.",
    en: "Run then roll back — see how many would be placed without changing the model.",
  },
});

for (const spec of COMMANDS) {
  const changesModel = spec.group === "device" || spec.name === "delete_devices";
  const alreadyHas = spec.fields.some((f) => f.name === "dry_run");
  if (changesModel && !alreadyHas) spec.fields.push(dryRun());
}

export const COMMANDS_BY_NAME: Record<string, CommandSpec> = Object.fromEntries(
  COMMANDS.map((c) => [c.name, c])
);

/** Kategori yang bisa ditata ulang /modify_devices, diambil dari katalog sendiri. */
export const MODIFY_CATEGORIES: string[] =
  COMMANDS_BY_NAME.modify_devices?.fields.find((f) => f.name === "what")?.options ?? [];

/**
 * Kategori /modify_devices yang setara dengan sebuah perintah `place_*`.
 *
 * Dipakai untuk memutuskan hal yang selama ini tidak pernah diperiksa: ruangan
 * yang SUDAH punya armatur tidak boleh diberi satu set lagi di atasnya.
 * "Pasang 10 lampu" di ruangan yang sudah berisi 9 armatur berarti 19 armatur
 * bertumpuk pada satu plafon — dua grid dengan jarak yang berbeda, sirkuit
 * ganda, dan schedule yang menghitung dua kali. Yang dimaksud orangnya hampir
 * selalu "jadikan 10", dan itu /modify_devices.
 *
 * Diturunkan dari nama perintahnya (`place_lighting` → `lighting`) lalu
 * dicocokkan dengan daftar kategori yang benar-benar diterima modify — jadi
 * perintah `place_*` berikutnya ikut terlindungi tanpa ada yang perlu ingat
 * menambahkannya di sini, dan yang tidak punya padanan tetap mengembalikan null.
 */
export function modifyCategoryFor(commandName: string): string | null {
  if (!commandName.startsWith("place_")) return null;
  const category = commandName.slice("place_".length);
  return MODIFY_CATEGORIES.includes(category) ? category : null;
}

/**
 * Nilai formulir sebuah perintah `place_*` diterjemahkan jadi nilai
 * /modify_devices yang setara.
 *
 * Hanya kolom yang benar-benar diterima modify yang ikut; sisanya (target lux,
 * pemasangan, luas) memang tidak ada di sana. `quantity` ikut dibaca karena
 * /place_communication menamai jumlahnya begitu, dan `family` karena
 * /place_lighting_device menamai tipenya begitu — tanpa keduanya, pindah ke
 * modifikasi berarti kehilangan justru angka yang baru saja diketik.
 */
export function modifyValuesFrom(
  spec: CommandSpec,
  category: string,
  values: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    room: values[spec.positional?.name ?? "room"],
    what: category,
  };

  const count = values.count ?? values.quantity;
  if (count !== undefined && count !== "") out.count = count;
  if (values.grid) out.grid = values.grid;
  if (values.height !== undefined && values.height !== "") out.height = values.height;

  const family = values.fixture_type ?? values.family;
  if (family) out.fixture_type = family;

  return out;
}

/**
 * Kategori family untuk sebuah kolom, mengingat isian formulir saat ini.
 *
 * Kosong berarti kolom ini bukan kolom nama family — atau kategorinya belum bisa
 * ditentukan, seperti /modify_devices yang kolom "Kategori"-nya belum dipilih.
 */
/**
 * Kolom ini berlaku untuk isian yang sedang terisi.
 *
 * Kolom yang tidak berlaku tidak digambar DAN tidak dikirim: nilai yang
 * tertinggal dari kategori sebelumnya — jarak dari pintu yang diketik saat
 * kategorinya masih saklar, lalu kategorinya diganti jadi armatur — ikut
 * berangkat ke add-in sebagai argumen yang tidak berarti apa-apa untuk perintah
 * itu.
 */
export function fieldApplies(field: CommandField, values: Record<string, unknown>): boolean {
  if (!field.showWhen) return true;
  return field.showWhen.is.includes(String(values[field.showWhen.field] ?? ""));
}

export function familyCategoryOf(
  field: CommandField,
  values: Record<string, unknown>
): string {
  if (field.familyCategory) return field.familyCategory;
  if (!field.familyCategoryFrom) return "";

  const from = String(values[field.familyCategoryFrom] ?? "");
  return from === "all" ? "" : from;
}

const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };

/** Apakah `role` cukup untuk menjalankan command ini. */
export function canRun(spec: CommandSpec, role: Role): boolean {
  return RANK[role] >= RANK[spec.role];
}

export function commandsForGroup(group: CommandSpec["group"], role: Role): CommandSpec[] {
  return COMMANDS.filter((c) => c.group === group && !c.hidden && canRun(c, role));
}
