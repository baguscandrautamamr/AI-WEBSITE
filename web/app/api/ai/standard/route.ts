import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, tooManyRequests } from "@/lib/rateLimit";
import { anthropic, MODEL } from "@/lib/anthropic";

export const runtime = "nodejs";

/** Pertanyaan soal standar; yang lebih panjang dari ini bukan pertanyaan lagi. */
const MAX_QUESTION_CHARS = 4_000;

/** 20 pertanyaan per menit per user. */
const QUESTIONS_PER_MINUTE = 20;

const SYSTEM_PROMPT = `Kamu adalah asisten yang menjawab pertanyaan seputar standar
dan regulasi kelistrikan (SNI, PUIL, IEC, NEC, dsb.) untuk kebutuhan desain MEP.
Jawab singkat, akurat, dan sebutkan nomor standar jika relevan. Kamu TIDAK pernah
mengeksekusi apa pun di Revit — kamu murni memberi informasi.

DIAGRAM. Kalau — dan hanya kalau — pengguna meminta gambar, diagram, sketsa, atau
denah, balas dengan satu blok kode berbahasa \`svg\` berisi SVG yang utuh
(diawali <svg ...> dan diakhiri </svg>).

Aturan SVG:
- WAJIB ada viewBox, dan JANGAN setel width/height dalam piksel — biar ia
  menyesuaikan lebar layar. Pembacanya sering memakai HP.
- Bentuk viewBox mendatar dan tidak terlalu tinggi: rasio antara 4:3 dan 16:9,
  mis. viewBox="0 0 800 500". Gambar yang jangkung terpotong di layar telepon.
- SELURUH isi harus berada di dalam viewBox, dengan margin minimal 20 unit di
  keempat sisinya. Tidak boleh ada garis atau teks yang menyentuh atau melewati
  tepinya — itu penyebab paling sering gambar terlihat terpotong.
- Tata letaknya rapi: kotak sejajar, jarak antar bagian seragam, dan tidak ada
  teks yang bertumpuk dengan garis atau dengan teks lain. Kalau ruang tidak
  cukup, kurangi isinya — jangan perkecil hurufnya.
- font-size minimal 12 (pada viewBox setinggi ~500). Huruf yang lebih kecil
  tidak terbaca di HP.
- Pakai stroke dan fill dengan warna eksplisit yang terbaca di atas putih. Jangan
  mengandalkan CSS luar.
- DILARANG: <script>, <image>, <foreignObject>, atribut href, dan event handler
  seperti onclick. Semua itu dibuang sebelum digambar, dan diagram yang
  bergantung padanya akan tampil rusak.
- Setiap angka pada gambar harus angka yang sama dengan yang kamu sebut di teks
  jawaban. Gambar yang tidak cocok dengan perhitungannya lebih buruk daripada
  tidak ada gambar.
- Beri label dimensi (mis. "40 m", "Rp = 107 m") sebagai <text>, bukan hanya
  garis tanpa keterangan.

Kalau pengguna tidak meminta gambar, jawab dengan teks dan tabel seperti biasa —
jangan menyisipkan diagram atas inisiatif sendiri.`;

/** Sama dengan MAX_TURNS di src/services/standards.ts repo electrical_ai. */
const MAX_TURNS = 8;

/**
 * Diagram tidak ikut disimpan sebagai konteks.
 *
 * Ini yang menentukan apakah fitur gambar mahal atau tidak. Riwayat dikirim
 * ulang sebagai input pada SETIAP pertanyaan berikutnya, jadi satu SVG dua ribu
 * token yang lahir di pertanyaan pertama akan ditagih lagi di pertanyaan kedua,
 * ketiga, keempat — sampai ia terdorong keluar dari delapan giliran terakhir.
 * Dibiarkan begitu, beberapa diagram melipatgandakan biaya input setiap
 * permintaan selama percakapan berjalan.
 *
 * Yang ditinggalkan penanda pendek. Asisten tetap tahu ia sudah menggambar
 * sesuatu dan tentang apa; yang hilang hanya ribuan token markup yang tidak
 * pernah dibacanya lagi. Diagramnya sendiri tetap terlihat di layar — yang
 * dipangkas adalah salinan yang dikirim balik ke model.
 */
