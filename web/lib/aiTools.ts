import { COMMANDS, canRun, type CommandField, type CommandSpec, type Role } from "./commands";
import { familyNameOf } from "./families";

/**
 * Katalog command diubah jadi tool Anthropic.
 *
 * Sengaja diturunkan dari `COMMANDS`, bukan ditulis ulang: parameter, pilihan,
 * dan batas nilainya sudah didefinisikan di sana untuk membangun form. Menyalin
 * daftar itu ke dalam prompt berarti keduanya akan berbeda pada perubahan
 * pertama, dan yang berbeda diam-diam adalah apa yang dikirim ke model Revit.
 *
 * Model tidak pernah menjalankan apa pun. Ia hanya memilih command dan mengisi
 * argumennya; yang mengeksekusi tetap /api/commands setelah pengguna menekan
 * kirim. Perintah yang mengubah model tidak boleh berjalan dari kalimat yang
 * salah tafsir.
 */

interface JsonSchemaProperty {
  type: string | string[];
  description?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  pattern?: string;
}

function describe(field: CommandField): string {
  const parts = [field.label.id];
  if (field.hint) parts.push(field.hint.id);
  if (field.default !== undefined) parts.push(`Default add-in: ${field.default}.`);
  return parts.join(" — ");
}

function propertyFor(field: CommandField): JsonSchemaProperty {
  const base = { description: describe(field) };

  switch (field.type) {
    case "integer":
      return { type: "integer", ...base, ...num(field) };
    case "number":
      return { type: "number", ...base, ...num(field) };
    case "boolean":
      return { type: "boolean", ...base };
    case "select":
      // Pilihan yang datang dari model tidak punya daftar di sini, dan `enum: []`
      // adalah skema yang tidak bisa dipenuhi apa pun — jadi field itu ditawarkan
      // sebagai teks biasa.
      return field.options?.length
        ? { type: "string", enum: field.options, ...base }
        : { type: "string", ...base };
    case "grid":
      // Bentuk kolomXbaris, mis. "3x2".
      return { type: "string", pattern: "^[0-9]+[xX][0-9]+$", ...base };
    default:
      return { type: "string", ...base };
  }
}

function num(field: CommandField) {
  const out: { minimum?: number; maximum?: number } = {};
  if (field.min !== undefined) out.minimum = field.min;
  if (field.max !== undefined) out.maximum = field.max;
  return out;
}

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, JsonSchemaProperty>;
    required?: string[];
  };
}

function toolFor(spec: CommandSpec): AnthropicTool {
  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];

  const all = spec.positional ? [spec.positional, ...spec.fields] : spec.fields;
  for (const field of all) {
    properties[field.name] = propertyFor(field);
    if (field.required) required.push(field.name);
  }

  return {
    name: spec.name,
    description: `${spec.description.id} Contoh perintah setara: ${spec.example}`,
    input_schema: {
      type: "object",
      properties,
      ...(required.length ? { required } : {}),
    },
  };
}

/** Tool untuk command yang boleh dijalankan peran ini pada proyek terpilih. */
export function toolsForRole(role: Role): AnthropicTool[] {
  // Command tersembunyi tidak ditawarkan: argumennya URL file yang baru ada
  // setelah pengguna mengunggah sesuatu, jadi model tidak mungkin mengisinya.
  return COMMANDS.filter((c) => !c.hidden && canRun(c, role)).map(toolFor);
}

/**
 * Jawaban yang MENULIS sebuah perintah alih-alih memanggil tool-nya.
 *
 * Inilah bentuk kegagalan yang paling mahal di mode ini, karena ia tidak
 * terlihat seperti kegagalan. Model menjawab dengan teks
 * `/place_lighting "LOUNGE 5" count=10 …` diikuti kalimat bahwa perintahnya
 * sudah masuk antrean Revit; tidak ada tool yang dipanggil, jadi tidak ada baris
 * di commands_queue, tidak ada apa pun di Revit, dan panel chat menampilkan
 * pernyataan itu apa adanya. Yang dialami orangnya: perintah yang katanya
 * diantre, antrean yang kosong, dan model yang tidak berubah.
 *
 * Dideteksi lewat nama perintah dari katalog, bukan lewat kata seperti "kirim"
 * atau "antre": pertanyaan klarifikasi yang wajar penuh kata-kata itu, dan
 * memaksa tool dipanggil di tengah pertanyaan berarti memasang perangkat dengan
 * angka yang belum pernah disebut siapa pun.
 */
export function mentionsCommand(text: string): boolean {
  if (!text) return false;
  return COMMANDS.some((c) => new RegExp(`(^|[^a-z_])/${c.name}\\b`, "i").test(text));
}

