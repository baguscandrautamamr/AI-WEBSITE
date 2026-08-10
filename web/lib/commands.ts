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
    id: "Tulis persis seperti di gambar, termasuk nomornya — mis. \"meeting 1\".",
    en: "Type it exactly as on the drawing, including its number — e.g. \"meeting 1\".",
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
          id: "Kosongkan agar dihitung dari target lux.",
          en: "Leave empty to size it from the lux target.",
        },
      },
      {
        name: "grid",
        type: "grid",
        label: { id: "Grid (kolom x baris)", en: "Grid (columns x rows)" },
        hint: {
          id: "mis. 3x2 — tata letak eksplisit, mengalahkan perhitungan lux.",
          en: "e.g. 3x2 — explicit layout, overrides the lux calculation.",
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
        default: "LED_15W",
        label: { id: "Tipe armatur", en: "Fixture type" },
        hint: {
          id: "Nama family di Revit.",
          en: "Revit family name.",
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
      { name: "count", type: "integer", default: 1, min: 1, max: 50, label: { id: "Jumlah", en: "Count" } },
      height(1.2),
      {
        name: "placement",
        type: "select",
        default: "door",
        options: ["door", "walls", "manual"],
        label: { id: "Penempatan", en: "Placement" },
      },
      {
        name: "controls",
        type: "text",
        label: { id: "Mengendalikan", en: "Controls" },
        hint: { id: "id sirkuit, mark armatur, atau nama grup.", en: "A circuit id, fixture mark, or group name." },
      },
      { name: "family", type: "text", label: { id: "Family Revit", en: "Revit family" } },
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
      { name: "hanger_family", type: "text", label: { id: "Family hanger", en: "Hanger family" } },
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
      { name: "hanger_family", type: "text", label: { id: "Family hanger", en: "Hanger family" } },
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
      { name: "count", type: "integer", min: 1, label: { id: "Jumlah baru", en: "New count" } },
      { name: "grid", type: "grid", label: { id: "Grid baru", en: "New grid" } },
      { name: "height", type: "number", label: { id: "Ketinggian (m)", en: "Height (m)" } },
      { name: "fixture_type", type: "text", label: { id: "Tipe armatur", en: "Fixture type" } },
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
      id: "Membaca model dan melaporkan apa yang sudah ada. Satu-satunya command yang tidak membuka transaksi Revit, jadi viewer boleh menjalankannya.",
      en: "Reads the model and reports what is there. The only command that opens no Revit transaction.",
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
        name: "detail",
        type: "select",
        default: "summary",
        options: ["summary", "list"],
        label: { id: "Rincian", en: "Detail" },
      },
      { name: "limit", type: "integer", default: 30, min: 1, max: 500, label: { id: "Batas item", en: "Limit" } },
    ],
    example: "/query Office_A what=lighting detail=list",
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
    ],
    example: "/print_pdf E-101,E-102 combine=true",
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
];

export const COMMANDS_BY_NAME: Record<string, CommandSpec> = Object.fromEntries(
  COMMANDS.map((c) => [c.name, c])
);

const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };

/** Apakah `role` cukup untuk menjalankan command ini. */
export function canRun(spec: CommandSpec, role: Role): boolean {
  return RANK[role] >= RANK[spec.role];
}

export function commandsForGroup(group: CommandSpec["group"], role: Role): CommandSpec[] {
  return COMMANDS.filter((c) => c.group === group && !c.hidden && canRun(c, role));
}
