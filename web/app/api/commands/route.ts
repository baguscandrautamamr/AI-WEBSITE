import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
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
