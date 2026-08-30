/**
 * Jawaban sebuah perintah, dalam satu baris.
 *
 * Dirangkai di sini, dari angka yang sudah ada di tangan — bukan dengan
 * mengirim hasilnya kembali ke model bahasa untuk dikalimatkan. Bedanya bukan
 * soal biaya atau kecepatan, meskipun keduanya nyata: sebuah model yang
 * menyebutkan ulang angka adalah satu tempat lagi di mana angka bisa berubah,
 * dan setengah dari yang diperbaiki di sistem ini adalah persis kejadian itu.
 * 128,4 di sini adalah 128,4 yang dikirim Revit, disalin, bukan diceritakan.
 *
 * Yang dihasilkan sengaja pendek. Ia jadi judul gelembung jawaban di chat DAN
 * jadi kalimat yang dibaca model pada giliran berikutnya — dan giliran
 * berikutnya itulah yang selama ini rusak: riwayatnya hanya berisi "perintah
 * selesai dijalankan", tanpa satu angka pun, jadi ketika ditanya "berapa
 * panjangnya" model benar-benar tidak tahu dan satu-satunya yang bisa ia lakukan
 * adalah menjalankan perintahnya lagi. Berapa kali pun ditanya.
 *
 * Kosong berarti hasilnya tidak punya bentuk yang bisa dipendekkan dengan jujur.
 * Itu jawaban yang sah: tabelnya tetap tampil utuh di bawah, dan satu kalimat
 * yang mengarang lebih buruk daripada tidak ada kalimat.
 */

type Dict = Record<string, unknown>;

const isDict = (value: unknown): value is Dict =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** Berapa butir yang disebut sebelum sisanya diringkas jadi "+N lagi". */
const MAX_PARTS = 6;

export function summarizeResult(value: unknown, t: (key: string) => string): string {
  if (!isDict(value)) return "";

  const body = summarize(value, t);
  if (!body) return "";

  // Uji coba disebut di depan, bukan di belakang. "6 dipasang" dan "6 akan
  // dipasang" berbunyi sama sampai kata terakhir, dan yang membaca cepat
  // berhenti di angkanya.
  return value.dry_run === true ? `${t("result.dry_run")}: ${body}` : body;
}

