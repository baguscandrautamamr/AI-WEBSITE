import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { guardArea, roleForProject } from "@/lib/access";
import { rateLimit, tooManyRequests } from "@/lib/rateLimit";
import { uploadBuffer } from "@/lib/cloudinary";
import { COMMANDS_BY_NAME, canRun } from "@/lib/commands";

// cloudinary + Buffer butuh Node runtime, bukan edge.
export const runtime = "nodejs";

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

/** 10 unggahan per jam per user — cukup untuk kerja normal, tidak untuk menguras kuota. */
const UPLOADS_PER_HOUR = 10;

// Hanya tipe yang memang dipakai alur import ke add-in Revit.
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ALLOWED_MIME = new Set(["application/pdf", XLSX_MIME]);

// Ekstensi ikut dipertahankan: Cloudinary menyimpan ini sebagai `raw`, dan
// add-in mengunduhnya lewat URL — tanpa ekstensi, EPPlus menolak membukanya.
const EXTENSION_FOR: Record<string, string> = {
  "application/pdf": ".pdf",
  [XLSX_MIME]: ".xlsx",
};

/**
 * Isi file harus cocok dengan tipe yang diakukan.
 *
 * Client bebas menulis Content-Type apa pun, dan file yang menyamar jadi
 * spreadsheet akan gagal jauh di dalam Revit — di mesin orang lain, dengan
 * pesan yang tidak menyebut penyebabnya.
 */
function looksLike(mime: string, buffer: Buffer) {
  if (mime === "application/pdf") {
    return buffer.subarray(0, 4).toString("latin1") === "%PDF";
  }
  // .xlsx adalah arsip zip: dua byte pertamanya selalu "PK".
  return buffer.subarray(0, 2).toString("latin1") === "PK";
}

// Cloudinary public_id ikut masuk ke URL, jadi nama file dari user harus
// dibersihkan dulu — jangan biarkan "../" atau karakter aneh lolos.
function safePublicId(originalName: string) {
  const base = originalName.split(/[\\/]/).pop() ?? "upload";
  const stem = base.replace(/\.[^.]+$/, "");
  const cleaned = stem.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").slice(0, 80);
  return `${cleaned || "upload"}-${Date.now()}`;
}

// Upload: dipanggil halaman export-import sebelum insert command `import_excel`,
// supaya add-in bisa menarik file lewat URL.
//
// Butuh `projectId`, dan peran di proyek itu harus boleh menjalankan
// import_excel. Login saja tidak cukup: akun yang baru mendaftar sengaja tidak
// punya proyek apa pun (lihat migrasi 0008), dan tanpa syarat ini ia tetap bisa
// menaruh file berukuran penuh di Cloudinary berulang kali — file yang tidak
// akan pernah bisa dipakai, tapi tetap dibayar.
export async function POST(req: Request) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const limit = rateLimit(`upload:${user.id}`, UPLOADS_PER_HOUR, 60 * 60 * 1000);
  if (!limit.ok) return tooManyRequests(limit);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }

  const projectId = form.get("projectId");
  if (typeof projectId !== "string" || !projectId) {
    return NextResponse.json({ error: "field `projectId` is required" }, { status: 400 });
  }

  // Diperiksa terhadap spesifikasi command yang akan memakai file ini, bukan
  // terhadap peran yang ditulis di sini — kalau import_excel suatu saat naik
  // jadi khusus admin, syarat unggahnya ikut naik dengan sendirinya.
  // Kelas akun lebih dulu, sebelum peran proyek: akun yang kelasnya tidak
  // mencakup Revit tidak boleh sampai ke pertanyaan "peran apa dia di proyek
  // ini", karena jawabannya bisa saja "editor" — kelas dan peran adalah dua
  // pagar yang berdiri sendiri.
  const gate = await guardArea(supabase, user.id, "revit");
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: 403 });

  const role = await roleForProject(supabase, user.id, projectId);
  const spec = COMMANDS_BY_NAME["import_excel"];
  if (!role || !spec || !canRun(spec, role)) {
    return NextResponse.json(
      { error: "kamu tidak punya izin mengunggah file ke proyek ini" },
      { status: 403 }
    );
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

  if (!looksLike(file.type, buffer)) {
    return NextResponse.json(
      { error: `file contents do not match "${file.type}"` },
      { status: 415 }
    );
  }

  try {
    // Folder per user supaya file antar user tidak tercampur.
    const { url, publicId } = await uploadBuffer(
      buffer,
      `electrical-ai/imports/${user.id}`,
      safePublicId(file.name) + (EXTENSION_FOR[file.type] ?? "")
    );
    return NextResponse.json({ url, publicId });
  } catch (err) {
    console.error("[api/files/upload] cloudinary upload failed", err);
    return NextResponse.json({ error: "upload failed" }, { status: 502 });
  }
}
