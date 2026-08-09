import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, MODEL } from "@/lib/anthropic";

const SYSTEM_PROMPT = `Kamu adalah asisten yang menjawab pertanyaan seputar standar
dan regulasi kelistrikan (SNI, PUIL, IEC, NEC, dsb.) untuk kebutuhan desain MEP.
Jawab singkat, akurat, dan sebutkan nomor standar jika relevan. Kamu TIDAK pernah
mengeksekusi apa pun di Revit — kamu murni memberi informasi.`;

// Mode Standard: TIDAK PERNAH insert ke tabel `commands`.
export async function POST(req: Request) {
  const { message } = await req.json();
  const supabase = createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: history } = await supabase
    .from("chat_logs")
    .select("role, content")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(20);

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1000,
    system: SYSTEM_PROMPT,
    messages: [...(history ?? []), { role: "user", content: message }] as any,
  });

  const reply = response.content.find((b) => b.type === "text")?.text ?? "";

  await supabase.from("chat_logs").insert([
    { user_id: user.id, role: "user", content: message },
    { user_id: user.id, role: "assistant", content: reply },
  ]);

  return NextResponse.json({ reply });
}
