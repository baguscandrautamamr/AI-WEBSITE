import { COMMANDS_BY_NAME } from "./commands";

/** Berapa giliran percakapan yang ikut dikirim sebagai konteks. */
export const MAX_HISTORY = 12;

/**
 * Potongan tiap giliran lama, supaya konteks tidak bisa digelembungkan.
 *
 * Dinaikkan dari 4.000 karena catatan hasil sekarang bisa membawa ISI hasilnya
 * (sampai MAX_DIGEST_CHARS = 3.000, lihat lib/resultDigest.ts) di samping teks
 * catatannya sendiri. Pada 4.000 keduanya tidak muat, dan yang terjadi adalah
 * pemotongan DIAM di sini: yang terbuang justru ujung digest — termasuk kalimat
 * digest itu sendiri yang mengatakan bahwa isinya terpotong. Model lalu membaca
 * data separuh sebagai data utuh, yang persis kegagalan yang dicegah
 * `digestResult`.
 *
 * Batas atasnya tetap ada dan tetap terikat: 12 giliran (MAX_HISTORY) × 6.000
 * karakter adalah langit-langit yang tidak bisa dilewati riwayat kiriman client,
 * berapa pun yang ia kirim.
 */
export const MAX_TURN_CHARS = 6_000;

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

/** Menambahkan satu giliran, digabung kalau perannya sama dengan yang terakhir. */
function push(turns: Turn[], role: Turn["role"], content: string) {
  const last = turns[turns.length - 1];
  if (last && last.role === role) last.content += `\n\n${content}`;
  else turns.push({ role, content });
}

/**
 * Menyusun daftar pesan dari riwayat kiriman browser plus pesan baru.
 *
 * Riwayatnya tidak pernah dipercaya: ia datang dari client, jadi peran dan
 * isinya bisa apa saja. Yang bukan giliran user/assistant berisi teks dibuang
 * diam-diam.
 *
 * Giliran berurutan dengan peran yang sama digabung, dan giliran asisten di
 * paling depan dibuang — Anthropic menolak keduanya dengan 400. Panel chat
 * memang menghasilkan keduanya secara wajar: usulan perintah tidak ikut
 * terkirim sebagai giliran, dan hasil dari Revit ditambahkan sebagai giliran
 * asisten tanpa ada yang bertanya lebih dulu. Sebelum ini, percakapan yang
 * melewati satu usulan perintah gagal di giliran berikutnya dan muncul di UI
 * sebagai "asisten sedang tidak bisa dihubungi" — menyalahkan gateway untuk
 * kesalahan yang ada di sini.
 *
 * Pesan barunya ikut lewat jalur yang sama, bukan ditempel setelahnya: kalau
 * riwayat kebetulan berakhir di giliran user, menempelkannya begitu saja
 * membuat persis dua giliran user berurutan yang mau dihindari.
 */
/**
 * Satu gelembung percakapan, seperlunya saja.
 *
 * Struktural, bukan tipe komponennya: aturan di bawah adalah aturan riwayat,
 * dan menautkannya ke tipe UI berarti ia tidak bisa diuji tanpa merender React.
 */
