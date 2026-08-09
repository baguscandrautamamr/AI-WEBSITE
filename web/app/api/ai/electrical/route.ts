import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Mode Electrical: insert command ke command bus supaya diambil add-in.
// TODO: sebelum insert, panggil LLM (via lib/anthropic.ts) dengan tool-calling
// untuk mengubah `text` bahasa manusia jadi payload terstruktur
// (misal { action: "tag_circuits", level: "2" }) daripada mengirim teks mentah
// — ini yang bikin ElectricalCommands.cs di add-in tidak perlu keyword-matching.
export async function POST(req: Request) {
  const { deviceId, text } = await req.json();
  const supabase = createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("commands")
    .insert({
      device_id: deviceId,
      requested_by: user.id,
      type: "electrical",
      payload: { text },
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ commandId: data.id });
}
