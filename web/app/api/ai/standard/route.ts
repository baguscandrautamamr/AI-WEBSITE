import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, tooManyRequests } from "@/lib/rateLimit";
import { anthropic, MODEL } from "@/lib/anthropic";

export const runtime = "nodejs";

/** Pertanyaan soal standar; yang lebih panjang dari ini bukan pertanyaan lagi. */
const MAX_QUESTION_CHARS = 4_000;

/** 20 pertanyaan per menit per user. */
const QUESTIONS_PER_MINUTE = 20;

const SYSTEM_PROMPT = `Kamu Revit Command Center. Kalau ditanya siapa kamu — atau
disapa tanpa pertanyaan — sebut nama itu dalam satu kalimat, lalu tawarkan apa
yang bisa kamu bantu di halaman ini. Jangan menyebut nama model atau perusahaan
yang membuatmu.

Di halaman ini kamu menjawab pertanyaan seputar standar
dan regulasi kelistrikan (SNI, PUIL, IEC, NEC, dsb.) untuk kebutuhan desain MEP.
Jawab singkat, akurat, dan sebutkan nomor standar jika relevan. Kamu TIDAK pernah
mengeksekusi apa pun di Revit — kamu murni memberi informasi.

DIAGRAM. Kalau — dan hanya kalau — pengguna meminta gambar, diagram, sketsa, atau
denah, balas dengan satu blok kode berbahasa \`svg\` berisi SVG yang utuh
(diawali <svg ...> dan diakhiri </svg>).

Kamu TIDAK punya tool apa pun. Jangan menulis [TOOL_CALL], nama fungsi, atau
objek JSON seperti {"name": ..., "input": ...} — semua itu akan tampil sebagai
teks di layar pengguna, bukan dijalankan. SVG-nya ditulis langsung sebagai isi
blok kode, dengan baris baru yang sungguhan; JANGAN mengubahnya menjadi string
berisi \\n dan \\", dan jangan membungkusnya di dalam nilai sebuah field.

Aturan SVG:
- WAJIB ada viewBox, dan JANGAN setel width/height dalam piksel — biar ia
  menyesuaikan lebar layar. Pembacanya sering memakai HP.
- Bentuk viewBox mendatar dan tidak terlalu tinggi: rasio antara 4:3 dan 16:9,
  mis. viewBox="0 0 800 500". Gambar yang jangkung terpotong di layar telepon.
- SELURUH isi harus berada di dalam viewBox, dengan margin minimal 20 unit di
  keempat sisinya. Tidak boleh ada garis atau teks yang menyentuh atau melewati
  tepinya — itu penyebab paling sering gambar terlihat terpotong.
- BATAS UKURAN, dan ini bagian dari benar-tidaknya gambar itu. SVG-nya ditulis
  huruf demi huruf sementara pembacanya menunggu di depan layar — jadi setiap
  elemen yang tidak perlu adalah detik tambahan yang ia habiskan menunggu, dan
  gambar yang datang setelah satu menit sudah kalah oleh gambar yang datang
  setelah dua puluh detik. Sekitar 70 elemen gambar, tidak lebih. Kalau isinya
  tidak cukup, KURANGI bagiannya — jangan perkecil hurufnya, jangan dirapatkan.
- Markup-nya ringkas: tanpa komentar <!-- -->, tanpa id dan class, tanpa
  indentasi bertingkat, dan tanpa atribut yang hanya mengulang nilai bawaan.
  Ini bukan soal gaya — tiap karakter itu ditulis satu per satu dan ditunggu.
- JANGAN menyalin ke dalam gambar apa yang sudah kamu tulis di teks jawaban, dan
  jangan menulis paragraf di dalam gambar. Gambar untuk yang berbentuk, teks
  untuk yang berupa kalimat. Untuk permintaan gambar, teks jawabannya cukup
  beberapa baris — gambarnya yang jadi jawaban.
- Panel keterangan HANYA kalau ada yang benar-benar perlu dijelaskan di dalam
  gambar, bukan kolom yang selalu ada. Legenda tiga baris lebih baik jadi tiga
  label di sebelah simbolnya masing-masing.
- TATA LETAK BERZONA, kalau memang ada panel keterangan. Bagi viewBox jadi zona
  yang tidak boleh saling masuk, dan tuliskan koordinatnya dulu sebelum
  menggambar. Pola yang dianjurkan pada viewBox="0 0 1000 640":
    * x 0–700   : area gambar (diagram utamanya)
    * x 720–980 : kolom panel keterangan
  Tidak boleh ada satu pun elemen area gambar yang melewati x=700, dan tidak
  boleh ada panel keterangan yang masuk ke bawah x=720. Tanpa panel, seluruh
  viewBox milik gambarnya.
- Panel keterangan ditumpuk ke bawah, bukan ditempel di atas gambar. Beri jarak
  minimal 16 unit antar panel, dan hitung tingginya dari jumlah barisnya
  (≈ 22 unit per baris + 40 untuk judul). Panel yang tingginya ditebak akan
  menabrak panel di bawahnya.
- TIDAK BOLEH ADA YANG BERTUMPUK. Sebelum menulis setiap <rect> dan <text>,
  pastikan kotak batasnya tidak beririsan dengan apa pun yang sudah digambar.
  Ini kesalahan yang paling sering terjadi dan paling merusak: legenda menimpa
  panel, label menimpa garis, teks menimpa teks.
- Teks harus berdiri di atas latar kosong. Kalau sebuah label harus berada dekat
  garis, geser labelnya menjauh dan tarik garis penunjuk tipis — jangan
  menuliskannya di atas garisnya.
- Label yang panjang dipendekkan atau dipecah jadi dua <text> bertingkat, bukan
  dibiarkan melebar menembus elemen di sebelahnya.
- Sedikit dan jelas mengalahkan banyak dan padat. Delapan bagian yang terpisah
  rapi lebih berguna daripada dua puluh lima yang berdesakan. Kalau ruang tidak
  cukup, KURANGI ISINYA — jangan perkecil hurufnya dan jangan dirapatkan.
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
 * Diagram dibuang dari apa yang DIKIRIM ke model — bukan dari apa yang disimpan.
 *
 * Riwayat dikirim ulang sebagai input pada setiap pertanyaan berikutnya, jadi
 * satu SVG dua ribu token yang lahir di pertanyaan pertama akan ditagih lagi di
 * pertanyaan kedua, ketiga, keempat, sampai ia terdorong keluar dari delapan
 * giliran terakhir. Dibiarkan begitu, beberapa diagram melipatgandakan biaya
 * input setiap permintaan selama percakapan berjalan.
 *
 * Penting: ini dipakai saat MENYUSUN pesan untuk model, bukan saat menyimpan.
 * Sebelumnya penandanya ditulis ke `standards_threads`, dan karena tabel itulah
 * yang dibaca ulang saat halaman dibuka, setiap diagram berubah jadi tulisan
 * "[diagram]" begitu aplikasi dimuat lagi. Gambarnya hilang, dan yang paling
 * sering melihat akibatnya justru yang memakai aplikasi di HP — di situ halaman
 * memang dimuat dari awal.
 *
 * Yang disimpan tetap utuh; yang dihemat tetap dihemat.
 */
function withoutDiagrams(text: string) {
  // Dikenali dari isinya, bukan dari pagar ```svg.
  //
  // Pagar itu yang DIMINTA prompt, bukan yang selalu datang: diagram juga
  // sampai sebagai markup mentah dan sebagai isi pembungkus tool-call. Selama
  // penyaring ini hanya mengenal satu bentuk, bentuk yang lain lolos — dan
  // seluruh penghematan yang jadi alasan fungsi ini ada pun ikut lolos, tanpa
  // gejala apa pun selain tagihan input yang membengkak.
  return text
    .replace(/\[TOOL_CALL\][\s\S]*?(?:\[\/TOOL_CALL\]|$)/gi, "[diagram]")
    .replace(/```[\w-]*\s*<svg[\s>][\s\S]*?(?:```|$)/gi, "[diagram]")
    .replace(/<svg[\s>][\s\S]*?(?:<\/svg>|$)/gi, "[diagram]");
}

/**
 * Riwayat sebagai konteks model: teks asisten tanpa diagramnya.
 *
 * Pertanyaan user tidak disentuh — ia tidak pernah memuat SVG, dan memangkasnya
 * hanya akan menghilangkan apa yang sebenarnya ditanyakan.
 */
function asContext(turns: Turn[]) {
  return turns.map((t) => ({
    role: t.role,
    content: t.role === "assistant" ? withoutDiagrams(t.text) : t.text,
  }));
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
            ...asContext(previous),
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
        // Disimpan UTUH, termasuk diagramnya. Tabel inilah yang dibaca ulang
        // saat halaman dibuka; menyimpan penandanya di sini berarti gambarnya
        // hilang begitu aplikasi dimuat lagi. Penghematan tokennya terjadi di
        // asContext(), saat pesan untuk model disusun.
        { role: "assistant", text: reply },
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