export interface ChatBubble {
  role: "user" | "assistant" | "proposal" | "choice" | "batch";
  text: string;
  commandText?: string;
  /** Nama tool yang dipanggil, mis. `place_lighting`. */
  command?: string;
  issues?: string[];
  /** Gelembung `choice`: family yang ditebak, dan yang akhirnya dipilih orangnya. */
  guessed?: string;
  answered?: string;
  /** Gelembung `batch`: ruangan yang dituju, dan berapa yang benar-benar berangkat. */
  rooms?: string[];
  sent?: number;
  /**
   * Apa yang dijawab Revit, dalam satu baris — dan apakah ia sempat menjawab.
   *
   * Ini yang selama ini hilang dari riwayat. Yang tercatat hanyalah "perintahnya
   * dikirim"; jawabannya — 128 armatur, 128,4 meter tray — tidak pernah sampai ke
   * model. Jadi "tadi berapa totalnya?" dijawab dengan menjalankan perintah yang
   * sama lagi, dan menunggu Revit lagi, untuk angka yang sudah ada di layar.
   */
  summary?: string;
  runStatus?: "completed" | "failed" | "cancelled";
  runError?: string;
  /**
   * ISI hasilnya, bukan ringkasannya — dan hanya untuk langkah yang sedang
   * berjalan.
   *
   * `summary` cukup untuk mata manusia dan untuk pertanyaan lanjutan tentang
   * sebuah angka. Ia TIDAK cukup untuk memutuskan langkah berikutnya: ringkasan
   * `inspect what=parameters` berbunyi "12 parameter" tanpa satu pun namanya,
   * sementara yang dibutuhkan langkah sesudahnya justru nama-nama itu, persis.
   * Nama yang salah mengembalikan kolom KOSONG, dan kosong tidak bisa dibedakan
   * dari model yang memang tidak punya nilainya.
   *
   * Diisi hanya oleh loop baca berantai, untuk gelembung yang baru saja selesai
   * dalam giliran itu — lihat `digestResult` di lib/resultDigest.ts. Riwayat yang
   * disusun ulang dari layar pada giliran-giliran berikutnya TIDAK membawanya,
   * dan itu disengaja: isi lengkap setiap pembacaan yang pernah terjadi adalah
   * biaya input yang dibayar berulang untuk data yang sudah selesai dipakai.
   */
  resultDigest?: string;
}

/**
 * Kalimat yang menempel di setiap catatan hasil, dan bunyinya berbeda untuk
 * perintah yang MEMBACA dan perintah yang MENGUBAH.
 *
 * Satu kalimat yang sama untuk keduanya adalah sebab dari dua kegagalan yang
 * dilaporkan bersamaan. Bunyinya dulu "jangan menjalankan perintah yang sama
 * lagi kecuali memang diminta atau modelnya sudah berubah", dan dua bagian dari
 * kalimat itu tidak bisa dipenuhi siapa pun:
 *
 * "modelnya sudah berubah" adalah sesuatu yang catatan ini TIDAK BISA TAHU.
 * Antara giliran itu dan giliran ini, orangnya bisa menghapus yang baru
 * dipasang, menekan Ctrl+Z, atau rekannya mengubah model yang sama. Catatan ini
 * merekam SATU SAAT DI MASA LALU, bukan keadaan model sekarang — dan tidak ada
 * apa pun di sistem ini yang memberitahunya kalau saat itu sudah lewat.
 *
 * "kecuali memang diminta" tenggelam. Yang dibaca model adalah larangannya,
 * dan larangan yang lebih dekat di konteks mengalahkan aturan di prompt sistem
 * yang berbunyi sebaliknya ("JANGAN pernah menolak mengirim dengan alasan sudah
 * dikirim"). Dua instruksi yang bertentangan, dan yang menang bukan yang benar.
 *
 * Akibatnya persis seperti yang dilaporkan: sepuluh downlight dihapus orangnya,
 * ia minta dipasang lagi, dan yang ia dapat adalah kalimat bahwa lampunya sudah
 * terpasang — dari catatan tentang armatur yang sudah tidak ada di model.
 *
 * Maka: untuk perintah baca, larangannya dipertahankan tapi disempitkan pada
 * apa yang memang dimaksud — menjawab pertanyaan lanjutan dari angka yang sudah
 * ada, bukan menahan permintaan baru. Untuk perintah yang mengubah model,
 * larangan itu dibuang sama sekali; di sana tidak ada angka untuk dijawab
 * ulang, jadi satu-satunya yang bisa dimaksud orangnya adalah menjalankannya
 * lagi.
 */
function staleness(tool: string): string {
  const spec = COMMANDS_BY_NAME[tool];

  // Perintah yang tidak dikenal katalog diperlakukan sebagai pengubah model:
  // menahan sesuatu yang seharusnya berangkat lebih mahal daripada mengirim
  // sesuatu dua kali.
  const reads = spec?.group === "read" && spec.role === "viewer";

  const past =
    "Catatan ini merekam satu saat di masa lalu, BUKAN keadaan model sekarang — " +
    "sejak itu modelnya bisa saja sudah diubah, dihapus, atau di-undo tanpa kamu tahu. " +
    "Kalau orangnya meminta dijalankan lagi, jalankan lagi; jangan menjawab bahwa itu sudah dikerjakan.";

  return reads
    ? `Angka itu datang dari model, jadi pertanyaan LANJUTAN tentang angka yang sudah ada di catatan ini dijawab dari sini, tanpa memanggil tool lagi. ${past}`
    : past;
}

