import type { SupabaseClient } from "@supabase/supabase-js";
import { COMMANDS_BY_NAME, canRun, type CommandField, type CommandSpec, type Role } from "./commands";

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
    const v = coerce(field, values[field.name], issues);
    if (v === undefined) {
      if (field.required) issues.push(`${field.name} wajib diisi`);
      continue;
    }
    payload[field.name] = v;
  }

  // Aturan yang tidak bisa dinyatakan per-field.
  if (spec.name === "create_cable_tray" && !payload.follow && !(payload.from && payload.to)) {
    issues.push("isi `follow`, atau `from` dan `to` sekaligus");
  }
  if (spec.name === "modify_devices" && payload.count === undefined && payload.grid === undefined) {
    issues.push("isi salah satu: jumlah baru atau grid baru");
  }

  if (issues.length) throw new CommandValidationError(issues);

  // Teks yang dibaca manusia, disimpan di command_text supaya riwayat di
  // website dan di Telegram terbaca dengan bentuk yang sama.
  const positionalValue = spec.positional ? payload[spec.positional.name] : undefined;
  const rest = Object.entries(payload)
    .filter(([k]) => k !== spec.positional?.name)
    .map(([k, v]) => `${k}=${typeof v === "string" && v.includes(" ") ? `"${v}"` : v}`)
    .join(" ");
  const commandText = `/${spec.name}${positionalValue ? ` ${positionalValue}` : ""}${rest ? ` ${rest}` : ""}`;

  return { payload, commandText };
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
