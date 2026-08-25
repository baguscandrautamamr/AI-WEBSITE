import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { guardArea, roleForProject } from "@/lib/access";
import { rateLimit, tooManyRequests } from "@/lib/rateLimit";
import { buildMessages } from "@/lib/chatHistory";
import { anthropic, MODEL } from "@/lib/anthropic";
import { ELECTRICAL_SYSTEM_PROMPT, mentionsCommand, toolsForRole, withModelContext } from "@/lib/aiTools";
import { COMMANDS_BY_NAME, canAutoRun, canRun } from "@/lib/commands";
import { CommandValidationError, buildPayload } from "@/lib/queue";
import { resolveFamilies } from "@/lib/familyChoice";
import { expandRooms } from "@/lib/roomList";
import { type AiEvent, logAiEvent, statsOf } from "@/lib/aiEvents";

export const runtime = "nodejs";

/** Satu kalimat perintah; yang lebih panjang dari ini hampir pasti bukan itu. */
const MAX_MESSAGE_CHARS = 2_000;

/** 30 giliran per menit per user — jauh di atas kecepatan mengetik orang. */
const TURNS_PER_MINUTE = 30;

/**
 * Ruang untuk thinking + jawaban + panggilan tool, sekaligus.
 *
 * Dulu 2048, dan itu terlalu sempit dengan cara yang tidak terlihat. Pada Sonnet
 * 5 adaptive thinking aktif secara default dan `max_tokens` membatasi thinking
 * BESERTA jawabannya (lihat lib/anthropic.ts) — jadi permintaan yang butuh
 * berpikir agak panjang ("semua ruangan, tiga kategori") bisa menghabiskan
 * jatahnya sebelum blok `tool_use` selesai ditulis.
 *
 * Yang terjadi kemudian bukan galat. Jawabannya berhenti di tengah, tidak ada
 * blok tool_use untuk ditemukan, dan permintaan itu jatuh ke cabang "model
 * bertanya balik" di bawah — sehingga yang dibaca orangnya adalah "Bisa
 * diperjelas maksudnya?" untuk kalimat yang sudah sangat jelas. Ia lalu
 * mengetik ulang kalimat yang sama, dan gagal dengan cara yang sama.
 *
 * 16.000 adalah angka yang dianjurkan untuk permintaan non-streaming: cukup
 * lapang, dan masih di bawah batas waktu HTTP bawaan SDK. Mode standard yang
 * memang dialirkan memakai 32.000.
 */
