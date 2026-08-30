import { COMMANDS_BY_NAME, canRun, type CommandSpec, type Role } from "./commands";
import { familyNameOf } from "./families";

/**
 * Satu kalimat perintah → satu perintah, TANPA memanggil model bahasa.
 *
 * Ada karena mode ini pernah berhenti bekerja seluruhnya untuk kalimat yang
 * paling jelas yang bisa diketik orang. "pasang lampu recessed di meeting 2 5x3
 * tinggi 3 meter" memuat setiap argumen yang dibutuhkan — kata kerja, kategori,
 * ruangan, family, grid, ketinggian — dan yang terjadi adalah balasan teks,
 * berkali-kali berturut-turut, tanpa satu pun perintah berangkat. Pemaksaan
 * `tool_choice: any` pun tidak menolong: permintaan ini lewat gateway pihak
 * ketiga, dan apa yang benar-benar sampai ke model di seberang sana bukan
 * sesuatu yang bisa dipastikan dari sini.
 *
 * Maka kalimat seperti itu berhenti bergantung pada model. Ia dibaca di sini,
 * dan hasilnya lewat validasi yang sama persis dengan usulan model —
 * `resolveFamilies` lalu `buildPayload` — jadi tidak ada jalan pintas yang
 * dilewatkan, cuma satu penerjemah yang tidak bisa gagal karena jaringan.
 *
 * Efek sampingnya kecepatan: nol panggilan API untuk kalimat yang paling sering
 * diketik.
 *
 * SENGAJA PENAKUT. Ia menjawab null untuk apa pun yang tidak ia yakini, dan
 * yang null jatuh ke model persis seperti sebelumnya. Sebuah parser yang
 * memaksakan diri pada kalimat yang tidak ia mengerti mengirim perintah yang
 * salah ke model Revit orang — dan itu jauh lebih mahal daripada satu panggilan
 * API yang tidak perlu.
 */

/** Kata yang membuat sebuah kalimat bukan perintah lugas. */
const NOT_PLAIN =
  /\b(jangan|kecuali|tapi|tetapi|namun|kalau|jika|apakah|bagaimana|berapa|kenapa|mengapa|atau|dulu|nanti|sebelum|sesudah|coba\s+cek|tolong\s+cek)\b/i;

/** Kata kerja yang berarti "pasang baru". */
const PLACE = /\b(pasang|pasangkan|tambah|tambahkan|kasih|taruh|letakkan|place|add)\b/i;

/** Kata kerja yang berarti "ganti yang sudah ada". */
const MODIFY = /\b(modifikasi|modif|ganti|gantikan|ubah|tata\s*ulang|atur\s*ulang|modify|replace)\b/i;

/**
 * Kata yang menyebut kategori perangkat, dan perintah `place_*` miliknya.
 *
 * Diurutkan dari yang paling panjang saat dicocokkan, supaya "stop kontak"
 * tidak kalah oleh sesuatu yang lebih pendek di dalamnya.
 */
const CATEGORIES: { words: RegExp; command: string }[] = [
  { words: /\b(stop\s*kontak|stopkontak|outlet|receptacle)\b/i, command: "place_receptacle" },
  { words: /\b(fire\s*alarm|detektor|detector|smoke|heat)\b/i, command: "place_fire_alarm" },
  { words: /\b(saklar|sakelar|switch|dimmer)\b/i, command: "place_lighting_device" },
  { words: /\b(lampu|lampung|armatur|lighting|downlight|luminaire)\b/i, command: "place_lighting" },
  { words: /\b(telepon|telpon|telephone)\b/i, command: "place_telephone" },
  { words: /\b(lan|data|jaringan|network)\b/i, command: "place_lan" },
  { words: /\b(cctv|kamera|camera|security|sekuriti)\b/i, command: "place_security" },
  { words: /\b(speaker|komunikasi|communication|paging)\b/i, command: "place_communication" },
];

export interface DirectCommand {
  spec: CommandSpec;
  values: Record<string, unknown>;
}