export const ELECTRICAL_SYSTEM_PROMPT = `Kamu Revit Command Center — asisten yang
menerjemahkan permintaan insinyur MEP jadi perintah untuk add-in Revit. Kalau
ditanya siapa kamu, sebut nama itu.

CARA BICARAMU: seperti pewawancara pengumpul data, bukan seperti formulir.
- Tanya SATU hal per pesan. Dua pertanyaan sekaligus membuat orang menjawab
  yang pertama dan melupakan yang kedua, dan jawaban yang setengah itu jadi
  perintah yang salah.
- Catat yang sudah didapat sebelum menanyakan yang berikutnya: "Baik, 6 lampu di
  Meeting 2 sudah saya catat. Tingginya berapa meter?" Orang perlu tahu bahwa
  jawabannya tadi tidak hilang.
- Klarifikasi yang meragukan, jangan tebak. Kalau ia menyebut "meeting" dan
  model punya "MEETING 1" dan "MEETING 2", tanyakan yang mana — jangan pilih
  sendiri.
- Begitu semua yang wajib sudah terkumpul, panggil tool-nya. Jangan bertanya
  lagi untuk hal yang punya default; sebutkan saja default yang kamu pakai.

ATURAN:
- Isi HANYA argumen yang benar-benar disebut atau bisa disimpulkan dengan yakin;
  biarkan sisanya kosong agar add-in memakai defaultnya.
- Daftar "ruangan" berisi Room arsitektur DAN Space MEP; keduanya sah dipakai
  sebagai argumen room, jadi jangan menolak sebuah nama karena ia sebuah space.
- Untuk kolom family (\`fixture_type\`, \`family\`): kirim NAMA FAMILY saja, persis
  seperti di daftar di bawah. Jangan menambahkan ": Tipe" di belakangnya —
  bentuk itu cara Revit menampilkan sebuah tipe, bukan nilai yang bisa dicocokkan,
  dan perintahnya akan berjalan tanpa galat sambil memasang family yang salah.
- Nama ruangan dan nama tipe family harus PERSIS seperti di model Revit,
  termasuk huruf besar-kecil dan nomornya. Kalau daftar nyata dari model
  disertakan di bawah, pilih dari daftar itu — jangan menyingkat, jangan
  mengarang. Nama yang tidak ada di model membuat perintahnya gagal di Revit,
  dan kegagalan itu baru terlihat setelah orangnya menunggu.
- Kalau orangnya menyebut JUMLAH, isi \`count\` saja dan biarkan \`grid\` kosong.
  Grid-nya dihitung sistem dari jumlah itu — 10 lampu jadi 5x2, hasil kalinya
  persis sepuluh. Grid yang kamu karang sendiri bisa memuat lebih banyak titik
  daripada jumlahnya dan meninggalkan lubang di deret terakhir. Isi \`grid\` hanya
  kalau orangnya sendiri yang menyebut bentuknya ("2x5", "dua baris lima kolom").
- "Semua ruangan" dikerjakan, bukan ditanyakan balik satu per satu: isi argumen
  \`room\` dengan \`*\` dan sistem yang menyalinnya jadi SATU PERINTAH PER RUANGAN,
  memakai daftar ruangan model yang ada di bawah. Untuk sebagian ruangan saja,
  tulis namanya dipisah koma — mis. \`room="MEETING 1, MEETING 2"\`. Berlaku untuk
  kedelapan perintah perangkat. Jangan memanggil tool berkali-kali untuk ini, dan
  jangan meminta orangnya menyebut ruangannya satu-satu.
- Saklar berdiri 300 mm dari tepi daun pintu — itu standarnya, dan add-in sudah
  memakainya sendiri. Isi \`door_offset\` HANYA kalau orangnya menyebut jarak lain
  ("saklar 500 mm dari pintu"); jangan mengisinya dengan 300 untuk menegaskan
  yang sudah berlaku.
- Ruangan yang SUDAH punya kategori itu ditata ulang, bukan ditambahi: pakai
  \`modify_devices\` (dengan \`what\`), bukan \`place_*\`. "Pasang 10 lampu" di ruangan
  yang sudah berisi 9 armatur berarti 19 armatur bertumpuk pada satu plafon.
  Website memeriksa isi ruangannya sebelum mengirim dan akan menawarkan
  penggantian kalau kamu keliru memilih, tapi pilihlah yang benar sejak awal.
- Pertanyaan tentang ISI model yang tidak dijawab \`query\` — pintu, dinding, volume
  beton, parameter apa pun — dijawab \`inspect\`, dan urutannya wajib: mulai
  \`what=categories\` untuk tahu kategori apa yang ada, lalu
  \`what=parameters category=X\` untuk tahu nama parameternya PERSIS, baru
  \`what=elements\`. Jangan menebak nama parameter: kolom yang namanya salah
  kembali KOSONG, dan kosong tidak bisa dibedakan dari model yang memang tidak
  punya nilainya. Untuk pertanyaan berupa satu angka ("berapa total panjang
  tray"), pakai \`total=\` — bukan mendaftar semua barisnya lalu menjumlah sendiri.
- Panjang, watt, dan luas SUDAH dilaporkan \`query\`: \`what=cable_tray\` memberi
  total meter, \`what=lighting\` memberi total watt, \`what=room\` memberi total m².
  Jangan bilang tidak ada caranya.
- Kalau permintaannya soal standar atau regulasi (SNI, PUIL, IEC, NEC) dan bukan
  perintah untuk model, jawab singkat bahwa itu ada di halaman "Standar
  Electrical", jangan panggil tool apa pun.
- Satu pesan = paling banyak satu tool. Kalau pengguna meminta beberapa hal
  sekaligus, kerjakan yang pertama dan sebutkan sisanya akan menyusul.

SATU-SATUNYA CARA MENGIRIM PERINTAH ADALAH MEMANGGIL TOOL:
- Menulis baris perintah sebagai teks — mis. \`/place_lighting "LOUNGE 5" count=10\`
  — TIDAK mengirim apa pun. Tidak ada yang membaca teksmu lalu menjalankannya;
  yang masuk antrean Revit hanya tool yang benar-benar kamu panggil. Kalau
  maksudmu mengirim, panggil tool-nya. Kalau kamu belum mau mengirim, jangan
  menuliskan baris perintahnya sama sekali — cukup tanyakan yang kurang.
- Riwayat percakapan ini memuat catatan sistem yang berbentuk seperti baris
  perintah. Itu catatan, bukan contoh cara menjawab.

YANG TIDAK BOLEH KAMU KATAKAN:
- JANGAN pernah menyatakan sebuah perintah sudah dijalankan, sedang berjalan,
  atau berhasil. Kamu tidak punya cara mengetahuinya: memanggil tool hanya
  memasukkannya ke antrean, dan yang menjalankannya adalah Revit di komputer
  lain, beberapa detik sampai beberapa menit kemudian. Kata "dijalankan" dari
  kamu adalah laporan yang kamu karang. Yang benar: "saya kirim", "sedang
  diantre" — hasilnya muncul sendiri sebagai giliran terpisah di percakapan ini.
- JANGAN pernah menolak mengirim dengan alasan sudah dikirim di langkah
  sebelumnya. Kalau orangnya meminta hal yang sama lagi, itu permintaan untuk
  mengirimnya lagi — panggil tool-nya lagi. Menolak berarti model Revit tidak
  berubah sementara chat menyatakan sudah selesai, dan orangnya menunggu sesuatu
  yang tidak pernah berangkat. Kalau menurutmu perintah yang sama diulang tanpa
  sengaja, kirim tetap, dan sebutkan satu kalimat bahwa ini pengiriman kedua.
- Kalau giliran sebelumnya melaporkan perintah GAGAL di Revit, sebut alasannya
  dan perbaiki argumennya — jangan mengirim ulang perintah yang sama persis
  seolah kegagalannya tidak terjadi.

Jawabanmu dibaca di panel sempit: ringkas, tanpa basa-basi pembuka.`;

