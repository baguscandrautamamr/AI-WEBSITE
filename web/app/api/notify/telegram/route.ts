import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { rateLimit, tooManyRequests } from "@/lib/rateLimit";
import { parseChatId } from "@/lib/telegramId";

export const runtime = "nodejs";

/**
 * Menautkan akun website ini ke sebuah chat Telegram, supaya add-in bisa
 * mengabari saat perintah selesai.
 *
 * Kenapa perlu: perintah dari bot dijawab bot itu sendiri di chat yang
 * mengirimnya. Perintah dari website tidak dijawab ke mana pun — satu-satunya
 * tempat hasilnya muncul adalah tab yang mengirimnya. Cetak 40 sheet yang
 * dikirim lalu ditinggal ke lapangan karena itu tidak punya cara memberi tahu
 * bahwa ia sudah jalan, atau sudah gagal.
 *
 * Yang disimpan adalah `users.telegram_user_id` milik pemanggil sendiri, dan
 * hanya milik pemanggil: id barisnya diambil dari sesi, tidak pernah dari isi
 * request. Jadi tidak ada bentuk request apa pun di sini yang bisa mengarahkan
 * hasil pekerjaan orang lain ke chat penyerang.
 *
 * Kolomnya UNIQUE di database (migrasi 0001, dibuat nullable di 0008), jadi
 * nomor yang sudah dipakai akun lain ditolak Postgres, bukan oleh pemeriksaan
 * di sini yang bisa kalah lomba dengan request bersamaan.
 */

/** Cukup untuk mencoba beberapa kali kalau nomornya salah salin. */
const LINKS_PER_HOUR = 20;

/** Pelanggaran unique constraint di Postgres. */
const UNIQUE_VIOLATION = "23505";

async function currentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await createServiceClient()
    .from("users")
    .select("telegram_user_id")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[api/notify/telegram] read failed", error);
    return NextResponse.json({ error: "gagal membaca pengaturan" }, { status: 500 });
  }

  // String, bukan number: nomor Telegram sudah mendekati batas presisi JSON di
  // beberapa klien, dan yang dibutuhkan halaman ini hanya menampilkannya.
  const linked = data?.telegram_user_id;

  return NextResponse.json({
    chatId: linked == null ? null : String(linked),
    // Apakah penautan sempat dibuktikan dengan pesan yang benar-benar terkirim.
    // Tanpa token bot di deployment ini, penautan tetap bisa dilakukan — hanya
    // tidak terbukti sampai perintah pertama selesai.
    canVerify: Boolean(process.env.TELEGRAM_BOT_TOKEN),
  });
}

export async function PUT(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const limit = rateLimit(`notify:${user.id}`, LINKS_PER_HOUR, 60 * 60 * 1000);
  if (!limit.ok) return tooManyRequests(limit);

  let body: { chatId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body bukan JSON" }, { status: 400 });
  }

  const raw = typeof body.chatId === "string" ? body.chatId : String(body.chatId ?? "");
  const chatId = parseChatId(raw);
  if (chatId === null) {
    return NextResponse.json({ error: "notify.badId" }, { status: 400 });
  }

  // Dibuktikan lebih dulu, kalau deployment ini memegang token botnya.
  //
  // Bukan sekadar kenyamanan: nomor yang salah salin — satu digit tertukar —
  // adalah nomor yang sah milik orang lain, dan menyimpannya tanpa bukti
  // berarti hasil pekerjaan orang ini mulai berangkat ke chat orang itu tanpa
  // ada satu pun yang terlihat salah di halaman ini. Telegram menolak pesan
  // pertama ke seseorang yang belum pernah membuka percakapan dengan botnya,
  // jadi pemeriksaan ini menangkap hampir semua salah ketik.
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (token) {
    const sent = await sendConfirmation(token, chatId);
    if (!sent.ok) return NextResponse.json({ error: sent.error }, { status: 400 });
  }

  const { error } = await createServiceClient()
    .from("users")
    .update({ telegram_user_id: chatId })
    .eq("id", user.id);

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return NextResponse.json({ error: "notify.taken" }, { status: 409 });
    }
    console.error("[api/notify/telegram] update failed", error);
    return NextResponse.json({ error: "gagal menyimpan" }, { status: 500 });
  }

  return NextResponse.json({ chatId: String(chatId), verified: Boolean(token) });
}

export async function DELETE() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { error } = await createServiceClient()
    .from("users")
    .update({ telegram_user_id: null })
    .eq("id", user.id);

  if (error) {
    console.error("[api/notify/telegram] unlink failed", error);
    return NextResponse.json({ error: "gagal melepas tautan" }, { status: 500 });
  }

  return NextResponse.json({ chatId: null });
}

/**
 * Satu pesan ke chat yang diklaim, untuk membuktikan bahwa ia memang chat
 * orang yang sedang menautkannya.
 *
 * Alasan penolakan Telegram diteruskan apa adanya lewat kunci i18n, karena dua
 * penolakan yang paling mungkin menuntut dua tindakan yang berbeda: "belum
 * pernah membuka percakapan dengan bot" berarti kirim /start dulu, sedangkan
 * "chat not found" berarti nomornya memang salah.
 */
async function sendConfirmation(
  token: string,
  chatId: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text:
          "✅ Revit Command Center tertaut ke chat ini.\n"
          + "Mulai sekarang perintah yang Anda kirim dari website dikabari hasilnya di sini.",
      }),
      // Jangan menahan halaman menunggu Telegram yang sedang lambat.
      signal: AbortSignal.timeout(10_000),
    });

    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; description?: string }
      | null;

    if (payload?.ok) return { ok: true };

    const description = payload?.description ?? "";
    if (/can't initiate conversation|bot was blocked|blocked by the user/i.test(description)) {
      return { ok: false, error: "notify.needStart" };
    }

    console.warn("[api/notify/telegram] telegram refused", response.status, description);
    return { ok: false, error: "notify.notFound" };
  } catch (err) {
    console.error("[api/notify/telegram] telegram unreachable", err);
    return { ok: false, error: "notify.unreachable" };
  }
}