const MAX_TOKENS = 16_000;

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

  const tools = toolsForRole(role);
  const messages = buildMessages(body.history, message);
  const system = withModelContext(ELECTRICAL_SYSTEM_PROMPT, body.context);

  const ask = (force: boolean) =>
    anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools: tools as never,
      // `any` = wajib memakai salah satu tool. Dipakai hanya pada percobaan
      // kedua, saat percobaan pertama jelas-jelas BERMAKSUD mengirim perintah
      // tapi menuliskannya sebagai teks.
      ...(force ? { tool_choice: { type: "any" as const } } : {}),
      messages,
    });

  const startedAt = Date.now();

  let response;
  try {
    response = await ask(false);
  } catch (err) {
    console.error("[api/ai/electrical] gateway call failed", err);
    await logAiEvent(supabase, user.id, {
      mode: "electrical",
      outcome: "error",
      latency_ms: Date.now() - startedAt,
      step,
      error: "gateway_unreachable",
    });
    return NextResponse.json({ error: "asisten sedang tidak bisa dihubungi" }, { status: 502 });
  }

  let toolUse = response.content.find((b) => b.type === "tool_use");
  let text = textOf(response.content);

  let stats = statsOf(response);
  let forcedRetry = false;

  /**
   * Satu-satunya jalan keluar yang berhasil, supaya tidak ada cabang yang lupa
   * mencatat.
   *
   * Route ini punya delapan titik `return` yang berbeda — perintah siap,
   * perintah dimekarkan per ruangan, daftar ruangan belum terbaca, family
   * ditahan, argumen kurang, model bertanya balik, tool di luar peran, jawaban
   * terpotong. Mencatat di masing-masing berarti cabang kesembilan yang
   * ditambahkan nanti akan hilang dari hitungan tanpa ada yang menyadarinya,
   * dan yang hilang justru cabang yang baru — yang paling perlu diawasi.
   */
  const finish = async (
    payload: Record<string, unknown>,
    event: Pick<AiEvent, "outcome" | "tool"> & Partial<AiEvent>
  ) => {
    await logAiEvent(supabase, user.id, {
      mode: "electrical",
      ...stats,
      latency_ms: Date.now() - startedAt,
      forced_retry: forcedRetry,
      step,
      ...event,
    });
    return NextResponse.json(payload);
  };

  /**
   * Jawaban yang MENULIS perintahnya alih-alih memanggil tool-nya, dicoba sekali
   * lagi dengan tool yang diwajibkan.
   *
   * Ini kegagalan yang tidak terlihat seperti kegagalan: teks
   * `/place_lighting "LOUNGE 5" count=10 …` plus kalimat "sudah dikirim ke
   * antrean Revit", tanpa satu pun tool dipanggil — jadi tidak ada baris di
   * commands_queue, tidak ada apa pun di Revit, dan yang dibaca orangnya adalah
   * pernyataan bahwa perintahnya sudah berangkat. Sebabnya ada di riwayat: usulan
   * yang berangkat dicatat sebagai giliran asisten, dan bentuk catatan itu ditiru
   * model sebagai gaya jawabannya sendiri.
   *
   * Catatan riwayatnya sudah diperbaiki (lihat chatHistory.ts), dan ini
   * penjagaan lapis kedua: maksudnya sudah jelas, jadi yang kurang cuma
   * panggilan tool-nya.
   */
  if (!toolUse && tools.length > 0 && mentionsCommand(text)) {
    console.warn("[api/ai/electrical] jawaban menulis perintah tanpa memanggil tool — dipaksa");
    forcedRetry = true;
    try {
      const forced = await ask(true);
      const forcedTool = forced.content.find((b) => b.type === "tool_use");
      if (forcedTool) {
        toolUse = forcedTool;
        text = textOf(forced.content) || "";
        // Angka pemakaian ikut yang KEDUA: itu jawaban yang benar-benar dipakai.
        // Percobaan pertamanya tetap terhitung lewat `forced_retry`, jadi
        // biayanya tidak hilang dari catatan — yang hilang cuma penggandaannya.
        stats = statsOf(forced);
      }
    } catch (err) {
      // Percobaan kedua yang gagal bukan alasan menjatuhkan giliran ini: jawaban
      // pertamanya tetap ada, dan di bawah ia dikembalikan dengan keterangan
      // bahwa TIDAK ada perintah yang dikirim.
      console.error("[api/ai/electrical] forced tool retry failed", err);
    }
  }

  // Tidak memilih tool = model bertanya balik atau menolak. Itu hasil yang sah,
  // bukan kegagalan: pertanyaan klarifikasi justru yang membuat mode ini aman.
  if (!toolUse || toolUse.type !== "tool_use") {
    /**
     * KECUALI kalau jawabannya memang terpotong di batas token.
     *
     * Ini yang selama ini tidak pernah dibaca: `stop_reason` tidak disentuh di
     * mana pun di repo, jadi jawaban yang habis jatahnya di tengah — tanpa blok
     * tool_use, karena belum sampai menulisnya — tidak bisa dibedakan dari model
     * yang memang memilih bertanya balik. Keduanya berakhir di cabang ini, dan
     * yang ditampilkan untuk keduanya adalah sebuah pertanyaan klarifikasi.
     *
     * Bedanya besar bagi orangnya. Pertanyaan klarifikasi bisa dijawab;
     * jawaban yang terpotong tidak bisa — mengetik ulang kalimat yang sama akan
     * terpotong lagi di tempat yang sama. Jadi dikatakan apa adanya, beserta
     * satu-satunya hal yang memang menolong: memperkecil permintaannya.
     */
    if (stats.stop_reason === "max_tokens") {
      console.warn("[api/ai/electrical] jawaban terpotong di batas token");
      return finish(
        {
          kind: "reply",
          text:
            "Jawaban saya terpotong sebelum selesai, jadi tidak ada perintah yang " +
            "dikirim ke Revit. Coba pecah permintaannya jadi lebih kecil — misalnya " +
            "satu kategori perangkat dulu, atau sebagian ruangan saja.",
          nothingSent: true,
        },
        { outcome: "truncated", tool: null }
      );
    }

    return finish(
      {
        kind: "reply",
        text: text || "Bisa diperjelas maksudnya?",
        // Jawaban yang menyebut sebuah perintah padahal tidak ada yang dikirim
        // ditandai, supaya panel chat mengatakannya terus terang alih-alih
        // membiarkan kalimat model berdiri sebagai laporan.
        nothingSent: mentionsCommand(text),
      },
      { outcome: "reply", tool: null, wrote_command_as_text: mentionsCommand(text) }
    );
  }

  const spec = COMMANDS_BY_NAME[toolUse.name];
  if (!spec || !canRun(spec, role)) {
    // Model menyebut command di luar katalog atau di luar perannya. Dijawab
    // sebagai teks supaya percakapan tetap jalan.
    return finish(
      {
        kind: "reply",
        text: text || `Perintah "${toolUse.name}" tidak tersedia untuk peranmu di proyek ini.`,
      },
      { outcome: "unavailable_tool", tool: toolUse.name }
    );
  }

  const values = (toolUse.input ?? {}) as Record<string, unknown>;

  // Divalidasi dengan aturan yang sama persis dengan form, supaya usulan yang
  // pasti ditolak server ketahuan di sini — lengkap dengan alasannya, sehingga
  // pengguna bisa melengkapinya di form tanpa menebak.
  try {
    // Nama family yang ditebak diperiksa terhadap isi model yang sebenarnya
    // SEBELUM perintahnya boleh berangkat. "Lampu downlight" tidak menyebut
    // family mana pun; model memilih yang paling masuk akal, dan yang paling
    // masuk akal bukan selalu yang benar. Add-in tidak pernah mengeluh soal
    // nama yang tidak ketemu — ia memakai bawaannya dan melaporkan sukses.
    const resolved = resolveFamilies(spec, values, body.context?.familyTypes);

    if (resolved.question) {
      // Ditahan, dan daftarnya ditawarkan di percakapan — satu ketukan, bukan
      // mengisi ulang formulir.
      return finish(
        {
          kind: "choose",
          command: spec.name,
          values: resolved.values,
          note: text || null,
          ...resolved.question,
        },
        { outcome: "choose", tool: spec.name }
      );
    }

    // "Semua ruangan" dimekarkan jadi satu perintah per ruangan.
    //
    // Add-in mengerjakan satu ruangan per perintah, jadi yang tersisa cuma
    // pertanyaan siapa yang menyalinnya lima kali. Dimekarkan di sini, bukan
    // dengan meminta model memanggil tool lima kali: model yang diminta begitu
    // akan memanggilnya empat kali pada percobaan yang lain, dan tidak ada yang
    // menyadarinya kecuali dari gambar yang kurang satu ruangan.
    const roomField = spec.positional?.name;
    const rooms = roomField
      ? expandRooms(resolved.values[roomField], body.context?.rooms ?? [])
      : null;

    if (rooms) {
      if (rooms.length === 0) {
        return finish(
          {
            kind: "reply",
            text:
              text ||
              "Daftar ruangan belum terbaca dari Revit, jadi \"semua ruangan\" belum bisa saya jabarkan. Buka Revit dengan add-in berjalan, atau sebutkan nama ruangannya.",
          },
          { outcome: "reply", tool: spec.name }
        );
      }

      const items = rooms.map((room) => {
        const values = { ...resolved.values, [roomField as string]: room };
        return { room, values, commandText: buildPayload(spec, values).commandText };
      });

      return finish(
        {
          kind: "batch",
          command: spec.name,
          items,
          confirm: Boolean(spec.confirm),
          note: text || null,
        },
        { outcome: "batch", tool: spec.name }
      );
    }

    const { commandText } = buildPayload(spec, resolved.values);
    return finish(
      {
        kind: "command",
        command: spec.name,
        values: resolved.values,
        commandText,
        confirm: Boolean(spec.confirm),
        note: text || null,
        /**
         * Perintah ini boleh dijalankan sistem sendiri, dan hasilnya boleh
         * dikembalikan kepada model sebagai langkah berikutnya.
         *
         * Dijawab SERVER, dari katalog (lihat canAutoRun), bukan disimpulkan
         * browser dari nama perintahnya. Bukan sebagai pagar keamanan — sebuah
         * client memang bisa memanggil /api/commands sendiri untuk apa pun yang
         * perannya izinkan — melainkan supaya jawaban atas "perintah mana yang
         * boleh berjalan tanpa ditunggui" hanya ada di satu tempat. Dua tempat
         * berarti dua jawaban, dan yang kedua ketinggalan saat katalognya berubah.
         *
         * Yang MENGHITUNG langkahnya tetap client: ia yang melingkar, jadi ia
         * yang tahu sudah berapa kali. Server hanya menolak yang melewati batas.
         */
        autoRun: canAutoRun(spec),
      },
      { outcome: "command", tool: spec.name }
    );
  } catch (err) {
    if (err instanceof CommandValidationError) {
      return finish(
        {
          kind: "incomplete",
          command: spec.name,
          values,
          issues: err.issues,
          note: text || null,
        },
        { outcome: "incomplete", tool: spec.name }
      );
    }
    console.error("[api/ai/electrical] buildPayload failed", err);
    await logAiEvent(supabase, user.id, {
      mode: "electrical",
      outcome: "error",
      tool: spec.name,
      ...stats,
      latency_ms: Date.now() - startedAt,
      forced_retry: forcedRetry,
      step,
      error: "build_payload_failed",
    });
    return NextResponse.json({ error: "gagal menyusun perintah" }, { status: 500 });
  }
}

/** Bagian teks dari sebuah jawaban, digabung. */
function textOf(content: { type: string; text?: string }[]): string {
  return content
    .flatMap((b) => (b.type === "text" && typeof b.text === "string" ? [b.text] : []))
    .join("\n")
    .trim();
}