/**
 * Riwayat percakapan sebagaimana model harus melihatnya.
 *
 * Gelembung `proposal` — perintah yang disusun model lalu berangkat ke Revit —
 * dulu dibuang seluruhnya di sini. Akibatnya model tidak pernah melihat perintah
 * yang ia sendiri kirim: yang ia terima untuk tiga permintaan berturut-turut
 * adalah tiga pesan user yang identik tanpa satu pun giliran asisten di
 * antaranya, dan `push` di bawah menggabungkan yang berperan sama — jadi jadilah
 * SATU pesan user yang mengulang permintaan yang sama tiga kali.
 *
 * Bacaan wajar model atas bentuk itu: "dia menanyakannya lagi, berarti sudah
 * saya kerjakan." Lalu ia menjawab "sudah dijalankan di langkah sebelumnya" dan
 * tidak memanggil tool apa pun — permintaan ketiga tidak mengirim apa-apa ke
 * Revit, sementara chat menyatakan sebaliknya, dan model Revit-nya tidak berubah.
 *
 * Jadi perintah yang berangkat dicatat sebagai giliran asisten, dan yang tidak
 * berangkat dicatat apa adanya beserta apa yang kurang. Yang TIDAK dikatakan di
 * sini: bahwa perintahnya berhasil. Itu belum diketahui siapa pun pada saat ini,
 * dan hasil sebenarnya masuk sebagai giliran asisten tersendiri begitu Revit
 * menjawab.
 *
 * BENTUKNYA penting, bukan cuma isinya. Catatan ini dulu berupa baris perintah
 * telanjang diikuti "Perintah ini dikirim ke antrean Revit." — persis rupa
 * sebuah jawaban asisten. Model lalu meniru bentuk yang ia lihat sebagai
 * jawabannya sendiri: pada giliran berikutnya ia MENULIS baris perintah itu
 * sebagai teks, lengkap dengan kalimat "dikirim ke antrean Revit", dan tidak
 * memanggil tool apa pun. Tidak ada baris yang masuk commands_queue, tidak ada
 * apa pun di Revit, sementara chat-nya berbunyi seperti sudah berangkat — dan
 * satu-satunya cara mengetahuinya adalah dari model Revit yang tidak berubah.
 *
 * Karena itu catatan ini sekarang menyebut dirinya catatan sistem, menyebut
 * bahwa yang memasukkan ke antrean adalah SISTEM setelah tool dipanggil, dan
 * mengatakan terus terang bahwa menulis teks tidak mengirim apa-apa.
 */