export function directCommand(
  message: string,
  role: Role,
  context?: { rooms?: string[]; familyTypes?: Record<string, string[]> }
): DirectCommand | null {
  const text = (message ?? "").trim();

  // Pertanyaan dan kalimat bersyarat bukan urusan parser ini.
  if (!text || text.length > 200 || text.includes("?") || NOT_PLAIN.test(text)) return null;

  const modify = MODIFY.test(text);
  const place = PLACE.test(text);
  // Keduanya sekaligus ("pasang ulang, ganti yang lama") ambigu — serahkan ke model.
  if (modify === place) return null;

  const category = CATEGORIES.find((c) => c.words.test(text));
  if (!category) return null;

  const placeSpec = COMMANDS_BY_NAME[category.command];
  if (!placeSpec) return null;

  /**
   * Ruangan DICARI di daftar ruangan model, tidak diterka dari kalimat.
   *
   * Ini yang membuat parser ini boleh ada. Menebak nama ruangan dari prosa
   * adalah cara mengirim perintah ke ruangan yang salah; mencocokkannya dengan
   * daftar yang dilaporkan add-in lewat `model_info` adalah pencarian. Tanpa
   * daftar itu — Revit belum terhubung — parser ini tidak menjawab sama sekali.
   */
  const room = findRoom(text, context?.rooms ?? []);
  if (!room) return null;

  const spec = modify ? COMMANDS_BY_NAME.modify_devices : placeSpec;
  if (!spec || !canRun(spec, role)) return null;

  const values: Record<string, unknown> = { room };
  if (modify) values.what = category.command.slice("place_".length);

  /**
   * Angka dibaca dari kalimat TANPA nama ruangannya.
   *
   * "pasang 6 lampu di Meeting 1 tinggi 3 meter" memuat tiga angka, dan yang
   * satu — 1 — adalah bagian dari nama ruangan, bukan sesuatu yang diminta
   * siapa pun. Dibiarkan ikut, ia membuat jumlahnya ambigu dan seluruh
   * kalimatnya jatuh ke model; ditafsirkan, ia bisa jadi enam lampu berubah
   * jadi satu.
   */
  const rest = normalize(text).replace(normalize(room), " ");

  const grid = /(\d{1,2})\s*[x×]\s*(\d{1,2})/i.exec(rest);
  if (grid) values.grid = `${Number(grid[1])}x${Number(grid[2])}`;

  const height = heightOf(rest);
  if (height !== null) values.height = height;

  // Jumlah hanya dibaca kalau gridnya tidak disebut: keduanya menyatakan hal
  // yang sama, dan `buildPayload` menolak keduanya kalau tidak sepakat.
  if (!grid) {
    const count = countOf(rest, height);
    if (count !== null) values.count = count;
  }

  const family = findFamily(text, category.command, context?.familyTypes);
  if (family) values[modify ? "fixture_type" : familyFieldOf(placeSpec)] = family;

  return { spec, values };
}

/**
 * Nama ruangan model yang paling panjang yang muncul di kalimat.
 *
 * Yang terpanjang, bukan yang pertama: sebuah model bisa punya "MEETING 1" dan
 * "MEETING 11", dan yang pertama cocok untuk keduanya.
 */
function findRoom(text: string, rooms: string[]): string | null {
  const flat = normalize(text);

  let best: string | null = null;
  for (const room of rooms) {
    const name = normalize(room);
    if (!name || !flat.includes(name)) continue;
    if (!best || name.length > normalize(best).length) best = room;
  }
  return best;
}

/** Huruf kecil, spasi tunggal, garis bawah dianggap spasi. */
function normalize(value: string): string {
  return value.toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
}

/** "tinggi 3 meter", "tinggi 2.8 m", "3 m" — dalam meter. */
function heightOf(text: string): number | null {
  const stated = /\btinggi(?:nya)?\s*([\d]+(?:[.,]\d+)?)\s*(?:m|meter)?\b/i.exec(text);
  const bare = /\b([\d]+(?:[.,]\d+)?)\s*(?:m|meter)\b/i.exec(text);

  const raw = stated?.[1] ?? bare?.[1];
  if (raw === undefined) return null;

  const value = Number(raw.replace(",", "."));
  // Ketinggian pasang yang masuk akal. Di luar itu angkanya hampir pasti bukan
  // ketinggian, dan menebaknya sebagai ketinggian mengubah gambar.
  return Number.isFinite(value) && value > 0 && value <= 20 ? value : null;
}

/** Bilangan bulat yang berdiri sendiri dan bukan ketinggian. */
function countOf(text: string, height: number | null): number | null {
  const numbers = [...text.matchAll(/\b(\d{1,3})\b(?!\s*(?:m|meter|[x×]))/gi)]
    .map((m) => Number(m[1]))
    .filter((n) => n > 0 && n !== height);

  return numbers.length === 1 ? numbers[0] : null;
}

/**
 * Family yang disebut kalimat, DICARI di daftar family model.
 *
 * Sama seperti ruangan: dicocokkan, tidak diterka. "recessed" jadi
 * "ACT_E_LIGHTING RECESSED" hanya kalau family itu benar-benar ada di file yang
 * sedang terbuka — dan kalau ada dua yang cocok, tidak satu pun dipakai:
 * `resolveFamilies` yang akan menawarkan pilihannya kepada orangnya.
 */
function findFamily(
  text: string,
  command: string,
  familyTypes?: Record<string, string[]>
): string | null {
  const category = command.slice("place_".length);
  const entries = familyTypes?.[category] ?? familyTypes?.[`${category}s`] ?? [];

  const names = [...new Set(entries.map(familyNameOf).filter(Boolean))];
  const flat = normalize(text);

  const hit = names.filter((name) => flat.includes(normalize(name)));
  if (hit.length === 1) return hit[0];

  // Satu kata yang muncul di kalimat DAN di tepat satu nama family — "recessed",
  // "downlight". Lebih dari satu yang cocok berarti kalimatnya belum memilih.
  const words = flat.split(" ").filter((w) => w.length >= 5);
  for (const word of words) {
    const matches = names.filter((name) => normalize(name).includes(word));
    if (matches.length === 1) return matches[0];
  }
  return null;
}

/** Kolom nama family milik sebuah perintah `place_*`. */
function familyFieldOf(spec: CommandSpec): string {
  return spec.fields.some((f) => f.name === "fixture_type") ? "fixture_type" : "family";
}
