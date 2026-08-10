import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { roleForProject } from "@/lib/access";
import { rateLimit, tooManyRequests } from "@/lib/rateLimit";
import { buildMessages } from "@/lib/chatHistory";
import { anthropic, MODEL } from "@/lib/anthropic";
import { ELECTRICAL_SYSTEM_PROMPT, mentionsCommand, toolsForRole, withModelContext } from "@/lib/aiTools";
import { COMMANDS_BY_NAME, canRun } from "@/lib/commands";
import { CommandValidationError, buildPayload } from "@/lib/queue";

export const runtime = "nodejs";

/** Satu kalimat perintah; yang lebih panjang dari ini hampir pasti bukan itu. */
const MAX_MESSAGE_CHARS = 2_000;

/** 30 giliran per menit per user — jauh di atas kecepatan mengetik orang. */
const TURNS_PER_MINUTE = 30;

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
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // `history` sengaja `unknown`: bentuknya ditentukan client, jadi buildMessages
  // yang memeriksanya, bukan anotasi tipe yang cuma berlaku saat compile.
  let body: {
    message?: string;
    projectId?: string;
    history?: unknown;
    // Nama tipe family dan ruangan dari model Revit yang sedang terbuka.
    // Datang dari client karena hanya add-in yang tahu isi model, dan
    // jawabannya sudah ada di halaman itu — mengambilnya ulang di server
    // berarti satu putaran antrean lagi ke Revit untuk data yang sama.
    context?: { familyTypes?: Record<string, string[]>; rooms?: string[] };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body harus JSON" }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  const projectId = body.projectId;

  if (!message) return NextResponse.json({ error: "`message` wajib diisi" }, { status: 400 });
  if (message.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json(
      { error: `pesan terlalu panjang (maksimal ${MAX_MESSAGE_CHARS} karakter)` },
      { status: 400 }
    );
  }
  if (!projectId) return NextResponse.json({ error: "`projectId` wajib diisi" }, { status: 400 });

  // Peran menentukan tool apa yang boleh ditawarkan. Seorang viewer tidak
  // seharusnya melihat asisten menawarkan /place_lighting, lalu ditolak server
  // sesudahnya — lebih jujur kalau pilihannya memang tidak pernah ada.
  const role = await roleForProject(supabase, user.id, projectId);
  if (!role) {
    return NextResponse.json(
      { error: "kamu belum diberi akses ke proyek ini — minta admin menambahkan" },
      { status: 403 }
    );
  }

  // Dibatasi setelah peran diperiksa, supaya request yang memang tidak berhak
  // tidak ikut menghabiskan jatah orang yang berhak.
  const limit = rateLimit(`ai:electrical:${user.id}`, TURNS_PER_MINUTE, 60_000);
  if (!limit.ok) return tooManyRequests(limit);

  const tools = toolsForRole(role);
  const messages = buildMessages(body.history, message);
  const system = withModelContext(ELECTRICAL_SYSTEM_PROMPT, body.context);

  const ask = (force: boolean) =>
    anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system,
      tools: tools as never,
      // `any` = wajib memakai salah satu tool. Dipakai hanya pada percobaan
      // kedua, saat percobaan pertama jelas-jelas BERMAKSUD mengirim perintah
      // tapi menuliskannya sebagai teks.
      ...(force ? { tool_choice: { type: "any" as const } } : {}),
      messages,
    });

  let response;
  try {
    response = await ask(false);
  } catch (err) {
    console.error("[api/ai/electrical] gateway call failed", err);
    return NextResponse.json({ error: "asisten sedang tidak bisa dihubungi" }, { status: 502 });
  }

  let toolUse = response.content.find((b) => b.type === "tool_use");
  let text = textOf(response.content);

  /**
   * Jawaban yang MENULIS perintahnya alih-alih memanggil tool-nya, dicoba sekali
   * lagi dengan tool yang diwajibkan.
   *
   * Ini kegagalan yang tidak terlihat seperti kegagalan: teks
   * `/place_lighting "LOUNGE 5" count=10 …` plus kalimat "sudah dikirim ke
   * antrean Revit", tanpa satu pun tool dipanggil — jadi tidak ada baris di
   * commands_queue, tidak ada apa pun di Revit, dan yang dibaca orangnya adalah
   * pernyataan bahwa perintahnya sudah berangkat. Sebabnya ada di riwayat: usulan
   * yang berangkat dicatat sebagai giliran asisten, dan bentuk catatan itu ditiru
   * model sebagai gaya jawabannya sendiri.
   *
   * Catatan riwayatnya sudah diperbaiki (lihat chatHistory.ts), dan ini
   * penjagaan lapis kedua: maksudnya sudah jelas, jadi yang kurang cuma
   * panggilan tool-nya.
   */
  if (!toolUse && tools.length > 0 && mentionsCommand(text)) {
    console.warn("[api/ai/electrical] jawaban menulis perintah tanpa memanggil tool — dipaksa");
    try {
      const forced = await ask(true);
      const forcedTool = forced.content.find((b) => b.type === "tool_use");
      if (forcedTool) {
        toolUse = forcedTool;
        text = textOf(forced.content) || "";
      }
    } catch (err) {
      // Percobaan kedua yang gagal bukan alasan menjatuhkan giliran ini: jawaban
      // pertamanya tetap ada, dan di bawah ia dikembalikan dengan keterangan
      // bahwa TIDAK ada perintah yang dikirim.
      console.error("[api/ai/electrical] forced tool retry failed", err);
    }
  }

  // Tidak memilih tool = model bertanya balik atau menolak. Itu hasil yang sah,
  // bukan kegagalan: pertanyaan klarifikasi justru yang membuat mode ini aman.
  if (!toolUse || toolUse.type !== "tool_use") {
    return NextResponse.json({
      kind: "reply",
      text: text || "Bisa diperjelas maksudnya?",
      // Jawaban yang menyebut sebuah perintah padahal tidak ada yang dikirim
      // ditandai, supaya panel chat mengatakannya terus terang alih-alih
      // membiarkan kalimat model berdiri sebagai laporan.
      nothingSent: mentionsCommand(text),
    });
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

/** Bagian teks dari sebuah jawaban, digabung. */
function textOf(content: { type: string; text?: string }[]): string {
  return content
    .flatMap((b) => (b.type === "text" && typeof b.text === "string" ? [b.text] : []))
    .join("\n")
    .trim();
}