export function turnsFromChat(entries: readonly ChatBubble[]): Turn[] {
  return entries.map((entry) => {
    if (entry.role === "user") return { role: "user" as const, content: entry.text };
    if (entry.role === "assistant") return { role: "assistant" as const, content: entry.text };

    const tool = entry.command ?? nameFromCommandText(entry.commandText) ?? "tool";

    // Satu permintaan yang jadi banyak perintah, satu per ruangan. Dicatat utuh:
    // model yang tidak melihat kelima ruangan itu akan menganggap permintaannya
    // belum dikerjakan dan mengirimkannya lagi.
    if (entry.role === "batch") {
      const rooms = entry.rooms ?? [];
      return {
        role: "assistant" as const,
        content: `[CATATAN SISTEM] Kamu memanggil tool ${tool} dengan room="*"; sistem memekarkannya jadi ${rooms.length} perintah, satu per ruangan: ${rooms.join(", ")}. ${entry.sent ?? 0} di antaranya masuk antrean Revit. Jangan mengirim ulang untuk ruangan yang sama tanpa diminta.`,
      };
    }

    // Family yang ditebak tidak ada di model, jadi perintahnya ditahan dan
    // pilihannya diserahkan ke orangnya. Dicatat supaya giliran berikutnya tidak
    // menebak nama yang sama lagi — dan supaya nama yang akhirnya dipilih ikut
    // terbaca sebagai ejaan yang benar.
    if (entry.role === "choice") {
      const answered = entry.answered
        ? `Orangnya memilih "${entry.answered}" — pakai ejaan itu kalau family yang sama disebut lagi.`
        : entry.answered === ""
          ? "Orangnya memilih membiarkan add-in yang menentukan family."
          : "Orangnya belum menjawab.";

      return {
        role: "assistant" as const,
        content: `[CATATAN SISTEM] Family "${entry.guessed ?? ""}" yang kamu isi untuk ${tool} tidak ada di model, jadi perintahnya TIDAK dikirim dan daftar family kategori itu ditawarkan ke pengguna. ${answered}`,
      };
    }
    const asked = entry.commandText ? ` Argumennya: ${entry.commandText}` : "";

    if (entry.issues?.length) {
      return {
        role: "assistant" as const,
        content: `[CATATAN SISTEM] Kamu memanggil tool ${tool}, tapi perintahnya TIDAK dikirim karena masih ada yang kurang: ${entry.issues.join("; ")}.${asked} Tanyakan yang kurang itu, lalu panggil tool-nya lagi.`,
      };
    }

    // Revit sudah menjawab. Angkanya dibawa ke sini apa adanya — itu bedanya
    // antara menjawab "tadi berapa totalnya?" dan menjalankan perintahnya lagi
    // untuk angka yang sudah ada di layar orangnya.
    if (entry.runStatus === "completed" && (entry.summary || entry.resultDigest)) {
      const summary = entry.summary
        ? ` HASILNYA: ${entry.summary}.`
        : " Revit menjawab tanpa ringkasan yang bisa dipendekkan dengan jujur.";

      // Isi hasilnya di belakang, di bloknya sendiri, dan diberi nama.
      //
      // Tanpa blok ini langkah berikutnya menebak: ringkasan tidak memuat nama
      // parameter, nama kategori yang lengkap, atau nilai yang dikelompokkan —
      // dan menebak salah satunya menghasilkan perintah yang berjalan tanpa
      // galat lalu mengembalikan nol baris.
      const body = entry.resultDigest
        ? `\n\nISI HASILNYA (apa adanya dari Revit — pakai nama dan angka dari sini, jangan mengarang):\n${entry.resultDigest}`
        : "";

      return {
        role: "assistant" as const,
        content: `[CATATAN SISTEM] Kamu memanggil tool ${tool}; sistem menjalankannya di Revit dan Revit sudah menjawab.${asked}${summary} ${staleness(tool)}${body}`,
      };
    }

    if (entry.runStatus === "failed" || entry.runStatus === "cancelled") {
      const why = entry.runError ? ` Sebabnya: ${entry.runError}.` : "";
      return {
        role: "assistant" as const,
        content: `[CATATAN SISTEM] Kamu memanggil tool ${tool} dan sistem mengirimkannya, tapi Revit GAGAL menjalankannya.${asked}${why} Jangan mengaku sudah selesai.`,
      };
    }

    return {
      role: "assistant" as const,
      content: `[CATATAN SISTEM] Kamu memanggil tool ${tool}; sistem yang memasukkannya ke antrean Revit.${asked} Hasilnya belum tentu ada di giliran ini. Catatan ini bukan contoh cara menjawab — menuliskan baris perintah sebagai teks tidak mengirim apa pun ke Revit.`,
    };
  });
}

/** `/place_lighting "LOUNGE 5" count=10` → `place_lighting`. */
function nameFromCommandText(commandText?: string): string | null {
  const m = /^\/([a-z_]+)/.exec((commandText ?? "").trim());
  return m ? m[1] : null;
}

export function buildMessages(rawHistory: unknown, message: string): Turn[] {
  const turns: Turn[] = [];

  if (Array.isArray(rawHistory)) {
    for (const item of rawHistory) {
      if (!item || typeof item !== "object") continue;

      const { role, content } = item as { role?: unknown; content?: unknown };
      if (role !== "user" && role !== "assistant") continue;
      if (typeof content !== "string" || !content.trim()) continue;

      push(turns, role, content.slice(0, MAX_TURN_CHARS));
    }
  }

  // Dipotong dari belakang dulu supaya yang dikirim tetap giliran terbaru;
  // hasil potongannya bisa diawali asisten, jadi dirapikan setelahnya.
  const recent = turns.slice(-MAX_HISTORY);
  while (recent.length && recent[0].role === "assistant") recent.shift();

  push(recent, "user", message);
  return recent;
}
