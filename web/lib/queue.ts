import type { SupabaseClient } from "@supabase/supabase-js";
import {
  COMMANDS_BY_NAME,
  canRun,
  fieldApplies,
  type CommandField,
  type CommandSpec,
  type Role,
} from "./commands";
import { autoGrid, formatGrid, gridCount, parseGrid } from "./grid";
import { familyNameOf } from "./families";

// Penyambung website ke add-in Revit.
//
// Add-in tidak tahu-menahu soal website: ia memanggil RPC `claim_next_command`
// yang mengambil baris `pending` tertua dari commands_queue. Jadi "mengirim
// command ke Revit" secara harfiah = INSERT satu baris di sini.
//
// chat_id sengaja dibiarkan null. delivery.ts di bot Telegram memeriksa
// `if (!command.chat_id)` lalu menandainya terkirim dan berhenti, sehingga
// baris dari website tidak pernah dikirim ke Telegram siapa pun.

export interface EnqueueResult {
  id: string;
  commandText: string;
}

export class CommandValidationError extends Error {
  constructor(public issues: string[]) {
    super(issues.join("; "));
    this.name = "CommandValidationError";
  }
}

function coerce(field: CommandField, raw: unknown, issues: string[]): unknown {
  if (raw === undefined || raw === null || raw === "") return undefined;

  switch (field.type) {
    case "integer":
    case "number": {
      const n = typeof raw === "number" ? raw : Number(String(raw).trim());
      if (!Number.isFinite(n)) {
        issues.push(`${field.name} harus berupa angka`);
        return undefined;
      }
      if (field.type === "integer" && !Number.isInteger(n)) {
        issues.push(`${field.name} harus bilangan bulat`);
        return undefined;
      }
      if (field.min !== undefined && n < field.min) {
        issues.push(`${field.name} minimal ${field.min}`);
        return undefined;
      }
      if (field.max !== undefined && n > field.max) {
        issues.push(`${field.name} maksimal ${field.max}`);
        return undefined;
      }
      return n;
    }
    case "boolean":
      if (typeof raw === "boolean") return raw;
      return ["true", "yes", "1", "ya"].includes(String(raw).toLowerCase());
    case "select": {
      const v = String(raw);
      if (field.options && !field.options.includes(v)) {
        issues.push(`${field.name} harus salah satu dari: ${field.options.join(", ")}`);
        return undefined;
      }
      return v;
    }
    case "grid": {
      const v = String(raw).replace(/\s+/g, "").toLowerCase();
      if (!/^\d+x\d+$/.test(v)) {
        issues.push(`${field.name} harus berbentuk kolomXbaris, mis. 3x2`);
        return undefined;
      }
      return v;
    }
    default:
      return String(raw).trim();
  }
}

/**
 * Memvalidasi input terhadap spesifikasi command dan mengubahnya jadi payload
 * `command_json`. Semua field bermasalah dilaporkan sekaligus — sama seperti
 * perilaku validasi di bot (lihat bagian Errors di COMMANDS.md).
 */
export function buildPayload(
  spec: CommandSpec,
  values: Record<string, unknown>
): { payload: Record<string, unknown>; commandText: string } {
  const issues: string[] = [];
  const payload: Record<string, unknown> = {};

  if (spec.positional) {
    const v = coerce(spec.positional, values[spec.positional.name], issues);
    if (v === undefined && spec.positional.required) {
      issues.push(`${spec.positional.name} wajib diisi`);
    } else if (v !== undefined) {
      payload[spec.positional.name] = v;
    }
  }

  for (const field of spec.fields) {
    // Kolom yang tidak berlaku untuk isian ini tidak ikut: "jarak dari pintu"
    // yang diketik saat kategorinya masih saklar tidak boleh ikut berangkat
    // setelah kategorinya diganti jadi armatur.
    if (!fieldApplies(field, values)) continue;

    const v = coerce(field, values[field.name], issues);
    if (v === undefined) {
      if (field.required) issues.push(`${field.name} wajib diisi`);
      continue;
    }
    payload[field.name] = normalizesFamily(spec, field) && typeof v === "string"
      ? familyNameOf(v)
      : v;
  }

  // Aturan yang tidak bisa dinyatakan per-field.
  if (spec.name === "create_cable_tray" && !payload.follow && !(payload.from && payload.to)) {
    issues.push("isi `follow`, atau `from` dan `to` sekaligus");
  }
  if (spec.name === "modify_devices" && payload.count === undefined && payload.grid === undefined) {
    issues.push("isi salah satu: jumlah baru atau grid baru");
  }
  if (spec.name === "connect_circuit"
      && payload.room === undefined
      && payload.ids === undefined) {
    issues.push("sebut ruangannya, atau ID elemennya");
  }
  if (spec.name === "section_box"
      && payload.off !== true
      && payload.room === undefined
      && payload.ids === undefined) {
    issues.push("sebut ruangannya, atau ID elemennya — atau pakai off untuk mematikannya");
  }
  normalizeElementIds(spec, payload, issues);

  applyGridRules(spec, payload, issues);

  if (issues.length) throw new CommandValidationError(issues);

  // Teks yang dibaca manusia, disimpan di command_text supaya riwayat di
  // website dan di Telegram terbaca dengan bentuk yang sama.
  const positionalValue = spec.positional ? payload[spec.positional.name] : undefined;
  const rest = Object.entries(payload)
    .filter(([k]) => k !== spec.positional?.name)
    .map(([k, v]) => `${k}=${quoteIfNeeded(v)}`)
    .join(" ");
  const positionalText = positionalValue ? ` ${quoteIfNeeded(positionalValue)}` : "";
  const commandText = `/${spec.name}${positionalText}${rest ? ` ${rest}` : ""}`;

  return { payload, commandText };
}

