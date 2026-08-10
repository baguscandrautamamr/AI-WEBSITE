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
      return { type: "string", enum: field.options ?? [], ...base };
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
  return COMMANDS.filter((c) => canRun(c, role)).map(toolFor);
}

export const ELECTRICAL_SYSTEM_PROMPT = `Kamu asisten yang menerjemahkan permintaan
insinyur MEP jadi satu perintah untuk add-in Revit.

Cara kerjamu:
- Kalau permintaannya jelas, panggil tool yang sesuai. Isi HANYA argumen yang
  benar-benar disebut atau bisa disimpulkan dengan yakin; biarkan sisanya kosong
  agar add-in memakai defaultnya.
- Kalau ada yang kurang jelas dan penting — terutama nama ruangan — JANGAN
  menebak. Balas dengan pertanyaan singkat dalam bahasa yang dipakai pengguna.
- Kalau permintaannya soal standar atau regulasi (SNI, PUIL, IEC, NEC) dan bukan
  perintah untuk model, jawab singkat bahwa itu ada di halaman "Standar
  Electrical", jangan panggil tool apa pun.
- Nama ruangan harus persis seperti di gambar Revit, termasuk nomornya.
- Satu pesan = paling banyak satu tool. Kalau pengguna meminta beberapa hal
  sekaligus, kerjakan yang pertama dan sebutkan sisanya akan menyusul.

Jawabanmu dibaca di panel sempit: ringkas, tanpa basa-basi pembuka.`;