function withoutDiagrams(text: string) {
  return text.replace(/```svg\b[\s\S]*?(?:```|$)/gi, "[diagram]");
}

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
  const supabase = await createClient();

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

  if (message.length > MAX_QUESTION_CHARS) {
    return NextResponse.json(
      { error: `pertanyaan terlalu panjang (maksimal ${MAX_QUESTION_CHARS} karakter)` },
      { status: 400 }
    );
  }

  const limit = rateLimit(`ai:standard:${user.id}`, QUESTIONS_PER_MINUTE, 60_000);
  if (!limit.ok) return tooManyRequests(limit);

  const question = message.trim();

  const { data: thread } = await supabase
    .from("standards_threads")
    .select("turns")
    .eq("user_id", user.id)
    .maybeSingle();

  // Utas ini dipakai bersama bot Telegram, jadi bentuk barisnya ditentukan dua
  // penulis, bukan satu. Yang tidak berbentuk giliran dibuang: satu baris rusak
  // seharusnya tidak membuat pertanyaan berikutnya ditolak gateway dengan 400.
  const previous: Turn[] = (Array.isArray(thread?.turns) ? thread!.turns : []).filter(
    (t: unknown): t is Turn =>
      Boolean(t) &&
      typeof t === "object" &&
      ((t as Turn).role === "user" || (t as Turn).role === "assistant") &&
      typeof (t as Turn).text === "string" &&
      (t as Turn).text.trim().length > 0
  );

  // Jawaban dikirim bertahap, bukan sebagai satu blok di akhir.
  //
  // Pertanyaan standar dijawab beberapa paragraf, dan menunggu seluruhnya
  // selesai berarti belasan detik layar diam. Isinya sama; yang berubah adalah
  // orangnya bisa mulai membaca kalimat pertama sementara sisanya masih ditulis.
  //
  // Bentuknya NDJSON — satu objek JSON per baris — bukan teks polos: dengan
  // teks polos, kegagalan di tengah aliran tidak bisa dibedakan dari jawaban,
  // dan status HTTP sudah terlanjur terkirim sebelum kegagalannya diketahui.
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (chunk: object) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(chunk)}\n`));

      let reply = "";

      try {
        const response = anthropic.messages.stream({
          model: MODEL,
          // Naik dari 4096 sejak diagram diizinkan: satu SVG berdimensi bisa
          // menghabiskan ribuan token sendiri, dan jawaban yang terpotong di
          // tengah tag menghasilkan gambar rusak, bukan gambar pendek.
          max_tokens: 8192,
          system: SYSTEM_PROMPT,
          messages: [
            ...previous.map((t) => ({ role: t.role, content: t.text })),
            { role: "user" as const, content: question },
          ],
        });

        for await (const event of response) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta" &&
            event.delta.text
          ) {
            reply += event.delta.text;
            send({ t: event.delta.text });
          }
        }
      } catch (err) {
        console.error("[api/ai/standard] gateway call failed", err);
        send({ e: "asisten standar sedang tidak bisa dihubungi" });
        controller.close();
        return;
      }

      if (!reply) {
        send({ e: "asisten tidak mengembalikan jawaban" });
        controller.close();
        return;
      }

      const all: Turn[] = [
        ...previous,
        { role: "user", text: question },
        { role: "assistant", text: withoutDiagrams(reply) },
      ];

      // chat_id dibiarkan apa adanya untuk baris yang sudah ada; utas dari
      // website tidak punya chat Telegram, dan kolomnya memang nullable.
      const { error: saveError } = await supabase
        .from("standards_threads")
        .upsert(
          { user_id: user.id, turns: all.slice(-MAX_TURNS), updated_at: new Date().toISOString() },
          { onConflict: "user_id" }
        );

      // Gagal menyimpan tidak boleh menelan jawaban yang sudah terbaca — user
      // tetap dapat jawabannya, hanya kehilangan konteks di pertanyaan berikutnya.
      if (saveError) console.error("[api/ai/standard] gagal menyimpan utas", saveError);

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      // Tanpa ini sebagian proxy menahan aliran sampai penuh, yang membuang
      // seluruh gunanya.
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

// GET — utas yang tersimpan, supaya halaman Standard tidak mulai kosong setiap
// kali dibuka ulang padahal server masih mengingat percakapannya.
export async function GET() {
  const supabase = await createClient();

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

// DELETE — mengosongkan utas.
//
// Barisnya dikosongkan, bukan dihapus: `standards_threads` juga dipakai bot
// Telegram, dan barisnya membawa `chat_id` serta `started_at` yang bukan milik
// website. Yang diminta orang saat menekan "hapus chat" adalah percakapannya
// hilang, bukan catatan bahwa ia pernah punya utas.
//
// Klien sesi, jadi RLS `standards_threads_self` yang menentukan baris mana yang
// tersentuh — tidak mungkin mengosongkan utas orang lain dari sini.
export async function DELETE() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("standards_threads")
    .update({ turns: [], updated_at: new Date().toISOString() })
    .eq("user_id", user.id);

  if (error) {
    console.error("[api/ai/standard] gagal mengosongkan utas", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