/**
 * Daftar ID elemen dibersihkan jadi bentuk yang satu, atau ditolak di sini.
 *
 * `ids` bertipe teks karena ia memang beberapa angka sekaligus, dan tipe teks
 * tidak memeriksa apa pun — jadi tanpa aturan ini "384210, tolong" berangkat
 * apa adanya ke add-in. Yang terjadi di sana: satu ID terbaca, sisanya jadi
 * potongan yang tidak berarti apa-apa, dan yang tampak di layar orang adalah
 * elemen yang tersorot lebih sedikit daripada yang dimintanya — tanpa satu pun
 * galat yang menyebutkan bahwa ada bagian yang dibuang.
 *
 * ElementId Revit adalah bilangan bulat positif. Yang bukan itu ditolak dengan
 * menyebut potongannya, bukan didiamkan.
 *
 * Diperiksa DI SINI, bukan di kotak isiannya, karena inilah satu-satunya jalan
 * yang dilalui semua pengirim: kolom tulis di halaman Baca Model, formulir
 * /section_box, dan perintah yang datang lewat /api/commands dari mana pun.
 */
function normalizeElementIds(
  spec: CommandSpec,
  payload: Record<string, unknown>,
  issues: string[]
): void {
  // Dipakai dua perintah, dan kewajibannya berbeda: /show_element tidak berarti
  // apa-apa tanpa ID, sementara /section_box boleh menyebut ruangan saja.
  const required = spec.name === "show_element";
  if (!required && spec.name !== "section_box" && spec.name !== "connect_circuit") return;

  const raw = String(payload.ids ?? "");
  const parts = raw.split(",").map((p) => p.trim()).filter((p) => p !== "");

  if (!parts.length) {
    if (required) issues.push("ids wajib diisi");
    // Kosong pada /section_box bukan galat, tapi kunci kosong tidak boleh ikut
    // berangkat: add-in membedakan "tidak disebut" dari "disebut lalu kosong".
    else delete payload.ids;
    return;
  }

  const bad = parts.filter((p) => !/^\d+$/.test(p) || p === "0");
  if (bad.length) {
    issues.push(`ID elemen harus angka: ${bad.join(", ")}`);
    return;
  }

  // Duplikat dibuang tapi urutannya dipertahankan: ID yang sama disebut dua
  // kali bukan galat, dan urutan ketiknya adalah urutan yang dimaksud orangnya.
  payload.ids = [...new Set(parts)].join(",");
}

/**
 * Nilai kolom ini dipendekkan jadi nama family saja sebelum dikirim.
 *
 * Untuk perintah yang MEMASANG sesuatu, ya. Bentuk tampilan Revit
 * `Family: Type` pernah berangkat apa adanya sebagai argumen `family`, tidak
 * cocok dengan apa pun di model, dan berakhir sebagai sepuluh armatur bawaan
 * add-in terpasang di plafon orang tanpa satu pun galat.
 *
 * Untuk perintah yang hanya MEMBACA, tidak. Di situ setengah nama yang dibuang
 * adalah presisi yang diminta: "ada berapa yang tipe DOWNLIGHT 18 WATT" dijawab
 * dengan jumlah SELURUH family kalau bagian tipenya dipangkas di sini — dan
 * add-in memang bisa membedakan keduanya. Sebuah pembacaan yang terlalu luas
 * tidak merusak gambar, tapi ia menjawab pertanyaan yang lain.
 */
function normalizesFamily(spec: CommandSpec, field: CommandField): boolean {
  if (spec.role === "viewer") return false;
  return Boolean(field.familyCategory || field.familyCategoryFrom);
}

