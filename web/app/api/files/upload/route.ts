import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { uploadBuffer } from "@/lib/cloudinary";

// cloudinary + Buffer butuh Node runtime, bukan edge.
export const runtime = "nodejs";

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

// Hanya tipe yang memang dipakai alur import ke add-in Revit.
const ALLOWED_MIME = new Set(["application/pdf"]);

// Cloudinary public_id ikut masuk ke URL, jadi nama file dari user harus
// dibersihkan dulu — jangan biarkan "../" atau karakter aneh lolos.
function safePublicId(originalName: string) {
  const base = originalName.split(/[\\/]/).pop() ?? "upload";
  const stem = base.replace(/\.[^.]+$/, "");
  const cleaned = stem.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").slice(0, 80);
  return `${cleaned || "upload"}-${Date.now()}`;
}

// Upload generik: dipanggil halaman export-import sebelum insert command
// `import_pdf`, supaya add-in bisa menarik file lewat URL.
export async function POST(req: Request) {
  const supabase = createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "field `file` is required" }, { status: 400 });
  }

  if (file.size === 0) {
    return NextResponse.json({ error: "file is empty" }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `file too large (max ${MAX_BYTES / 1024 / 1024} MB)` },
      { status: 413 }
    );
  }

  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: `unsupported type "${file.type}" (allowed: ${[...ALLOWED_MIME].join(", ")})` },
      { status: 415 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Client bisa berbohong soal Content-Type, jadi cek magic bytes "%PDF".
  if (buffer.subarray(0, 4).toString("latin1") !== "%PDF") {
    return NextResponse.json({ error: "file is not a valid PDF" }, { status: 415 });
  }

  try {
    // Folder per user supaya file antar user tidak tercampur.
    const { url, publicId } = await uploadBuffer(
      buffer,
      `electrical-ai/imports/${user.id}`,
      safePublicId(file.name)
    );
    return NextResponse.json({ url, publicId });
  } catch (err) {
    console.error("[api/files/upload] cloudinary upload failed", err);
    return NextResponse.json({ error: "upload failed" }, { status: 502 });
  }
}