function summarize(result: Dict, t: (key: string) => string): string {
  // --- /query: satu baris per kategori, dengan angka pendampingnya ---------
  const groups = Array.isArray(result.groups) ? result.groups : null;

  if (groups?.length && isDict(groups[0]) && "label" in groups[0]) {
    const parts = groups
      .filter(isDict)
      .map((group) => {
        const name = labelOf(str(group.label), t);
        const count = num(group.count) ?? 0;
        const detail = str(group.detail);
        return detail ? `${name}: ${count} (${detail})` : `${name}: ${count}`;
      });

    // Jumlah yang sudah disaring per family harus mengatakannya. "Lampu: 6" untuk
    // pertanyaan tentang satu family terbaca sama dengan "Lampu: 6" untuk seluruh
    // ruangan, dan yang membaca ringkasannya tidak punya cara membedakannya.
    const family = str(result.family);
    return family ? `${join(parts)} · ${family}` : join(parts);
  }

  // --- /inspect what=categories -------------------------------------------
  const categories = Array.isArray(result.categories) ? result.categories : null;

  if (categories?.length) {
    const parts = categories
      .filter(isDict)
      .map((row) => `${str(row.name)} ${num(row.count) ?? 0}`);

    return `${categories.length} ${t("result.categories").toLowerCase()} — ${join(parts)}`;
  }

  // --- /inspect what=parameters -------------------------------------------
  const parameters = Array.isArray(result.parameters) ? result.parameters : null;

  if (parameters?.length) {
    return `${parameters.length} ${t("result.parameters").toLowerCase()}`;
  }

  // --- /inspect what=elements ---------------------------------------------
  if (Array.isArray(result.rows)) {
    const total = num(result.total) ?? 0;
    const shown = num(result.shown) ?? result.rows.length;
    const parts: string[] = [
      shown < total
        ? `${total} ${t("result.rows").toLowerCase()} (${shown} ${t("result.shown").toLowerCase()})`
        : `${total} ${t("result.rows").toLowerCase()}`,
    ];

    // Totalnya lebih dulu: itu yang ditanyakan orangnya. Baris-barisnya adalah
    // buktinya, bukan jawabannya.
    for (const total_ of asDicts(result.totals)) {
      const sum = num(total_.sum);
      if (sum === null) continue;
      const unit = str(total_.unit);
      parts.unshift(`${str(total_.parameter)}: ${format(sum)}${unit ? ` ${unit}` : ""}`);
    }

    for (const group of asDicts(result.groups).slice(0, 3)) {
      parts.push(`${str(group.value)} ${num(group.count) ?? 0}`);
    }

    return join(parts);
  }

  // --- perintah yang mengubah model ---------------------------------------
  const placed = num(result.devices_placed);
  if (placed !== null) {
    const where = str(result.room);
    const family = str(result.family_used);

    // Titik yang jatuh di luar batas ruangan lalu dibuang add-in.
    //
    // Ini yang membuat angka pertamanya bisa dipercaya. Grid dibentangkan pada
    // KOTAK ruangan, dan ruangan berbentuk L punya kotak yang mencakup bagian
    // yang bukan miliknya — jadi "pasang 40" di ruangan begitu memang berakhir
    // sebagai kurang dari 40 armatur, dan itu benar. Yang salah adalah
    // melaporkannya sebagai 40, atau melaporkannya sebagai 34 tanpa
    // menyebutkan ke mana enam sisanya pergi: yang pertama adalah angka yang
    // tidak cocok dengan gambar, yang kedua terbaca sebagai add-in yang gagal
    // separuh jalan.
    //
    // Hanya disebut kalau add-in benar-benar mengirimkannya. Versi lama tidak
    // memeriksa batas ruangan sama sekali, dan "0 di luar batas" dari add-in
    // yang tidak pernah melihat batasnya adalah kalimat yang salah.
    const outside = num(result.outside_boundary);

    /**
     * Saklar yang tidak bisa ditempatkan di samping pintu.
     *
     * Ini yang dilaporkan sebagai "kenapa jaraknya 3.570 mm, bukan 300 mm".
     * Penempatan berbasis pintu gagal — ruangan tanpa pintu di peta batasnya,
     * kedua sisi terhalang, atau tidak ada dinding di bawah titik yang
     * seharusnya — dan sisanya disebar rata di keliling ruangan, yang tidak
     * tahu apa-apa soal pintu. Perintahnya tetap sukses, jumlahnya tetap cocok,
     * dan tidak ada satu pun angka di layar yang menyebutkannya.
     *
     * Jaraknya ikut disebut kalau add-in mengukurnya: satu angka menghemat
     * perjalanan menarik dimensi sendiri di Revit.
     */
    const away = num(result.away_from_door);
    const distances = Array.isArray(result.door_distance_mm)
      ? result.door_distance_mm.filter((d): d is number => typeof d === "number")
      : [];
    const farthest = distances.length ? Math.max(...distances) : null;

    return [
      `${placed} ${t("result.devices_placed").toLowerCase()}`,
      where && `${t("result.room").toLowerCase()} ${where}`,
      family,
      outside !== null && outside > 0
        ? `${outside} ${t("result.outside_boundary").toLowerCase()}`
        : "",
      away !== null && away > 0
        ? `${away} ${t("result.away_from_door").toLowerCase()}` +
          (farthest && farthest > 0 ? ` (${format(farthest)} mm)` : "")
        : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }

  const removed = num(result.devices_removed);
  if (removed !== null) {
    const where = str(result.room);
    return where
      ? `${removed} ${t("result.devices_removed").toLowerCase()} · ${where}`
      : `${removed} ${t("result.devices_removed").toLowerCase()}`;
  }

  // --- import tabel --------------------------------------------------------
  const view = str(result.view);
  if (view) {
    const rows = num(result.rows);
    const columns = num(result.columns);
    const size = rows !== null && columns !== null ? ` — ${rows}×${columns}` : "";
    return `${t("result.view")}: ${view}${size}`;
  }

  // --- daftar apa pun yang punya butir ------------------------------------
  const items = Array.isArray(result.items) ? result.items : null;
  if (items?.length) return `${items.length} ${t("result.items").toLowerCase()}`;

  return "";
}

function asDicts(value: unknown): Dict[] {
  return Array.isArray(value) ? value.filter(isDict) : [];
}

function join(parts: string[]): string {
  const kept = parts.filter((part) => part.length > 0);
  if (kept.length <= MAX_PARTS) return kept.join(", ");
  return `${kept.slice(0, MAX_PARTS).join(", ")}, +${kept.length - MAX_PARTS}`;
}

/** 128.4 dan bukan 128.40000000000001; 37 dan bukan 37.0. */
function format(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0$/, "");
}

/**
 * Nama kategori yang dibaca manusia, dari kunci i18n yang dikirim add-in.
 *
 * Add-in menyebut kelompoknya dengan kunci milik bot Telegram — `lighting.title`,
 * `query.hangers` — dan kunci itu memang tidak berarti apa-apa bagi yang
 * membacanya di layar. Yang diterjemahkan diambil dari `result.*`; yang tidak
 * ada padanannya dirapikan apa adanya, jadi kategori baru dari add-in tetap
 * terbaca, hanya belum berbahasa Indonesia.
 */
function labelOf(key: string, t: (key: string) => string): string {
  if (!key) return "";

  const full = `result.${key}`;
  const translated = t(full);
  if (translated !== full) return translated;

  const last = key.split(".").filter((part) => part !== "title").pop() ?? key;
  return last.replace(/[_-]+/g, " ");
}
