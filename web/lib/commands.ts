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
          id: "Kosongkan agar dihitung dari target lux. Gridnya disusun otomatis dari jumlah ini. Di ruangan yang bukan kotak, titik yang jatuh di luar batas ruangan dibuang — yang terpasang jadi lebih sedikit, dan selisihnya disebut di hasil.",
          en: "Leave empty to size it from the lux target. The grid is derived from this count. In a room that is not a rectangle, points falling outside the room boundary are dropped — fewer get placed, and the difference is named in the result.",
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
    name: "connect_circuit",
    label: { id: "Sambung ke Panel", en: "Circuit to Panel" },
    description: {
      id: "Membuat sirkuit dari perangkat yang sudah terpasang lalu menugaskannya ke sebuah panel — inilah yang membuat beban ruangan muncul di panel schedule. Sebut ruangannya dan kategorinya (armatur atau stop kontak), atau sebut ID elemennya langsung. Perangkat yang SUDAH punya sirkuit dilewati, bukan disirkuitkan dua kali. Panelnya harus cocok tegangannya; yang tidak cocok ditolak Revit dengan menyebut sebabnya, bukan disambung diam-diam.",
      en: "Builds circuits from devices already placed and assigns them to a panel — this is what makes a room's load appear in the panel schedule. Name the room and the category (fixtures or receptacles), or name the element ids directly. Devices that ALREADY have a circuit are skipped rather than circuited twice. The panel has to match on voltage; one that does not is refused by Revit with its reason, not wired up quietly.",
    },
    role: "editor",
    group: "layout",
    positional: {
      name: "room",
      type: "text",
      label: { id: "Ruangan", en: "Room" },
      hint: {
        id: "Tulis persis seperti di gambar — mis. \"LOUNGE 5\". Kosongkan kalau menyebut ID elemen.",
        en: "Type it exactly as on the drawing — e.g. \"LOUNGE 5\". Leave empty when naming element ids instead.",
      },
    },
    fields: [
      {
        name: "panel",
        type: "text",
        required: true,
        // Sengaja kotak teks, bukan dropdown. Daftar yang dikirim `model_info`
        // berisi nama FamilySymbol — tipe family — sementara nama panel adalah
        // nama INSTANCE ("PP-1"), yang tidak ada di daftar itu dan tidak bisa
        // ada di sana. Yang menutup celahnya add-in: nama panel yang tidak ada
        // ditolak sambil menyebut nama panel yang memang ada.
        label: { id: "Panel tujuan", en: "Target panel" },
        hint: {
          id: "Nama panelnya seperti di model — mis. PP-1. Cocok sebagian nama, tapi kalau lebih dari satu panel cocok, perintahnya ditolak dan menyebutkan yang mana saja.",
          en: "The panel's name as in the model — e.g. PP-1. Partial names match, but when more than one panel matches the command is refused and says which ones.",
        },
      },
      {
        name: "what",
        type: "select",
        default: "lighting",
        options: ["lighting", "receptacle"],
        label: { id: "Kategori", en: "What" },
        hint: {
          id: "Armatur (Lighting Fixtures) atau stop kontak (Electrical Fixtures). Tidak berlaku kalau ID elemen yang disebut.",
          en: "Fixtures (Lighting Fixtures) or receptacles (Electrical Fixtures). Ignored when element ids are given.",
        },
      },
      {
        name: "ids",
        type: "text",
        label: { id: "ID elemen", en: "Element IDs" },
        hint: {
          id: "Alih-alih ruangan: satu ID, atau beberapa dipisah koma. Kategorinya diabaikan — yang disirkuitkan persis elemen ini.",
          en: "Instead of a room: one id, or several separated by commas. The category is ignored — exactly these elements are circuited.",
        },
      },
      {
        name: "per_circuit",
        type: "integer",
        min: 1,
        max: 100,
        label: { id: "Perangkat per sirkuit", en: "Devices per circuit" },
        hint: {
          id: "Kosong = semuanya jadi SATU sirkuit. Isi angkanya untuk memecah — mis. 12 berarti 50 armatur jadi lima sirkuit. Add-in tidak menghitung sendiri berapa yang aman; itu keputusanmu terhadap rating breaker.",
          en: "Empty = all of them on ONE circuit. Give a number to split — 12 turns 50 fixtures into five circuits. The add-in does not work out a safe number for you; that is your call against the breaker rating.",
        },
      },
      {
        name: "dry_run",
        type: "boolean",
        default: false,
        label: { id: "Uji coba saja", en: "Dry run" },
        hint: {
          id: "Jalankan lalu batalkan — lihat berapa sirkuit yang akan terbentuk dan perangkat mana yang dilewati, tanpa mengubah model.",
          en: "Run then roll back — see how many circuits would be made and which devices would be skipped, without changing the model.",
        },
      },
    ],
    example: "/connect_circuit \"LOUNGE 5\" panel=PP-1 what=lighting per_circuit=12",
  },
  {
    name: "section_box",
    label: { id: "Section Box", en: "Section Box" },
    description: {
      id: "Mengurung view 3D pada satu ruangan atau sekumpulan elemen — sisanya model disembunyikan sampai section box-nya dimatikan lagi. Sebut ruangannya, atau ID elemennya. Beda dari perintah lain di kelompok ini: yang berubah adalah tampilan, bukan modelnya — tidak ada elemen yang dipasang, dipindahkan, atau dihapus. Tapi section box TERSIMPAN di view, jadi orang lain yang membuka view 3D itu sesudahnya akan melihat model yang terpotong. Karena itu ia menuntut peran editor, dan bisa dikembalikan dengan `off=true`.",
      en: "Boxes a 3D view onto one room or a set of elements — the rest of the model is hidden until the section box is switched off again. Name the room, or the element ids. Unlike everything else in this group what changes is the view, not the model: nothing is placed, moved, or deleted. But a section box is SAVED in the view, so whoever opens that 3D view afterwards sees a cut-down model. That is why it needs the editor role, and why `off=true` puts it back.",
    },
    role: "editor",
    group: "layout",
    positional: {
      name: "room",
      type: "text",
      label: { id: "Ruangan", en: "Room" },
      hint: {
        id: "Tulis persis seperti di gambar — mis. \"LOUNGE 5\". Room maupun Space MEP sama-sama bisa. Kosongkan kalau menyebut ID elemen, atau kalau hanya mau mematikannya.",
        en: "Type it exactly as on the drawing — e.g. \"LOUNGE 5\". Either a Room or an MEP Space works. Leave empty when naming element ids instead, or when only switching it off.",
      },
    },
    fields: [
      {
        name: "ids",
        type: "text",
        label: { id: "ID elemen", en: "Element IDs" },
        hint: {
          id: "Alih-alih ruangan: satu ID, atau beberapa dipisah koma. Kotaknya dibuat sebesar gabungan elemen-elemen itu.",
          en: "Instead of a room: one id, or several separated by commas. The box is sized to hold all of them together.",
        },
      },
      {
        name: "margin",
        type: "number",
        default: 500,
        min: 0,
        max: 10000,
        label: { id: "Jarak tepi (mm)", en: "Margin (mm)" },
        hint: {
          id: "Ruang tambahan di sekeliling kotaknya. Nol berarti kotaknya tepat menempel, dan dinding ruangan sendiri bisa ikut terpotong.",
          en: "Extra room around the box. Zero means it hugs the extent exactly, and the room's own walls can end up sliced.",
        },
      },
      {
        name: "view",
        type: "select",
        default: "3d",
        options: ["3d", "current"],
        label: { id: "Kenakan pada", en: "Apply to" },
        hint: {
          id: "3d = pindah ke view 3D (dibuat kalau model belum punya). current = view yang sedang aktif, dan ia HARUS view 3D — section box tidak ada di denah.",
          en: "3d = switch to a 3D view (created if the model has none). current = whatever view is active, and it MUST be a 3D view — plans have no section box.",
        },
      },
      {
        name: "off",
        type: "boolean",
        default: false,
        label: { id: "Matikan section box", en: "Switch the section box off" },
        hint: {
          id: "Mengembalikan view 3D jadi utuh lagi. Tidak butuh ruangan maupun ID.",
          en: "Puts the 3D view back to the whole model. Needs neither a room nor ids.",
        },
      },
    ],
    example: "/section_box \"LOUNGE 5\" margin=500",
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
  // --------------------------------------------------------------- kelistrikan
  //
  // Tiga perintah di bawah dipindahkan dari repo MCP-SERVER-BAGUS
  // (`server/src/tools/` + `commandset/`), dan namanya sengaja dipertahankan
  // persis seperti di sana. Handler C#-nya diport dari repo itu ke add-in
  // `electrical_ai`, jadi nama yang sama berarti `command.json`, nama kelas
  // EventHandler, dan kunci payload-nya berbaris satu-satu — satu tempat lebih
  // sedikit untuk salah ketik. Bentuknya memang beda dari `model_info` dan
  // `query` di sekitarnya; itu harga yang dibayar untuk ketertelusuran.
  //
  // KETIGANYA MEMBACA SAJA: tidak ada transaksi Revit yang dibuka, jadi viewer
  // boleh menjalankannya — dan itu bukan kelonggaran, itu yang membuat mereka
  // ikut memenuhi syarat `canAutoRun` di bawah, sehingga sebuah pertanyaan di
  // percakapan bisa dijawab tanpa seseorang menekan tombol tiga kali.
  //
  // Sampai add-in `electrical_ai` mengimplementasikan ketiganya, perintah dari
  // sini akan berakhir `failed` dengan "unknown command" — bukan menggantung.
  // Spesifikasi payload dan bentuk jawabannya ada di
  // `docs/addin-electrical-commands.md`.
  {
    name: "get_electrical_loads",
    label: { id: "Beban Listrik", en: "Electrical Loads" },
    description: {
      id: "Mendaftar setiap sirkuit di model beserta beban tersambung, tegangan, arus, rating breaker, dan panel tujuannya — plus total per panel dan per jenis sistem. Sirkuit yang belum punya panel ikut dilaporkan terpisah, karena itu justru yang dicari saat total panel tidak cocok. Beban dilaporkan dalam VA (semu) DAN W (nyata); keduanya berbeda sejauh faktor daya, dan menyebut satu angka saja sebagai \"beban\" adalah cara paling mudah salah ukur breaker. Model yang armaturnya ada tapi belum disirkuitkan menjawab nol di sini — itu jawaban yang benar, bukan galat.",
      en: "Lists every circuit in the model with its connected load, voltage, current, breaker rating and panel — plus totals per panel and per system type. Circuits with no panel are reported separately, which is exactly what you look for when a panel total does not add up. Loads come in VA (apparent) AND W (true); they differ by the power factor, and calling just one of them \"the load\" is the easiest way to size a breaker wrong. A model whose fixtures exist but are not circuited answers zero here — that is a real answer, not an error.",
    },
    role: "viewer",
    group: "read",
    positional: {
      name: "panel",
      type: "text",
      label: { id: "Panel (opsional)", en: "Panel (optional)" },
      hint: {
        id: "Cocok sebagian nama, tidak peduli huruf besar-kecil — \"pp-1\" kena \"PP-1 LANTAI 2\". Kosongkan untuk seluruh model.",
        en: "Matches part of the name, case-insensitively — \"pp-1\" hits \"PP-1 LANTAI 2\". Leave empty for the whole model.",
      },
    },
    fields: [
      {
        name: "system_type",
        type: "select",
        default: "all",
        // Nilai-nilai ini adalah ElectricalSystemType milik Revit, ditulis
        // snake_case supaya seragam dengan katalog ini. Pemetaannya balik ke
        // nama enum Revit dilakukan add-in, dan didaftar di spesifikasi —
        // bukan di sini, karena yang mengenal enum itu memang cuma add-in.
        options: [
          "all",
          "power",
          "lighting",
          "data",
          "telephone",
          "security",
          "fire_alarm",
          "nurse_call",
          "communication",
          "controls",
        ],
        label: { id: "Jenis sistem", en: "System type" },
      },
      {
        name: "detail",
        type: "select",
        default: "summary",
        options: ["summary", "list"],
        label: { id: "Rincian", en: "Detail" },
        hint: {
          id: "summary = total per panel dan per jenis sistem. list = setiap sirkuit satu baris.",
          en: "summary = totals per panel and per system type. list = one row per circuit.",
        },
      },
      {
        name: "limit",
        type: "integer",
        default: 200,
        min: 1,
        max: 1000,
        label: { id: "Batas sirkuit", en: "Circuit limit" },
        hint: {
          id: "Membatasi baris yang ditampilkan, BUKAN yang dihitung — totalnya tetap atas seluruh sirkuit yang cocok.",
          en: "Caps the rows shown, NOT what is counted — the totals still cover every matching circuit.",
        },
        showWhen: { field: "detail", is: ["list"] },
      },
      {
        name: "include_element_ids",
        type: "boolean",
        default: false,
        label: { id: "Sertakan ID elemen", en: "Include element IDs" },
        hint: {
          id: "ID elemen yang tersambung ke tiap sirkuit. Menggemukkan jawaban; nyalakan kalau ID-nya mau dipakai untuk menyorot di Revit.",
          en: "The element ids wired to each circuit. It bloats the answer; turn it on when you want to use those ids to highlight in Revit.",
        },
        showWhen: { field: "detail", is: ["list"] },
      },
    ],
    example: "/get_electrical_loads PP-1 system_type=power detail=list",
  },
  {
    name: "get_panel_schedule",
    label: { id: "Skedul Panel", en: "Panel Schedule" },
    description: {
      id: "Isi tiap panel: slot mana terpakai dan mana kosong, jumlah pole tiap breaker, beban tersambung per sirkuit, dan keterangan panelnya sendiri (distribution system, mains, pemasangan). MEMBACA data panelnya, bukan membuat view Panel Schedule di Revit. Setiap Electrical Equipment dihitung sebagai calon panel, jadi panel yang belum berisi apa pun tetap muncul — itu disengaja, karena panel kosong yang tidak muncul terbaca seolah tidak ada. `max_slots` dibaca dari family panelnya dan bisa saja tidak ada di sana; kalau begitu, sisa slotnya dilaporkan kosong, bukan ditebak.",
      en: "What is inside each panel: which slots are used and which are free, how many poles each breaker takes, connected load per circuit, and the panel's own metadata (distribution system, mains, mounting). It READS the panel data; it does not create a Revit Panel Schedule view. Every Electrical Equipment instance counts as a candidate panel, so panels with nothing in them still appear — deliberately, because an empty panel that does not appear reads as a panel that does not exist. `max_slots` is read from the panel family and may simply not be there; when it is missing the free-slot count is reported as unknown rather than guessed.",
    },
    role: "viewer",
    group: "read",
    positional: {
      name: "panel",
      type: "text",
      label: { id: "Panel (opsional)", en: "Panel (optional)" },
      hint: {
        id: "Cocok sebagian nama. Kosongkan untuk semua panel di model.",
        en: "Matches part of the name. Leave empty for every panel in the model.",
      },
    },
    fields: [
      {
        name: "detail",
        type: "select",
        default: "summary",
        options: ["summary", "list"],
        label: { id: "Rincian", en: "Detail" },
        hint: {
          id: "summary = satu baris per panel. list = direktori sirkuitnya, urut nomor slot.",
          en: "summary = one row per panel. list = its circuit directory, ordered by slot.",
        },
      },
      {
        name: "include_empty",
        type: "boolean",
        default: true,
        label: { id: "Ikutkan panel kosong", en: "Include empty panels" },
      },
      {
        name: "limit",
        type: "integer",
        default: 50,
        min: 1,
        max: 200,
        label: { id: "Batas panel", en: "Panel limit" },
      },
    ],
    example: "/get_panel_schedule PP-1 detail=list",
  },
  {
    name: "check_circuit_balance",
    label: { id: "Keseimbangan Fasa", en: "Circuit Balance" },
    description: {
      id: "Sebaran beban tiga fasa (R-S-T) tiap panel, diukur terhadap toleransi yang kamu sebut. PERLU DIBACA SEBELUM DIPAKAI: beban per fasa TIDAK dibaca dari Revit — Revit tidak menyimpannya. Ia DITURUNKAN: beban semu tiap sirkuit dibagi rata ke fasa yang ditempati breaker-nya, dan fasa awalnya disimpulkan dari nomor slot dengan mengandaikan susunan panelboard baku A-A-B-B-C-C. Panel yang slotnya tidak disusun begitu akan menghasilkan angka yang salah tanpa satu pun galat muncul. Asumsi itu ikut disebut di jawabannya, dan angka di sini adalah petunjuk untuk diperiksa, bukan hasil ukur.",
      en: "Three-phase load spread (R-S-T) per panel against a tolerance you name. READ BEFORE USING: per-phase load is NOT read from Revit — Revit does not store it. It is DERIVED: each circuit's apparent load is split across the phases its breaker occupies, with the starting phase inferred from the slot number assuming the standard A-A-B-B-C-C panelboard arrangement. A panel whose slots are not arranged that way will produce wrong numbers with no error anywhere. That assumption is echoed in the answer, and the figures here are a lead to check, not a measurement.",
    },
    role: "viewer",
    group: "read",
    positional: {
      name: "panel",
      type: "text",
      label: { id: "Panel (opsional)", en: "Panel (optional)" },
      hint: {
        id: "Cocok sebagian nama. Kosongkan untuk semua panel tiga fasa.",
        en: "Matches part of the name. Leave empty for every three-phase panel.",
      },
    },
    fields: [
      {
        name: "tolerance",
        type: "number",
        default: 10,
        min: 1,
        max: 50,
        label: { id: "Toleransi (%)", en: "Tolerance (%)" },
        hint: {
          id: "Selisih fasa terberat terhadap rata-rata yang masih dianggap wajar. 10% lazim dipakai; panel di atas itu ditandai.",
          en: "How far the heaviest phase may sit above the average before it counts as unbalanced. 10% is the common figure; panels above it are flagged.",
        },
      },
      {
        name: "limit",
        type: "integer",
        default: 50,
        min: 1,
        max: 200,
        label: { id: "Batas panel", en: "Panel limit" },
      },
    ],
    example: "/check_circuit_balance PP-1 tolerance=10",
  },
  {
    name: "show_element",
    label: { id: "Tunjukkan di Revit", en: "Show in Revit" },
    description: {
      id: "Membuka view 3D di Revit, memilih elemen yang ID-nya disebut, lalu menggeser layar sampai elemen itu terlihat. Tidak mengubah apa pun di model — tidak ada transaksi, tidak ada section box: yang berubah hanya view yang aktif dan apa yang tersorot di layar PC Revit.",
      en: "Opens a 3D view in Revit, selects the elements whose ids are given, then moves the screen until they are visible. It changes nothing in the model — no transaction, no section box: all that changes is the active view and what is highlighted on the Revit PC's screen.",
    },
    role: "viewer",
    group: "read",
    // Tersembunyi, dan bukan karena argumennya sulit diketik.
    //
    // `hidden` di sini menahan dua hal sekaligus. Pertama, ia menjaga
    // `canAutoRun` tetap berarti apa yang dikatakannya: perintah baca yang boleh
    // berjalan sendiri di tengah satu pertanyaan adalah perintah yang tidak
    // menimbulkan akibat di PC orang lain. Perintah ini menimbulkan akibat —
    // view aktif seseorang berpindah — jadi ia tidak boleh berangkat tanpa
    // orang itu yang memintanya. Kedua, halaman Baca Model menyediakan alurnya
    // sendiri (satu kotak isian ID), persis seperti import_excel: sebuah tombol
    // berformulir di deretan atas hanya akan jadi jalan kedua ke hal yang sama.
    //
    // Tetap terdaftar di katalog karena /api/commands hanya menerima nama yang
    // ada di sini, dan validasi ID-nya berlaku di server, bukan cuma di layar.
    hidden: true,
    positional: {
      name: "ids",
      type: "text",
      required: true,
      label: { id: "ID elemen", en: "Element IDs" },
      hint: {
        id: "Satu ID, atau beberapa dipisah koma — mis. 384210 atau 384210,384215.",
        en: "One id, or several separated by commas — e.g. 384210 or 384210,384215.",
      },
    },
    fields: [
      {
        name: "view",
        type: "select",
        default: "3d",
        options: ["3d", "current"],
        label: { id: "Tampilkan di", en: "Show in" },
        hint: {
          id: "3d = pindah ke view 3D (dibuat kalau model belum punya). current = biarkan view yang sedang aktif; elemen di luar view itu tidak akan terlihat.",
          en: "3d = switch to a 3D view (created if the model has none). current = leave the active view alone; elements outside it will not become visible.",
        },
      },
    ],
    example: "/show_element 384210 view=3d",
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
 * Perintah `place_*` yang setara dengan sebuah kategori /modify_devices —
 * arah kebalikan dari `modifyCategoryFor`.
 *
 * Ada karena pemeriksaan isi ruangan sebelumnya hanya berjalan SATU ARAH:
 * `place_*` di ruangan berisi ditawarkan jadi modifikasi, tapi `modify_devices`
 * di ruangan KOSONG berangkat apa adanya. Dan arah kedua itu justru yang terjadi
 * sesudah orangnya menghapus isinya sendiri di Revit: riwayat percakapan masih
 * menyebut ruangan itu penuh, model bahasa memilih modify seperti yang memang
 * diajarkan kepadanya, dan yang sampai ke Revit adalah perintah menata ulang
 * sesuatu yang sudah tidak ada.
 *
 * Yang dialami orangnya sama persis dengan gejala yang lain: perintahnya
 * berangkat, tidak ada galat, dan tidak ada satu pun armatur yang terpasang.
 */
export function placeCommandFor(category: string): CommandSpec | null {
  return COMMANDS_BY_NAME[`place_${category}`] ?? null;
}

/**
 * Nilai /modify_devices diterjemahkan balik jadi nilai `place_*`.
 *
 * Hanya kolom yang benar-benar dideklarasikan perintah tujuannya yang ikut.
 * `fixture_type` berarti sesuatu untuk /place_lighting dan tidak ada sama sekali
 * di /place_receptacle, dan argumen yang tidak dikenal adalah cara lain untuk
 * gagal di Revit sesudah menunggu.
 */
export function placeValuesFrom(
  spec: CommandSpec,
  values: Record<string, unknown>
): Record<string, unknown> {
  const declared = new Set([
    spec.positional?.name,
    ...spec.fields.map((f) => f.name),
  ]);

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    // `what` adalah kategori — ia yang MEMILIH perintahnya, bukan argumen di
    // dalamnya.
    if (key === "what") continue;
    if (declared.has(key) && value !== undefined && value !== "") out[key] = value;
  }

  return out;
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

/**
 * Perintah yang boleh dijalankan sistem SENDIRI, tanpa seorang manusia menekan
 * apa pun, sebagai langkah antara di tengah satu pertanyaan.
 *
 * Inilah pagar dari loop baca berantai: "berapa downlight 22W di lantai 1"
 * membutuhkan tiga pembacaan berurutan (categories → parameters → elements), dan
 * yang menjalankan ketiganya adalah sistem, bukan orang yang mengetik tiga kali.
 * Jadi pertanyaan "perintah mana yang boleh berjalan tanpa ditunggui" harus
 * dijawab di satu tempat, dan tempatnya di sini — bukan sebuah daftar nama di
 * dalam route, yang akan berbeda dari katalog ini pada perubahan pertama.
 *
 * TIGA syarat, dan ketiganya harus terpenuhi. Satu syarat sudah cukup untuk
 * membedakan baca dari tulis hari ini; tiga syarat adalah yang masih benar
 * setelah katalog ini berubah:
 *
 *   group === "read"   — maksudnya membaca. Sengaja bukan daftar nama: perintah
 *                        baca yang ditambahkan nanti ikut, tanpa ada yang perlu
 *                        ingat memasukkannya.
 *   role === "viewer"  — tidak ada perintah yang mengubah model yang boleh
 *                        dijalankan seorang viewer, jadi apa pun yang menuntut
 *                        editor bukan bacaan. Ini yang menangkap perintah yang
 *                        salah dikelompokkan ke "read" di kemudian hari.
 *   !confirm           — yang butuh pertanyaan sebelum berangkat, per definisi,
 *                        tidak boleh berangkat tanpa ditanyakan.
 *
 * `hidden` juga ditolak: perintah tersembunyi tidak pernah ditawarkan sebagai
 * tool kepada model (lihat toolsForRole), jadi ia tidak akan pernah sampai ke
 * sini — dan sesuatu yang tidak mungkin terjadi tetap lebih baik dinyatakan
 * daripada disimpulkan pembaca berikutnya.
 *
 * Yang TIDAK ikut, dan sebabnya: `list_sheets`, `export`, `print_pdf`,
 * `export_cad`. Ketiga yang terakhir menulis berkas ke disk PC Revit — itu
 * akibat, bukan bacaan. `list_sheets` memang membaca, tapi ia berkelompok
 * `export`, dan mengikutkannya berarti menambahkan pengecualian bernama ke
 * fungsi yang seluruh gunanya justru tidak punya daftar nama.
 */
export function canAutoRun(spec: CommandSpec): boolean {
  return spec.group === "read" && spec.role === "viewer" && !spec.confirm && !spec.hidden;
}

export function commandsForGroup(group: CommandSpec["group"], role: Role): CommandSpec[] {
  return COMMANDS.filter((c) => c.group === group && !c.hidden && canRun(c, role));
}
