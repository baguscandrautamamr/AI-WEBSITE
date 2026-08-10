import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, MODEL } from "@/lib/anthropic";
import { ELECTRICAL_SYSTEM_PROMPT, toolsForRole } from "@/lib/aiTools";
import { COMMANDS_BY_NAME, canRun, type Role } from "@/lib/commands";
import { CommandValidationError, buildPayload } from "@/lib/queue";

export const runtime = "nodejs";

/** Berapa giliran percakapan yang ikut dikirim sebagai konteks. */
const MAX_HISTORY = 12;

interface Turn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Menerjemahkan kalimat biasa jadi satu perintah terstruktur — TANPA
 * menjalankannya.
 *
 * Pemisahan itu disengaja. Perintah di sini menempatkan atau menghapus
 * perangkat di model Revit yang sedang dikerjakan orang, dan tidak ada tombol
 * undo di sisi website. Jadi route ini hanya mengusulkan; yang mengantre ke
 * commands_queue tetap /api/commands setelah pengguna menekan kirim.
 */
export async function POST(req: Request) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { message?: string; projectId?: string; history?: Turn[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body harus JSON" }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  const projectId = body.projectId;

  if (!message) return NextResponse.json({ error: "`message` wajib diisi" }, { status: 400 });
  if (!projectId) return NextResponse.json({ error: "`projectId` wajib diisi" }, { status: 400 });

  // Peran menentukan tool apa yang boleh ditawarkan. Seorang viewer tidak
  // seharusnya melihat asisten menawarkan /place_lighting, lalu ditolak server
  // sesudahnya — lebih jujur kalau pilihannya memang tidak pernah ada.
  const { data: access } = await supabase
    .from("user_project_access")
    .select("role")
    .eq("user_id", user.id)
    .eq("project_id", projectId)
    .maybeSingle();

  const role = (access?.role as Role) ?? null;
  if (!role) {
    return NextResponse.json(
      { error: "kamu belum diberi akses ke proyek ini — minta admin menambahkan" },
      { status: 403 }
    );
  }

  const history = Array.isArray(body.history) ? body.history.slice(-MAX_HISTORY) : [];

  let response;
  try {
    response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: ELECTRICAL_SYSTEM_PROMPT,
      tools: toolsForRole(role) as never,
      messages: [
        ...history.map((t) => ({ role: t.role, content: t.content })),
        { role: "user" as const, content: message },
      ],
    });
  } catch (err) {
    console.error("[api/ai/electrical] gateway call failed", err);
    return NextResponse.json({ error: "asisten sedang tidak bisa dihubungi" }, { status: 502 });
  }

  const toolUse = response.content.find((b) => b.type === "tool_use");
  const text = response.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("\n")
    .trim();

  // Tidak memilih tool = model bertanya balik atau menolak. Itu hasil yang sah,
  // bukan kegagalan: pertanyaan klarifikasi justru yang membuat mode ini aman.
  if (!toolUse || toolUse.type !== "tool_use") {
    return NextResponse.json({ kind: "reply", text: text || "Bisa diperjelas maksudnya?" });
  }

  const spec = COMMANDS_BY_NAME[toolUse.name];
  if (!spec || !canRun(spec, role)) {
    // Model menyebut command di luar katalog atau di luar perannya. Dijawab
    // sebagai teks supaya percakapan tetap jalan.
    return NextResponse.json({
      kind: "reply",
      text: text || `Perintah "${toolUse.name}" tidak tersedia untuk peranmu di proyek ini.`,
    });
  }

  const values = (toolUse.input ?? {}) as Record<string, unknown>;

  // Divalidasi dengan aturan yang sama persis dengan form, supaya usulan yang
  // pasti ditolak server ketahuan di sini — lengkap dengan alasannya, sehingga
  // pengguna bisa melengkapinya di form tanpa menebak.
  try {
    const { commandText } = buildPayload(spec, values);
    return NextResponse.json({
      kind: "command",
      command: spec.name,
      values,
      commandText,
      confirm: Boolean(spec.confirm),
      note: text || null,
    });
  } catch (err) {
    if (err instanceof CommandValidationError) {
      return NextResponse.json({
        kind: "incomplete",
        command: spec.name,
        values,
        issues: err.issues,
        note: text || null,
      });
    }
    console.error("[api/ai/electrical] buildPayload failed", err);
    return NextResponse.json({ error: "gagal menyusun perintah" }, { status: 500 });
  }
}
