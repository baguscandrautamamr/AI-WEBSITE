/**
 * "Semua ruangan" jadi satu perintah per ruangan.
 *
 * Add-in mengerjakan satu ruangan per perintah — itu bentuk `place_*` sejak
 * awal, dan bukan sesuatu yang bisa diubah dari sini. Yang bisa diubah adalah
 * siapa yang menyalinnya lima kali: sebelum ini, orangnya. "Kasih saklar di
 * semua ruangan" dijawab dengan daftar ruangan dan pertanyaan balik, lalu satu
 * perintah — dan empat ruangan sisanya harus diminta lagi, satu per satu, dengan
 * kalimat yang sama.
 *
 * Sekarang argumen `room` menerima `*` (semua ruangan yang dilaporkan model) dan
 * daftar dipisah koma. Keduanya dimekarkan di sini, bukan di prompt: model yang
 * diminta memanggil tool lima kali akan memanggilnya empat kali pada percobaan
 * yang lain, dan tidak ada yang menyadarinya kecuali dari gambar yang kurang
 * satu ruangan.
 */

/** Kata yang berarti "semua ruangan di model". */
const EVERY_ROOM = new Set(["*", "all", "semua", "semua ruangan", "all rooms", "seluruh ruangan"]);

export function meansEveryRoom(raw: unknown): boolean {
  return EVERY_ROOM.has(String(raw ?? "").trim().toLowerCase());
}

/**
 * Nama ruangan yang dimaksud satu nilai `room`.
 *
 * `null` berarti nilainya menyebut satu ruangan biasa — perintahnya tunggal, dan
 * tidak ada yang perlu dimekarkan.
 */
export function expandRooms(raw: unknown, modelRooms: readonly string[] = []): string[] | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;

  if (meansEveryRoom(text)) {
    const rooms = dedupe(modelRooms.map((r) => r.trim()).filter(Boolean));
    // Daftar ruangan belum terbaca dari Revit: memekarkan "semua" jadi nol
    // perintah adalah cara paling sunyi untuk tidak mengerjakan apa pun.
    return rooms.length ? rooms : [];
  }

  if (!text.includes(",")) return null;

  const named = dedupe(
    text
      .split(",")
      .map((part) => part.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean)
  );
  return named.length > 1 ? named : null;
}

function dedupe(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}
