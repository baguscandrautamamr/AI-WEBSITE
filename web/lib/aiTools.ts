import { COMMANDS, canRun, type CommandField, type CommandSpec, type Role } from "./commands";

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
- Nama ruangan dan nama tipe family harus PERSIS seperti di model Revit,
  termasuk huruf besar-kecil dan nomornya. Kalau daftar nyata dari model
  disertakan di bawah, pilih dari daftar itu — jangan menyingkat, jangan
  mengarang. Nama yang tidak ada di model membuat perintahnya gagal di Revit,
  dan kegagalan itu baru terlihat setelah orangnya menunggu.
- Kalau permintaannya soal standar atau regulasi (SNI, PUIL, IEC, NEC) dan bukan
  perintah untuk model, jawab singkat bahwa itu ada di halaman "Standar
  Electrical", jangan panggil tool apa pun.
- Satu pesan = paling banyak satu tool. Kalau pengguna meminta beberapa hal
  sekaligus, kerjakan yang pertama dan sebutkan sisanya akan menyusul.

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

  for (const [category, names] of Object.entries(context.familyTypes ?? {})) {
    if (names.length) lines.push(`- ${category}: ${names.slice(0, 40).join(" | ")}`);
  }

  const rooms = context.rooms?.slice(0, 200) ?? [];
  if (rooms.length) lines.push(`- ruangan: ${rooms.join(" | ")}`);

  if (!lines.length) return prompt;

  return `${prompt}

YANG ADA DI MODEL YANG SEDANG TERBUKA (pilih dari sini, jangan mengarang):
${lines.join("\n")}`;
}
