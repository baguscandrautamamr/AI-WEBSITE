import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { roleForProject } from "@/lib/access";

export const runtime = "nodejs";

/**
 * Perintah yang sedang berjalan di sebuah proyek — milik siapa pun, bukan hanya
 * milik yang bertanya.
 *
 * Hak akses sudah ada sejak awal, tapi tidak ada satu pun tempat yang
 * menampilkan "siapa sedang menjalankan apa". Akibatnya dua orang bisa menekan
 * Print PDF untuk sheet yang sama pada saat yang sama: add-in menjalankan
 * keduanya, keduanya menulis ke nama berkas yang sama persis (nomor sheet +
 * nama sheet), dan yang selesai kedua menimpa yang pertama. Tidak ada galat di
 * mana pun — yang pertama hanya kehilangan berkasnya tanpa pernah tahu.
 *
 * Antrean juga satu jalur: satu Revit mengerjakan satu perintah pada satu
 * waktu. Perintah cetak 40 sheet milik orang lain berarti perintah Anda
 * menunggu belasan menit di belakangnya — dan tanpa daftar ini, yang terlihat
 * hanyalah "Menunggu diambil add-in" yang tampak seperti add-in mati.
 */

/** Yang belum selesai. Sama dengan TERMINAL di UI, dibalik. */
const IN_FLIGHT = ["pending", "processing"] as const;

/**
 * Cukup untuk melihat kesibukan proyek, tidak cukup untuk jadi halaman riwayat.
 * Antrean yang lebih panjang dari ini adalah masalah tersendiri, dan
 * menampilkan semuanya tidak membuatnya lebih terbaca.
 */
const MAX_ROWS = 30;

export async function GET(req: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const projectId = new URL(req.url).searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "parameter `projectId` wajib" }, { status: 400 });
  }

  // Diperiksa sebelum klien service dipakai. Klien itu melewati RLS, jadi
  // satu-satunya yang menjaga batas proyek di sini adalah pemeriksaan ini —
  // dan ia harus terjadi lebih dulu, bukan sesudah datanya dibaca.
  const role = await roleForProject(supabase, user.id, projectId);
  if (!role) {
    return NextResponse.json({ error: "tidak punya akses ke proyek ini" }, { status: 403 });
  }

  const service = createServiceClient();

  const { data: rows, error } = await service
    .from("commands_queue")
    .select("id, command_type, command_text, status, queued_at, user_id")
    .eq("project_id", projectId)
    .in("status", IN_FLIGHT)
    .order("queued_at", { ascending: true })
    .limit(MAX_ROWS);

  if (error) {
    console.error("[api/commands/active] query failed", error);
    return NextResponse.json({ error: "gagal membaca antrean" }, { status: 500 });
  }

  const queue = rows ?? [];

  // Nama, bukan UUID. "sedang dijalankan oleh 3f2a…" tidak memberi tahu siapa
  // yang perlu ditanya sebelum mengirim perintah yang bentrok.
  const names = new Map<string, string>();
  const ids = [...new Set(queue.map((r) => r.user_id).filter(Boolean))] as string[];

  if (ids.length) {
    const { data: people } = await service.from("users").select("id, full_name").in("id", ids);
    for (const person of people ?? []) {
      names.set(person.id, person.full_name ?? "");
    }
  }

  // Kapan add-in terakhir benar-benar mengerjakan sesuatu di proyek ini.
  //
  // Tanpa ini "Menunggu diambil add-in" adalah satu kalimat untuk dua keadaan
  // yang sangat berbeda: antrean yang bergerak tapi panjang, dan add-in yang
  // tidak mengambil apa pun karena Revit tertutup — atau karena add-in-nya
  // menunggu di project Supabase/kode proyek yang lain. Yang kedua bisa
  // ditunggu selamanya tanpa pernah terjadi apa-apa, dan itu persis keadaan
  // yang paling perlu dikatakan.
  const { data: lastDone } = await service
    .from("commands_queue")
    .select("completed_at")
    .eq("project_id", projectId)
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    addin: {
      // Ada baris `processing` = add-in sedang memegang sesuatu SEKARANG.
      busy: queue.some((row) => row.status === "processing"),
      lastSeen: (lastDone?.completed_at as string | null) ?? null,
    },
    commands: queue.map((row) => ({
      id: row.id,
      commandType: row.command_type,
      commandText: row.command_text,
      status: row.status,
      queuedAt: row.queued_at,
      // Perintah dari bot Telegram tidak punya baris users yang cocok; itu
      // bukan kesalahan, jadi namanya dikosongkan dan UI menyebutnya "lain".
      who: row.user_id ? (names.get(row.user_id) ?? "") : "",
      mine: row.user_id === user.id,
    })),
  });
}
