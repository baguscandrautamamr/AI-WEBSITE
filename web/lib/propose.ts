import { anthropic, MODEL } from "./anthropic";
import { ELECTRICAL_SYSTEM_PROMPT, mentionsCommand, toolsForRole, withModelContext } from "./aiTools";
import { buildMessages } from "./chatHistory";
import { COMMANDS_BY_NAME, canAutoRun, canRun, type Role } from "./commands";
import { resolveFamilies } from "./familyChoice";
import { CommandValidationError, buildPayload } from "./queue";
import { expandRooms } from "./roomList";
import { type AiEvent, statsOf } from "./aiEvents";

/**
 * Satu kalimat manusia → satu usulan perintah Revit. TANPA menjalankannya.
 *
 * Ini seluruh keputusan mode Electrical, dikeluarkan dari route-nya. Yang
 * tertinggal di route: siapa yang bertanya, apakah ia berhak, batas laju, dan
 * bentuk HTTP-nya. Yang di sini: apa yang diusulkan, dan kenapa.
 *
 * KENAPA DIPISAH. Karena tanpa pemisahan ini, eval hanya punya dua pilihan dan
 * keduanya buruk. Memanggil route lewat HTTP menuntut sesi login, baris proyek,
 * dan Supabase yang hidup — perkakas yang lebih rapuh daripada yang diamankannya,
 * dan yang akan gagal karena hal-hal yang bukan soal kualitas jawaban. Menyalin
 * logikanya ke dalam eval berarti menguji sebuah implementasi paralel: ia akan
 * berbeda dari yang benar-benar dipakai pada perubahan pertama, dan sejak saat
 * itu setiap "lulus" tidak berarti apa-apa.
 *
 * Jadi route dan eval memanggil fungsi yang SAMA. Kalau eval lulus, yang lulus
 * adalah kode yang melayani pengguna.
 */

export interface ModelContext {
  familyTypes?: Record<string, string[]>;
  rooms?: string[];
}

/** Bagian telemetri yang hanya diketahui di sini. Route menambahkan sisanya. */
type ProposeEvent = Pick<AiEvent, "outcome" | "tool"> & Partial<AiEvent>;

export type ProposeResult =
  | { ok: true; payload: Record<string, unknown>; event: ProposeEvent }
  | { ok: false; status: number; error: string; event: ProposeEvent };

/**
 * Ruang untuk thinking + jawaban + panggilan tool, sekaligus.
 *
 * Dulu 2048, dan itu terlalu sempit dengan cara yang tidak terlihat. Pada Sonnet
 * 5 adaptive thinking aktif secara default dan `max_tokens` membatasi thinking
 * BESERTA jawabannya (lihat anthropic.ts) — jadi permintaan yang butuh berpikir
 * agak panjang ("semua ruangan, tiga kategori") bisa menghabiskan jatahnya
 * sebelum blok `tool_use` selesai ditulis.
 *
 * Yang terjadi kemudian bukan galat. Jawabannya berhenti di tengah, tidak ada
 * blok tool_use untuk ditemukan, dan permintaan itu jatuh ke cabang "model
 * bertanya balik" di bawah — sehingga yang dibaca orangnya adalah "Bisa
 * diperjelas maksudnya?" untuk kalimat yang sudah sangat jelas. Ia lalu mengetik
 * ulang kalimat yang sama, dan gagal dengan cara yang sama.
 *
 * 16.000 adalah angka yang dianjurkan untuk permintaan non-streaming: cukup
 * lapang, dan masih di bawah batas waktu HTTP bawaan SDK. Mode standard yang
 * memang dialirkan memakai 32.000.
 */
export const MAX_TOKENS = 16_000;

export async function propose(input: {
  role: Role;
  message: string;
  history?: unknown;
  context?: ModelContext;
}): Promise<ProposeResult> {
  const { role, message, history, context } = input;

  const tools = toolsForRole(role);
  const messages = buildMessages(history, message);
  const system = withModelContext(ELECTRICAL_SYSTEM_PROMPT, context);

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
    console.error("[propose] gateway call failed", err);
    return {
      ok: false,
      status: 502,
      error: "asisten sedang tidak bisa dihubungi",
      event: {
        outcome: "error",
        tool: null,
        latency_ms: Date.now() - startedAt,
        error: "gateway_unreachable",
      },
    };
  }

  let toolUse = response.content.find((b) => b.type === "tool_use");
  let text = textOf(response.content);

  let stats = statsOf(response);
  let forcedRetry = false;

  /**
   * Satu-satunya jalan keluar, supaya tidak ada cabang yang lupa mencatat.
   *
   * Fungsi ini punya delapan hasil yang berbeda — perintah siap, perintah
   * dimekarkan per ruangan, daftar ruangan belum terbaca, family ditahan,
   * argumen kurang, model bertanya balik, tool di luar peran, jawaban terpotong.
   * Menyusun telemetrinya di masing-masing berarti hasil kesembilan yang
   * ditambahkan nanti akan hilang dari hitungan tanpa ada yang menyadarinya —
   * dan yang hilang justru yang baru, yang paling perlu diawasi.
   */
  const done = (payload: Record<string, unknown>, event: ProposeEvent): ProposeResult => ({
    ok: true,
    payload,
    event: {
      ...stats,
      latency_ms: Date.now() - startedAt,
      forced_retry: forcedRetry,
      ...event,
    },
  });

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
    console.warn("[propose] jawaban menulis perintah tanpa memanggil tool — dipaksa");
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
      console.error("[propose] forced tool retry failed", err);
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
     * Bedanya besar bagi orangnya. Pertanyaan klarifikasi bisa dijawab; jawaban
     * yang terpotong tidak bisa — mengetik ulang kalimat yang sama akan
     * terpotong lagi di tempat yang sama. Jadi dikatakan apa adanya, beserta
     * satu-satunya hal yang memang menolong: memperkecil permintaannya.
     */
    if (stats.stop_reason === "max_tokens") {
      console.warn("[propose] jawaban terpotong di batas token");
      return done(
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

    return done(
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
    return done(
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
    // masuk akal bukan selalu yang benar. Add-in tidak pernah mengeluh soal nama
    // yang tidak ketemu — ia memakai bawaannya dan melaporkan sukses.
    const resolved = resolveFamilies(spec, values, context?.familyTypes);

    if (resolved.question) {
      // Ditahan, dan daftarnya ditawarkan di percakapan — satu ketukan, bukan
      // mengisi ulang formulir.
      return done(
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
      ? expandRooms(resolved.values[roomField], context?.rooms ?? [])
      : null;

    if (rooms) {
      if (rooms.length === 0) {
        return done(
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
        const perRoom = { ...resolved.values, [roomField as string]: room };
        return { room, values: perRoom, commandText: buildPayload(spec, perRoom).commandText };
      });

      return done(
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
    return done(
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
      return done(
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

    console.error("[propose] buildPayload failed", err);
    return {
      ok: false,
      status: 500,
      error: "gagal menyusun perintah",
      event: {
        ...stats,
        outcome: "error",
        tool: spec.name,
        latency_ms: Date.now() - startedAt,
        forced_retry: forcedRetry,
        error: "build_payload_failed",
      },
    };
  }
}

/** Bagian teks dari sebuah jawaban, digabung. */
function textOf(content: { type: string; text?: string }[]): string {
  return content
    .flatMap((b) => (b.type === "text" && typeof b.text === "string" ? [b.text] : []))
    .join("\n")
    .trim();
}
