import { MAX_TOKENS, MODEL, llm, tokenCap } from "./llm";
import {
  ELECTRICAL_SYSTEM_PROMPT,
  asksToRun,
  echoesSystemNote,
  mentionsCommand,
  modelContextBlock,
  refusesAsAlreadyDone,
  toolsForRole,
} from "./aiTools";
import { buildMessages } from "./chatHistory";
import { directCommand } from "./directCommand";
import { COMMANDS_BY_NAME, canAutoRun, canRun, type CommandSpec, type Role } from "./commands";
import { resolveFamilies } from "./familyChoice";
import { CommandValidationError, buildPayload } from "./queue";
import { expandRooms } from "./roomList";
import { type AiEvent, statsOf } from "./aiEvents";
import type { ChatCompletion as Completion } from "openai/resources/chat/completions";

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
 * Batas token jawaban sekarang milik `lib/llm.ts`, dan bawaannya TIDAK DIKIRIM.
 *
 * Dulu 16.000, dan angkanya punya alasan yang sudah tidak berlaku: pada Sonnet
 * adaptive thinking aktif dan `max_tokens` membatasi thinking BESERTA
 * jawabannya, jadi permintaan yang butuh berpikir agak panjang bisa menghabiskan
 * jatahnya sebelum blok tool selesai ditulis. Chat Completions tidak punya
 * thinking yang ikut terhitung di situ, dan penyedia yang berbeda menerima nama
 * medan yang berbeda untuk batas ini — menebak yang salah menghasilkan 400 pada
 * setiap permintaan, bukan jawaban yang lebih pendek. Lihat `AI_MAX_TOKENS`.
 */

