import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, MODEL } from "@/lib/anthropic";

export const runtime = "nodejs";

const SYSTEM_PROMPT = `Kamu adalah asisten yang menjawab pertanyaan seputar standar
dan regulasi kelistrikan (SNI, PUIL, IEC, NEC, dsb.) untuk kebutuhan desain MEP.
Jawab singkat, akurat, dan sebutkan nomor standar jika relevan. Kamu TIDAK pernah
mengeksekusi apa pun di Revit — kamu murni memberi informasi.`;

/** Sama dengan MAX_TURNS di src/services/standards.ts repo electrical_ai. */
const MAX_TURNS = 8;

interface Turn {
  role: "user" | "assistant";
  text: string;
}

// Mode Standard: TIDAK PERNAH menulis ke commands_queue.
//
// Riwayat percakapan disimpan di `standards_threads` — tabel yang sama yang
// dipakai bot Telegram (migrasi 0007), dengan bentuk baris
// `{ role, text }` dan RLS `standards_threads_self` (user_id = auth.uid()).
// Jadi satu orang yang bertanya di Telegram lalu melanjutkan di website
// menemukan percakapan yang sama, bukan dua utas terpisah.
export async function POST(req: Request) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let message: unknown;
  try {
    ({ message } = await req.json());
  } catch {
    return NextResponse.json({ error: "body harus JSON" }, { status: 400 });
  }

  if (typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "`message` wajib diisi" }, { status: 400 });
  }

  const question = message.trim();

  const { data: thread } = await supabase
    .from("standards_threads")
    .select("turns")
    .eq("user_id", user.id)
    .maybeSingle();

  const previous: Turn[] = Array.isArray(thread?.turns) ? (thread!.turns as Turn[]) : [];

  let reply: string;
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        ...previous.map((t) => ({ role: t.role, content: t.text })),
        { role: "user" as const, content: question },
      ],
    });
    reply = response.content.find((b) => b.type === "text")?.text ?? "";
  } catch (err) {
    // Gateway AI di luar kendali app ini; balas error yang bisa dibaca UI,
    // jangan biarkan exception jadi halaman HTML yang gagal di-JSON.parse.
    console.error("[api/ai/standard] gateway call failed", err);
    return NextResponse.json({ error: "asisten standar sedang tidak bisa dihubungi" }, { status: 502 });
  }

  if (!reply) {
    return NextResponse.json({ error: "asisten tidak mengembalikan jawaban" }, { status: 502 });
  }

  const all: Turn[] = [
    ...previous,
    { role: "user", text: question },
    { role: "assistant", text: reply },
  ];
  const turns = all.slice(-MAX_TURNS);

  // chat_id dibiarkan apa adanya untuk baris yang sudah ada; utas dari website
  // tidak punya chat Telegram, dan kolomnya memang nullable.
  const { error: saveError } = await supabase
    .from("standards_threads")
    .upsert(
      { user_id: user.id, turns, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );

  // Gagal menyimpan tidak boleh menelan jawaban yang sudah didapat — user tetap
  // dapat jawabannya, hanya kehilangan konteks di pertanyaan berikutnya.
  if (saveError) console.error("[api/ai/standard] gagal menyimpan utas", saveError);

  return NextResponse.json({ reply });
}

// GET — utas yang tersimpan, supaya halaman Standard tidak mulai kosong setiap
// kali dibuka ulang padahal server masih mengingat percakapannya.
export async function GET() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("standards_threads")
    .select("turns")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const turns: Turn[] = Array.isArray(data?.turns) ? (data!.turns as Turn[]) : [];
  return NextResponse.json({ turns });
}
