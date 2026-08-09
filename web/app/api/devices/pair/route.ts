import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import crypto from "crypto";

// Hanya admin yang boleh generate pairing code baru (ditegakkan juga oleh RLS di DB)
export async function POST(req: Request) {
  const { deviceName } = await req.json();
  const supabase = createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const pairingCode = crypto.randomBytes(4).toString("hex").toUpperCase();

  const { data, error } = await supabase
    .from("revit_devices")
    .insert({ owner_admin: user.id, device_name: deviceName, pairing_code: pairingCode })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