export async function propose(input: {
  role: Role;
  message: string;
  history?: unknown;
  context?: ModelContext;
}): Promise<ProposeResult> {
  const { role, message, history, context } = input;

  const tools = toolsForRole(role);
  const messages = buildMessages(history, message);

  /**
   * Prompt sistem sebagai PESAN pertama, bukan medan tersendiri.
   *
   * Bedanya dari Anthropic bukan cuma tempat. Di sana `system` adalah medan di
   * luar `messages`, dan itu yang memungkinkan penanda cache dipasang di
   * ujungnya: katalog tool dan seluruh aturan prompt jadi prefiks yang sama
   * persis di setiap giliran, dan yang berubah — daftar family dan ruangan di
   * model yang sedang terbuka — duduk sesudahnya tanpa membatalkan apa pun.
   *
   * Chat Completions tidak punya penanda itu. Keduanya digabung jadi satu pesan
   * `system`, dan seluruhnya dibayar penuh di setiap giliran. Urutannya tetap
   * dipertahankan — yang tidak berubah lebih dulu — karena sebagian penyedia
   * melakukan caching prefiks sendiri tanpa diminta, dan urutan itu yang
   * membuatnya mungkin kalau memang ada.
   */
  const context_ = modelContextBlock(context);
  const system = context_
    ? `${ELECTRICAL_SYSTEM_PROMPT}\n\n${context_}`
    : ELECTRICAL_SYSTEM_PROMPT;

  const ask = (force: boolean) =>
    llm.chat.completions.create({
      model: MODEL,
      ...tokenCap(MAX_TOKENS),
      tools,
      // `required` = wajib memakai salah satu tool — padanan `{type:"any"}` di
      // Anthropic. Dipakai hanya pada percobaan kedua, saat percobaan pertama
      // jelas-jelas BERMAKSUD mengirim perintah tapi menuliskannya sebagai teks.
      ...(force ? { tool_choice: "required" as const } : {}),
      messages: [{ role: "system" as const, content: system }, ...messages],
    });

  const startedAt = Date.now();

  // Dideklarasikan sebelum panggilan model, bukan sesudahnya, karena jalur
  // langsung di bawah menyelesaikan sebuah perintah TANPA memanggil model —
  // dan ia tetap harus lewat `done` yang sama supaya telemetrinya tidak punya
  // cabang tersendiri yang bisa ketinggalan.
  let stats: ReturnType<typeof statsOf> = {
    model_served: null,
    stop_reason: null,
    input_tokens: null,
    output_tokens: null,
    cache_read_tokens: null,
  };
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
   * Nilai sebuah perintah — dari mana pun asalnya — diselesaikan jadi jawaban.
   *
   * Satu ekor untuk DUA jalur masuk: panggilan tool dari model, dan kalimat yang
   * dibaca `directCommand` tanpa model sama sekali. Dipisah jadi fungsi persis
   * supaya keduanya tidak bisa berbeda: pemeriksaan family, pemekaran "semua
   * ruangan", dan validasi `buildPayload` berlaku sama untuk keduanya. Sebuah
   * jalur pintas yang melewatkan salah satunya adalah perintah yang salah
   * dikirim ke model Revit orang.
   */
  const settle = (
    spec: CommandSpec,
    values: Record<string, unknown>,
    note: string | null
  ): ProposeResult => {
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
            note,
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
                note ||
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
            note,
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
          note,
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
            note,
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
  };

  /**
   * KALIMAT PERINTAH YANG LUGAS TIDAK MENUNGGU MODEL SAMA SEKALI.
   *
   * "pasang lampu recessed di meeting 2 5x3 tinggi 3 meter" memuat setiap
   * argumen yang dibutuhkan. Melemparkannya ke model menambahkan satu
   * ketergantungan yang tidak memberi apa-apa — dan ketergantungan itulah yang
   * dilaporkan rusak: balasan teks berkali-kali berturut-turut, tanpa satu pun
   * perintah berangkat, bahkan setelah `tool_choice: any` dipaksakan.
   *
   * Yang dibaca di sini bukan tebakan. Nama ruangan dan nama family DICARI di
   * daftar yang dilaporkan add-in lewat `model_info`; kalau salah satunya tidak
   * ketemu, `directCommand` menjawab null dan giliran ini berjalan persis
   * seperti sebelumnya. Dan yang ketemu tetap lewat `settle` — jalur validasi
   * yang sama dengan usulan model, tanpa satu langkah pun dilewati.
   *
   * Efek sampingnya: nol panggilan API, nol detik menunggu, untuk kalimat yang
   * paling sering diketik orang di panel ini.
   */
  const direct = directCommand(message, role, context);
  if (direct) return settle(direct.spec, direct.values, null);

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

  let toolUse = toolCallOf(response);
  let text = textOf(response);

  stats = statsOf(response);

  /**
   * Pemaksaan yang dijalankan lalu tetap tidak menghasilkan panggilan tool.
   *
   * Dicatat karena tanpa ini ia tidak bisa dibedakan dari pemaksaan yang tidak
   * pernah dijalankan: `forced_retry` sama-sama true, dan hasilnya sama-sama
   * sebuah balasan teks. Padahal keduanya menuntut perbaikan yang berbeda —
   * yang satu di deteksinya, yang satu lagi di jalur panggilannya (permintaan
   * ini lewat gateway pihak ketiga, dan `tool_choice` termasuk yang bisa tidak
   * diteruskan utuh). Satu kolom di `ai_events` menggantikan satu sesi menebak.
   */
  let forceFailed: string | null = null;

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
  //
  // Bentuk KEDUA yang dipaksa, dan sebabnya berbeda.
  //
  // Yang di atas: model bermaksud mengirim, cuma salah bentuk. Yang ini: model
  // bermaksud TIDAK mengirim, karena riwayat memuat catatan bahwa perintah
  // serupa pernah berangkat, dan ia menyimpulkan pekerjaannya sudah selesai.
  // Catatan itu merekam satu saat di masa lalu; yang melihat keadaan model
  // SEKARANG hanya orang yang sedang menatap layar Revit — dan ia sedang
  // menatapnya, melihat lampunya belum berganti, dan meminta lagi.
  //
  // Yang dialaminya tanpa penjagaan ini: permintaan yang sama, jawaban yang
  // sama, berapa kali pun. Prompt sistem sudah melarangnya ("JANGAN pernah
  // menolak mengirim dengan alasan sudah dikirim"), dan larangan yang lebih
  // dekat di konteks — dua belas catatan hasil — mengalahkan aturan yang lebih
  // jauh. Jadi larangannya ditegakkan di sini, bukan diharapkan dipatuhi.
  //
  // DUA syarat, dan keduanya wajib. `refusesAsAlreadyDone` sendirian tidak
  // cukup: sebuah pertanyaan yang dijawab "sudah terpasang enam armatur" adalah
  // jawaban yang benar, dan memaksanya jadi perintah berarti memasang sesuatu
  // yang tidak diminta siapa pun. Yang membuatnya aman adalah `asksToRun` —
  // pesan terakhir orangnya memang menyuruh menjalankan.
  const refusedButAsked = asksToRun(message) && refusesAsAlreadyDone(text);

  //
  // Bentuk KETIGA, dan yang paling menyesatkan: jawaban yang MENIRU catatan
  // sistem. Model menulis penanda catatannya sendiri, nama tool, baris
  // argumen, "HASILNYA:", dan angka — lima belas armatur dipasang, lima belas
  // sirkuit dibuat — tanpa satu pun tool dipanggil. Tidak ada baris di
  // commands_queue, tidak ada apa pun di Revit, dan yang dibaca orangnya adalah
  // laporan lengkap dengan angkanya.
  //
  // Sebabnya ada di bentuk riwayatnya: catatan sistem dicatat sebagai giliran
  // ASISTEN — harus, karena model yang tidak melihat perintah yang ia kirim
  // sendiri menyimpulkan permintaannya belum dikerjakan — dan giliran asisten
  // adalah persis yang sedang diminta model untuk dituliskan berikutnya.
  //
  // Tanpa syarat tambahan, tidak seperti dua bentuk di atas. Sebuah jawaban
  // yang memuat penanda catatan sistem tidak pernah benar, apa pun yang
  // ditanyakan orangnya.
  const echoed = echoesSystemNote(text);

  if (!toolUse && tools.length > 0 && (mentionsCommand(text) || refusedButAsked || echoed)) {
    console.warn(
      echoed
        ? "[propose] jawaban meniru catatan sistem — dipaksa"
        : refusedButAsked
          ? "[propose] jawaban menolak dengan alasan sudah dikerjakan — dipaksa"
          : "[propose] jawaban menulis perintah tanpa memanggil tool — dipaksa"
    );
    forcedRetry = true;
    try {
      const forced = await ask(true);
      const forcedTool = toolCallOf(forced);
      if (forcedTool) {
        toolUse = forcedTool;
        text = textOf(forced) || "";
        // Angka pemakaian ikut yang KEDUA: itu jawaban yang benar-benar dipakai.
        // Percobaan pertamanya tetap terhitung lewat `forced_retry`, jadi
        // biayanya tidak hilang dari catatan — yang hilang cuma penggandaannya.
        stats = statsOf(forced);
      }
      if (!forcedTool) forceFailed = "forced_retry_no_tool";
    } catch (err) {
      // Percobaan kedua yang gagal bukan alasan menjatuhkan giliran ini: jawaban
      // pertamanya tetap ada, dan di bawah ia dikembalikan dengan keterangan
      // bahwa TIDAK ada perintah yang dikirim.
      console.error("[propose] forced tool retry failed", err);
      forceFailed = "forced_retry_threw";
    }
  }

  // Tidak memilih tool = model bertanya balik atau menolak. Itu hasil yang sah,
  // bukan kegagalan: pertanyaan klarifikasi justru yang membuat mode ini aman.
  if (!toolUse) {
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

    // Tiruan catatan sistem TIDAK PERNAH ditampilkan, bahkan setelah pemaksaan
    // gagal.
    //
    // Menandainya "tidak ada perintah yang dikirim" tidak cukup di sini, dan
    // bedanya menentukan: dua bentuk yang lain menghasilkan kalimat yang salah,
    // yang ini menghasilkan LAPORAN BERANGKA — "15 perangkat dipasang · 15
    // sirkuit dibuat · Beban 3300 VA" — untuk pekerjaan yang tidak pernah
    // terjadi. Angka sebanyak itu tidak bisa dinetralkan oleh satu baris
    // peringatan di sebelahnya; yang membacanya sudah membaca angkanya.
    //
    // Jadi teksnya dibuang, bukan dibingkai.
    const shown = echoesSystemNote(text)
      ? "Saya belum benar-benar mengirim apa pun ke Revit pada giliran ini. " +
        "Ulangi permintaannya, atau kirim langsung lewat tombol perintah di atas."
      : text || "Bisa diperjelas maksudnya?";

    return done(
      {
        kind: "reply",
        text: shown,
        // Jawaban yang menyebut sebuah perintah padahal tidak ada yang dikirim
        // ditandai, supaya panel chat mengatakannya terus terang alih-alih
        // membiarkan kalimat model berdiri sebagai laporan.
        nothingSent: mentionsCommand(text) || refusedButAsked || echoed,
      },
      {
        outcome: "reply",
        tool: null,
        wrote_command_as_text: mentionsCommand(text) || echoed,
        ...(forceFailed ? { error: forceFailed } : {}),
      }
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

  return settle(spec, toolUse.args, text || null);
}

/** Bagian teks dari sebuah jawaban. */
function textOf(response: Completion): string {
  const content = response.choices?.[0]?.message?.content;
  return typeof content === "string" ? content.trim() : "";
}

/**
 * Panggilan tool pertama dari sebuah jawaban, argumennya sudah jadi objek.
 *
 * Dua hal yang berbeda dari Anthropic dan keduanya wajib ditangani di sini.
 *
 * Pertama, `arguments` datang sebagai STRING JSON, bukan objek — di Anthropic
 * `input` sudah berupa objek. Yang lupa mem-parse-nya tidak mendapat galat: ia
 * mendapat sebuah string yang lolos ke `buildPayload` sebagai kumpulan argumen
 * kosong, lalu berangkat ke Revit sebagai perintah tanpa satu pun nilai.
 *
 * Kedua, string itu ditulis model dan karenanya bisa bukan JSON yang sah.
 * Dijawab null, bukan dilempar: sebuah jawaban yang argumennya tidak terbaca
 * diperlakukan sama dengan jawaban tanpa tool sama sekali, dan jalur pemaksaan
 * di atas yang menanganinya.
 */
function toolCallOf(
  response: Completion
): { name: string; args: Record<string, unknown> } | null {
  const call = response.choices?.[0]?.message?.tool_calls?.find(
    (c): c is typeof c & { function: { name: string; arguments: string } } =>
      "function" in c && typeof c.function?.name === "string"
  );
  if (!call) return null;

  const raw = call.function.arguments;
  if (typeof raw !== "string" || raw.trim() === "") {
    return { name: call.function.name, args: {} };
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { name: call.function.name, args: parsed as Record<string, unknown> }
      : null;
  } catch {
    console.warn("[propose] argumen tool bukan JSON yang sah:", raw.slice(0, 200));
    return null;
  }
}
