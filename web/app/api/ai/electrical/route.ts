import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { guardArea, roleForProject } from "@/lib/access";
import { rateLimit, tooManyRequests } from "@/lib/rateLimit";
import { logAiEvent } from "@/lib/aiEvents";
import { propose } from "@/lib/propose";

export const runtime = "nodejs";

/** Satu kalimat perintah; yang lebih panjang dari ini hampir pasti bukan itu. */
const MAX_MESSAGE_CHARS = 2_000;

/** 30 giliran per menit per user — jauh di atas kecepatan mengetik orang. */
const TURNS_PER_MINUTE = 30;

/**
 * Berapa pembacaan yang boleh dijalankan sistem sendiri untuk SATU pertanyaan.
 *
 * Empat, karena urutan yang diwajibkan prompt — categories → parameters →
 * elements — adalah tiga, dan satu sisa untuk pertanyaan yang butuh satu
 * penyaringan lagi.
 *
 * Ditegakkan DI SINI, bukan hanya di browser yang menjalankan loop-nya. Yang
 * melingkar adalah client, jadi client-lah yang menghitung; tapi sebuah bug di
 * sana — atau sebuah `curl` — berarti pemanggilan model tanpa akhir, dan yang
 * membayarnya kuota gateway. Batas laju 30 giliran/menit memang menahan lajunya,
 * tapi ia tidak pernah menghentikan apa pun: 30 per menit selamanya tetap
 * selamanya.
 */
const MAX_AUTO_STEPS = 4;

/**
 * Giliran yang MEMBANGUNKAN model setelah sebuah pembacaan selesai.
 *
 * Disusun di server, bukan dikirim client, dan itu bukan soal keamanan
 * melainkan soal satu kalimat yang menentukan perilaku. Kalau client yang
 * mengarang kalimat ini, ia akan berbeda antara satu tempat pemanggil dan
 * tempat berikutnya, dan yang berbeda adalah apakah model menjawab atau
 * memanggil tool sekali lagi "untuk memastikan".
 *
 * Bentuknya catatan sistem, sama dengan catatan lain di riwayat (lihat
 * chatHistory.ts), karena itu memang apa adanya: tidak ada manusia yang mengetik
 * apa pun pada giliran ini.
 */
const CONTINUATION =
  "[CATATAN SISTEM] Hasil perintah bacamu sudah ada di catatan di atas — " +
  "pengguna TIDAK mengetik apa pun, sistem yang membangunkanmu. Kalau catatan itu " +
  "sudah cukup untuk menjawab pertanyaan terakhir pengguna, JAWAB SEKARANG dengan " +
  "angka dan nama dari catatan itu, dan jangan memanggil tool apa pun. Kalau memang " +
  "masih kurang satu langkah baca lagi, panggil tool bacanya — pakai nama yang " +
  "persis seperti di blok ISI HASILNYA.";

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
    /**
     * Giliran ini dibangkitkan sistem setelah sebuah pembacaan selesai, bukan
     * diketik orang. `message` tidak dipakai; yang dikirim CONTINUATION.
     */
    continuation?: boolean;
    /** Pembacaan otomatis yang ke berapa dalam pertanyaan ini, mulai dari 1. */
    step?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body harus JSON" }, { status: 400 });
  }

  const projectId = body.projectId;

  const continuation = body.continuation === true;
  const step = Number.isInteger(body.step) ? (body.step as number) : 0;

  // Langkah yang melewati batas ditolak di sini, sebelum satu token pun dibayar.
  // Client memang menghitung sendiri, tapi hitungan client bukan batas — ia
  // hanya niat baik sebuah program yang bisa punya bug.
  if (continuation && (step < 1 || step > MAX_AUTO_STEPS)) {
    return NextResponse.json(
      { error: `langkah baca otomatis dibatasi ${MAX_AUTO_STEPS} per pertanyaan` },
      { status: 400 }
    );
  }

  // Giliran lanjutan tidak punya pesan dari siapa pun, dan itu wajar: yang
  // ditanyakan sudah ada di riwayat, dan yang baru adalah hasil pembacaannya.
  // Kalimatnya disusun server (lihat CONTINUATION).
  const message = continuation
    ? CONTINUATION
    : typeof body.message === "string"
      ? body.message.trim()
      : "";

  if (!message) return NextResponse.json({ error: "`message` wajib diisi" }, { status: 400 });
  if (!continuation && message.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json(
      { error: `pesan terlalu panjang (maksimal ${MAX_MESSAGE_CHARS} karakter)` },
      { status: 400 }
    );
  }
  if (!projectId) return NextResponse.json({ error: "`projectId` wajib diisi" }, { status: 400 });

  // Peran menentukan tool apa yang boleh ditawarkan. Seorang viewer tidak
  // seharusnya melihat asisten menawarkan /place_lighting, lalu ditolak server
  // sesudahnya — lebih jujur kalau pilihannya memang tidak pernah ada.
  // Kelas akun lebih dulu, sebelum peran proyek: akun yang kelasnya tidak
  // mencakup Revit tidak boleh sampai ke pertanyaan "peran apa dia di proyek
  // ini", karena jawabannya bisa saja "editor" — kelas dan peran adalah dua
  // pagar yang berdiri sendiri.
  const gate = await guardArea(supabase, user.id, "revit");
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: 403 });

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

  const result = await propose({
    role,
    message,
    history: body.history,
    context: body.context,
  });

  // Satu tempat mencatat, untuk semua hasil. `propose` menyusun bagian yang
  // hanya ia ketahui — hasilnya apa, tool apa, token berapa, terpotong atau
  // tidak; yang ditambahkan di sini bagian yang hanya route tahu: mode-nya, dan
  // langkah keberapa dalam rantai baca.
  await logAiEvent(supabase, user.id, {
    mode: "electrical",
    step,
    ...result.event,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.payload);
}
