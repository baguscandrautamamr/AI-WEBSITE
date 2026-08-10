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
