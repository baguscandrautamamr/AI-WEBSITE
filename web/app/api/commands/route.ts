import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { CommandValidationError, enqueueCommand } from "@/lib/queue";
import { roleForProject } from "@/lib/access";

export const runtime = "nodejs";

// POST — kirim satu command ke antrian yang dipolling add-in Revit.
export async function POST(req: Request) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { command?: string; projectId?: string; values?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body harus JSON" }, { status: 400 });
  }

  const { command, projectId, values } = body;
  if (!command || !projectId) {
    return NextResponse.json({ error: "`command` dan `projectId` wajib diisi" }, { status: 400 });
  }

  // Peran dibaca per proyek: seseorang bisa editor di satu proyek dan viewer di
  // proyek lain, persis seperti aturan peran di bot.
  const role = await roleForProject(supabase, user.id, projectId);
  if (!role) {
    return NextResponse.json(
      { error: "kamu belum diberi akses ke proyek ini — minta admin menambahkan" },
      { status: 403 }
    );
  }

  try {
    const result = await enqueueCommand({
      supabase,
      userId: user.id,
      projectId,
      role,
      commandName: command,
      values: values ?? {},
    });
    return NextResponse.json({ ok: true, ...result }, { status: 202 });
  } catch (err) {
    if (err instanceof CommandValidationError) {
      return NextResponse.json({ error: "validasi gagal", issues: err.issues }, { status: 400 });
    }
    console.error("[api/commands] enqueue failed", err);
    return NextResponse.json({ error: "gagal mengirim command" }, { status: 500 });
  }
}

// GET ?id=<uuid> — status satu command; dipakai UI untuk menunggu hasil.
export async function GET(req: Request) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "parameter `id` wajib" }, { status: 400 });

  // RLS membatasi baris ke proyek yang boleh diakses user, jadi tidak perlu
  // filter pemilik lagi di sini.
  const { data, error } = await supabase
    .from("commands_queue")
    .select("id, command_type, command_text, status, result_json, error_message, queued_at, completed_at, execution_time_ms")
    .eq("id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json(data);
}

/**
 * PATCH ?id=<uuid> — membatalkan perintah sendiri yang masih menunggu.
 *
 * Sebuah baris `pending` yang tidak pernah diambil add-in — Revit tertutup,
 * add-in belum dipasang, atau perintahnya memang salah kirim — tidak punya jalan
 * keluar apa pun dari website sebelum ini. Ia tetap di depan antrean, dan begitu
 * Revit dibuka ia langsung dijalankan: perintah dari sejam lalu, ke model yang
 * sudah berubah, tanpa ada yang memintanya lagi.
 *
 * Hanya milik sendiri, dan hanya yang masih `pending`. Yang sudah `processing`
 * berarti Revit sedang mengerjakannya — membatalkannya di database tidak
 * menghentikan apa pun di sana, hanya membuat statusnya berbohong.
 */
export async function PATCH(req: Request) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "parameter `id` wajib" }, { status: 400 });

  // Dibaca dengan klien user, jadi RLS yang menentukan barisnya boleh dilihat
  // atau tidak — bukan pemeriksaan di sini yang bisa ketinggalan.
  const { data: row, error } = await supabase
    .from("commands_queue")
    .select("id, status, user_id")
    .eq("id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (row.user_id !== user.id) {
    return NextResponse.json(
      { error: "hanya perintah yang kamu kirim sendiri yang bisa dibatalkan" },
      { status: 403 }
    );
  }
  if (row.status !== "pending") {
    return NextResponse.json(
      { error: `perintah ini sudah ${row.status} — tidak bisa dibatalkan lagi` },
      { status: 409 }
    );
  }

  // Service client untuk menulisnya: policy update pada commands_queue milik
  // add-in (ia yang menandai processing/completed), dan tidak ada jaminan user
  // web punya izin update di sana. Batasnya sudah ditegakkan di atas.
  const { error: updateError } = await createServiceClient()
    .from("commands_queue")
    .update({ status: "cancelled", error_message: "dibatalkan dari website" })
    .eq("id", id)
    // Sekali lagi di WHERE, bukan hanya di pemeriksaan di atas: antara membaca
    // dan menulis, add-in bisa mengambil barisnya.
    .eq("status", "pending");

  if (updateError) {
    console.error("[api/commands] cancel failed", updateError);
    return NextResponse.json({ error: "gagal membatalkan perintah" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id, status: "cancelled" });
}