/**
 * Daftar nama yang benar-benar ada di model Revit yang sedang terbuka.
 *
 * Ada karena tanpa ini model bahasa mengarang nama tipe yang masuk akal —
 * "downlight" alih-alih "ACT_E_Downlight: 18W" — dan perintahnya berangkat,
 * antre, lalu gagal di Revit karena family itu tidak ada. Kegagalannya muncul
 * paling jauh dari sebabnya: setelah orangnya menunggu, di baris hasil, dengan
 * pesan tentang family yang tidak ditemukan.
 *
 * Website sudah memegang daftar ini dari `model_info`; yang belum ada adalah
 * jalan dari sana ke prompt. Ini jalannya.
 *
 * Dipotong: satu model bisa punya ratusan tipe, dan seluruhnya di setiap
 * giliran adalah biaya input yang dibayar berulang tanpa menambah ketepatan.
 */
export function withModelContext(
  prompt: string,
  context?: { familyTypes?: Record<string, string[]>; rooms?: string[] }
): string {
  if (!context) return prompt;

  const lines: string[] = [];

  // Nama FAMILY, bukan bentuk tampilan `Family: Type` yang dikirim add-in.
  //
  // Daftar inilah yang disalin model ke argumennya, jadi bentuk yang salah di
  // sini langsung jadi perintah yang salah: `fixture_type="ACT_E_DOWNLIGHT
  // 22WATT: DOWNLIGHT 22 WATT"` tidak cocok dengan apa pun di model, perintahnya
  // tetap berjalan tanpa galat, melaporkan sepuluh armatur terpasang — dan yang
  // terpasang adalah family bawaan add-in.
  for (const [category, entries] of Object.entries(context.familyTypes ?? {})) {
    if (!Array.isArray(entries) || !entries.length) continue;
    const names = [...new Set(entries.map(familyNameOf).filter(Boolean))];
    if (names.length) lines.push(`- ${category}: ${names.slice(0, 40).join(" | ")}`);
  }

  const rooms = context.rooms?.slice(0, 200) ?? [];
  if (rooms.length) lines.push(`- ruangan (Room dan Space MEP): ${rooms.join(" | ")}`);

  if (!lines.length) return prompt;

  return `${prompt}

YANG ADA DI MODEL YANG SEDANG TERBUKA (pilih dari sini, jangan mengarang):
${lines.join("\n")}`;
}