/**
 * Nilai bersepasi ditulis di antara tanda kutip — argumen posisional juga.
 *
 * Argumen bernama sudah dikutip sejak awal; yang posisional tidak, dan itulah
 * satu-satunya tempat nama ruangan muncul. `/delete_devices LOUNGE 5 what=all`
 * terbaca sebagai ruangan bernama "LOUNGE" dengan sebuah "5" yang menggantung
 * oleh parser mana pun yang memecah teks ini per spasi — dan setiap ruangan
 * bernomor di gambar ini bersepasi. Payload JSON-nya memang selalu benar, tapi
 * teks ini yang dibaca orang di Riwayat dan yang disalin ulang ke Telegram, jadi
 * ia tidak boleh berbeda arti dari perintah yang sebenarnya dijalankan.
 */
function quoteIfNeeded(value: unknown): string {
  const text = String(value);
  return /\s/.test(text) ? `"${text}"` : text;
}

/**
 * Grid dan jumlah harus sepakat, dan kalau hanya jumlahnya yang disebut, grid
 * yang tepat dihitung di sini.
 *
 * Tanpa ini "10 lampu" berangkat tanpa tata letak, add-in mencari grid yang
 * CUKUP memuat sepuluh, dan yang cukup memuat sepuluh adalah 4x3 — dua belas
 * titik dengan dua lubang di deret terakhir. Jarak antar armatur jadi tidak
 * seragam, dan itu bukan soal selera: perhitungan lux per titik memang
 * mengandaikan jarak yang sama.
 *
 * Grid dihitung DI SINI, bukan di komponen form, karena ia harus ikut berlaku
 * untuk perintah yang datang dari percakapan — jalur itu tidak pernah menyentuh
 * form sama sekali. Hasilnya tampak di `command_text`, jadi yang dikirim tetap
 * bisa dibaca sebelum dan sesudahnya.
 */
function applyGridRules(
  spec: CommandSpec,
  payload: Record<string, unknown>,
  issues: string[]
): void {
  const hasGridField = spec.fields.some((f) => f.name === "grid");
  if (!hasGridField) return;

  const count = typeof payload.count === "number" ? payload.count : undefined;

  if (payload.grid === undefined) {
    if (count === undefined) return;
    const grid = autoGrid(count);
    if (grid) payload.grid = formatGrid(grid);
    return;
  }

  // Keduanya disebut: yang tidak boleh lolos adalah grid yang tidak memuat
  // jumlahnya. 10 lampu pada grid 3x3 hanya bisa berakhir dua cara — satu
  // armatur hilang, atau satu armatur menumpuk di titik yang sama.
  const grid = parseGrid(payload.grid);
  if (!grid || count === undefined) return;

  if (gridCount(grid) !== count) {
    const suggestion = autoGrid(count);
    issues.push(
      `grid ${formatGrid(grid)} memuat ${gridCount(grid)} titik, sedangkan jumlahnya ${count}` +
        (suggestion
          ? ` — pakai ${formatGrid(suggestion)}, atau kosongkan gridnya agar dihitung otomatis`
          : " — kosongkan salah satunya")
    );
  }
}

/**
 * Menulis command ke antrian yang dipolling add-in.
 *
 * `supabase` harus klien yang membawa sesi user, bukan service role — dengan
 * begitu policy `commands_queue_project_isolation` yang menentukan boleh atau
 * tidaknya insert ke sebuah proyek, bukan pengecekan di sisi aplikasi yang
 * bisa ketinggalan.
 */
export async function enqueueCommand(opts: {
  supabase: SupabaseClient;
  userId: string;
  projectId: string;
  role: Role;
  commandName: string;
  values: Record<string, unknown>;
}): Promise<EnqueueResult> {
  const spec = COMMANDS_BY_NAME[opts.commandName];
  if (!spec) throw new CommandValidationError([`command tidak dikenal: ${opts.commandName}`]);

  if (!canRun(spec, opts.role)) {
    throw new CommandValidationError([
      `peran ${opts.role} tidak boleh menjalankan /${spec.name} (butuh ${spec.role})`,
    ]);
  }

  const { payload, commandText } = buildPayload(spec, opts.values);

  const { data, error } = await opts.supabase
    .from("commands_queue")
    .insert({
      user_id: opts.userId,
      project_id: opts.projectId,
      command_type: spec.name,
      command_text: commandText,
      command_json: payload,
      // chat_id dibiarkan null: penanda bahwa asalnya website, bukan Telegram.
      status: "pending",
    })
    .select("id")
    .single();

  if (error) throw new Error(`gagal memasukkan command ke antrian: ${error.message}`);

  return { id: data.id as string, commandText };
}
