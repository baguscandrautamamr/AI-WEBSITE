/** Berapa giliran percakapan yang ikut dikirim sebagai konteks. */
export const MAX_HISTORY = 12;

/** Potongan tiap giliran lama, supaya konteks tidak bisa digelembungkan. */
export const MAX_TURN_CHARS = 4_000;

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
  role: "user" | "assistant" | "proposal" | "choice";
  text: string;
  commandText?: string;
  /** Nama tool yang dipanggil, mis. `place_lighting`. */
  command?: string;
  issues?: string[];
  /** Gelembung `choice`: family yang ditebak, dan yang akhirnya dipilih orangnya. */
  guessed?: string;
  answered?: string;
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

    const dispatched = entry.issues?.length
      ? `[CATATAN SISTEM] Kamu memanggil tool ${tool}, tapi perintahnya TIDAK dikirim karena masih ada yang kurang: ${entry.issues.join("; ")}.${asked} Tanyakan yang kurang itu, lalu panggil tool-nya lagi.`
      : `[CATATAN SISTEM] Kamu memanggil tool ${tool}; sistem yang memasukkannya ke antrean Revit.${asked} Hasilnya belum tentu ada di giliran ini. Catatan ini bukan contoh cara menjawab — menuliskan baris perintah sebagai teks tidak mengirim apa pun ke Revit.`;

    return { role: "assistant" as const, content: dispatched };
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
