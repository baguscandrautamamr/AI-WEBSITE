/**
 * Kartu-kartu sejajar, ditata oleh program — bukan oleh model.
 *
 * Ini lahir dari dua kali gagal. Jawaban seperti "jenis socket outlet" berbentuk
 * sekumpulan hal sejenis, dan model menggambarnya sebagai SVG dengan koordinat
 * yang ia hitung sendiri sambil menulis. Sembilan kartu berarti delapan belas
 * angka yang harus benar semua, ditulis huruf demi huruf tanpa bisa melihat
 * hasilnya — dan yang keluar adalah kartu yang lebarnya berbeda-beda, sebagian
 * saling menimpa, bingkai kuning mengelilingi semuanya, simbol yang melewati
 * garis atas kartunya.
 *
 * Prompt sudah diberi tabel koordinat yang tinggal disalin, dan hasilnya tetap
 * meleset. Itu bukan soal aturannya kurang tegas: menempatkan sesuatu di kanvas
 * tanpa pernah melihat kanvasnya memang bukan yang bisa dikerjakan dengan baik
 * sambil mengarang kalimat.
 *
 * Jadi pembagian kerjanya diubah. Model mengirim ISI — nama, keterangan, dan
 * gambar simbolnya di dalam kotak 100x100 miliknya sendiri — dan seluruh
 * penempatan dikerjakan di sini: berapa kolom, di mana tiap kartu, seberapa
 * tinggi, di mana tiap baris teks. Yang dihitung program tidak pernah meleset
 * satu unit pun, dan tata letak yang seragam itulah yang terbaca sebagai rapi.
 */

/** Lebar kanvas. Semua angka lain diturunkan dari ini. */
const WIDTH = 960;

/** Lebih dari ini bukan lagi ringkasan; 4x4 sudah sangat padat untuk satu layar. */
const MAX_CARDS = 16;

/** Sisi kotak tempat model menggambar simbolnya. */
const ART_BOX = 100;

/** Sisi simbol setelah ditempatkan di dalam kartu. */
const ART_SIZE = 64;

/** Jarak antar baris kartu. */
const ROW_GAP = 20;

/** Ruang di bawah kartu terakhir. */
const BOTTOM = 24;

/** Elemen yang boleh ada di dalam sebuah simbol. */
const ART_TAGS = new Set([
  "circle",
  "ellipse",
  "line",
  "path",
  "polygon",
  "polyline",
  "rect",
  "text",
  "tspan",
]);

export interface Card {
  name: string;
  meta?: string;
  sub?: string;
  /** Simbolnya, digambar dalam kotak 0 0 100 100. */
  art?: string;
}

export interface CardSpec {
  title?: string;
  note?: string;
  cards: Card[];
}

/** Baris kepala: `judul:` / `title:` / `catatan:` / `note:`. */
const HEADING = /^\s*(judul|title|catatan|note)\s*:\s*(.*)$/i;

/**
 * Membaca blok `cards` menjadi isinya.
 *
 * Sengaja pemaaf. Ini keluaran model, bukan berkas konfigurasi: baris kosong,
 * tanda hubung di depan, spasi berlebih, dan kolom yang tidak diisi semuanya
 * wajar terjadi dan tak satu pun jadi alasan untuk tidak menggambar apa-apa.
 * Yang tidak bisa dibaca dilewati; sisanya tetap tampil.
 */
export function parseCards(source: string): CardSpec | null {
  const spec: CardSpec = { cards: [] };

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim().replace(/^[-*]\s+/, "");
    if (!line) continue;

    const heading = line.match(HEADING);
    if (heading) {
      const value = heading[2].trim();
      if (!value) continue;
      if (/^(judul|title)$/i.test(heading[1])) spec.title = value;
      else spec.note = value;
      continue;
    }

    if (!line.includes("|")) continue;

    // Dipecah maksimal empat bagian: yang keempat adalah gambarnya, dan sebuah
    // `path` boleh memuat apa saja termasuk tanda `|`.
    const parts = line.split("|");
    const name = parts[0].trim();
    if (!name) continue;

    const card: Card = { name };

    const meta = parts[1]?.trim();
    if (meta) card.meta = meta;

    const sub = parts[2]?.trim();
    if (sub) card.sub = sub;

    const art = parts.slice(3).join("|").trim();
    if (art) card.art = art;

    spec.cards.push(card);
    if (spec.cards.length >= MAX_CARDS) break;
  }

  return spec.cards.length > 0 ? spec : null;
}

/**
 * Apakah sepotong blok kode memang sekumpulan kartu.
 *
 * Label bahasa di pagar blok tidak bisa diandalkan — model menulis \`\`\`cards,
 * kadang tanpa label sama sekali. Yang diperiksa di sini bentuk isinya, dan
 * syaratnya sengaja ketat: harus ada baris judul ATAU catatan, dan minimal dua
 * baris yang benar-benar berbentuk kartu. Perintah shell yang penuh tanda `|`
 * tidak memenuhi keduanya, dan blok kode yang salah dikira kartu adalah kode
 * yang hilang dari layar.
 */
export function looksLikeCards(source: string): boolean {
  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 3) return false;
  if (!lines.some((line) => HEADING.test(line))) return false;

  const rows = lines.filter((line) => !HEADING.test(line) && line.split("|").length >= 3);
  return rows.length >= 2;
}

/** Jumlah kolom, dipilih supaya kisinya penuh dan tidak jangkung. */
export function columnsFor(count: number): number {
  if (count <= 3) return Math.max(count, 1);

  let best = 3;
  let bestScore = Infinity;

  for (const columns of [2, 3, 4]) {
    const rows = Math.ceil(count / columns);
    // Satu baris berarti kartu-kartu yang berjejer sendirian di atas ruang
    // kosong selebar kanvas. Untuk sebanyak ini, dua baris selalu lebih baik.
    if (rows < 2) continue;

    const empty = columns * rows - count;

    // Barisnya yang paling mahal — kisi jangkung terpotong di layar telepon —
    // lalu kotak yang bolong di baris terakhir. Kolom yang lebih banyak jadi
    // penentu terakhir kalau keduanya seri.
    const score = rows * 10 + empty * 3 - columns;
    if (score < bestScore) {
      bestScore = score;
      best = columns;
    }
  }

  return best;
}

/** Tepi kiri dan jarak antar kartu, per jumlah kolom. */
const SPACING: Record<number, { margin: number; gap: number }> = {
  1: { margin: 240, gap: 0 },
  2: { margin: 24, gap: 32 },
  3: { margin: 24, gap: 24 },
  4: { margin: 18, gap: 20 },
};

/**
 * Lebar teks, kira-kira, dalam satuan yang sama dengan font-size-nya.
 *
 * Tidak ada cara mengukur teks dengan tepat di sini — pengukurannya milik
 * browser, dan yang ini dihitung di sisi server sebelum ada layar mana pun.
 * Yang dibutuhkan juga bukan ketepatan, melainkan tahu kapan sebuah nama
 * TIDAK MUAT: judul yang lebih lebar dari kartunya keluar lewat kedua sisi dan
 * menabrak kartu di sebelahnya, dan itu satu-satunya cara kisi ini masih bisa
 * terlihat berantakan.
 *
 * Huruf sempit dan huruf lebar dipisah karena selisihnya besar — "Illinois" dan
 * "Wm@Wm" sama-sama delapan huruf dengan lebar hampir tiga kali lipat berbeda,
 * dan rata-rata tunggal salah di kedua ujungnya.
 */
const NARROW = new Set("iljItfr1.,:;'!|()[]{}/\\ ");
const WIDE = new Set("MWmw@%");

export function textWidth(text: string, size: number): number {
  let units = 0;

  for (const char of text) {
    if (NARROW.has(char)) units += 0.32;
    else if (WIDE.has(char)) units += 0.88;
    else if (char >= "A" && char <= "Z") units += 0.66;
    else units += 0.54;
  }

  return units * size;
}

/** Teks yang dipendekkan sampai muat, dengan elipsis kalau ada yang dibuang. */
export function fitText(text: string, size: number, max: number): string {
  if (textWidth(text, size) <= max) return text;

  const chars = [...text];
  while (chars.length > 1) {
    chars.pop();
    const candidate = `${chars.join("").trimEnd()}…`;
    if (textWidth(candidate, size) <= max) return candidate;
  }

  return "…";
}

/** Tanda yang punya arti di XML, di dalam teks yang bukan markup. */
function escape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Simbol dari model, dibuang semua yang bukan bentuk.
 *
 * `<g>` ikut dibuang, dan itu bukan kehati-hatian berlebihan. Satu grup yang
 * lupa ditutup akan MEMAKAN penutup grup milik kartunya, dan transform kartu itu
 * lalu ikut terbawa ke semua kartu sesudahnya — satu tag yang kurang menggeser
 * separuh gambar. Simbol seukuran 100x100 tidak pernah butuh grup, jadi menutup
 * kemungkinan itu tidak mengorbankan apa pun.
 *
 * Ini bukan pengganti penyaringan. Yang tergambar tetap lewat DOMPurify di
 * SvgBlock; yang di sini menjaga bentuk kanvasnya, bukan keamanannya.
 */
export function safeArt(art: string): string {
  return art
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    // Isinya ikut, bukan cuma tagnya: membuang <script> saja meninggalkan badan
    // fungsinya sebagai teks lepas yang lalu TERGAMBAR di tengah kartu.
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/<\/?([a-zA-Z][\w:-]*)\b[^>]*>/g, (tag, name: string) =>
      ART_TAGS.has(name.toLowerCase()) ? tag : ""
    );
}

/** Tinggi sebuah kartu, dihitung dari baris apa saja yang benar-benar terisi. */
function cardHeight(cards: Card[]): number {
  const art = cards.some((card) => card.art);
  const meta = cards.some((card) => card.meta);
  const sub = cards.some((card) => card.sub);

  // Semua kartu setinggi yang sama walau isinya tidak sama banyak. Tinggi yang
  // mengikuti isi masing-masing menghasilkan baris yang bergerigi — dan
  // bergerigi persis yang sedang diperbaiki di sini.
  return 16 + (art ? ART_SIZE + 14 : 0) + 22 + (meta ? 20 : 0) + (sub ? 18 : 0) + 14;
}

/**
 * Kartu-kartu itu sebagai satu SVG yang sudah jadi.
 *
 * Keluarannya tetap SVG, bukan HTML, supaya ia lewat jalan yang sudah ada:
 * disaring DOMPurify, viewBox-nya dirapatkan ke isinya, dan bisa disimpan
 * sebagai PNG lewat tombol yang sama. Yang berubah cuma siapa yang menghitung
 * koordinatnya.
 */
export function cardsSvg(spec: CardSpec): string {
  const cards = spec.cards.slice(0, MAX_CARDS);
  const columns = columnsFor(cards.length);
  const { margin, gap } = SPACING[columns] ?? SPACING[3];

  const cardWidth = (WIDTH - margin * 2 - gap * (columns - 1)) / columns;
  const height = cardHeight(cards);
  const rows = Math.ceil(cards.length / columns);

  const parts: string[] = [];

  let top = 24;
  if (spec.title) {
    parts.push(
      `<text x="24" y="${top + 15}" font-size="20" font-weight="bold" fill="#0f172a">${escape(
        fitText(spec.title, 20, WIDTH - 48)
      )}</text>`
    );
    top += 26;
  }
  if (spec.note) {
    parts.push(
      `<text x="24" y="${top + 11}" font-size="13" fill="#64748b">${escape(
        fitText(spec.note, 13, WIDTH - 48)
      )}</text>`
    );
    top += 18;
  }
  if (spec.title || spec.note) top += 14;

  const hasArt = cards.some((card) => card.art);
  const inner = cardWidth - 20;

  cards.forEach((card, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);

    // Baris terakhir yang tidak penuh ditaruh di tengah. Dibiarkan rata kiri, ia
    // terbaca seperti ada kartu yang hilang di kanan; di tengah, ia terbaca
    // seperti memang segitu isinya.
    const inRow = Math.min(columns, cards.length - row * columns);
    const indent = ((columns - inRow) * (cardWidth + gap)) / 2;

    const x = margin + indent + column * (cardWidth + gap);
    const y = top + row * (height + ROW_GAP);
    const middle = x + cardWidth / 2;

    parts.push(
      `<rect x="${round(x)}" y="${y}" width="${round(cardWidth)}" height="${height}" rx="10" fill="#f8fafc" stroke="#cbd5e1"/>`
    );

    if (card.art) {
      const scale = ART_SIZE / ART_BOX;
      parts.push(
        `<g transform="translate(${round(middle - ART_SIZE / 2)} ${y + 16}) scale(${round(scale)})">${safeArt(card.art)}</g>`
      );
    }

    let baseline = y + 16 + (hasArt ? ART_SIZE + 14 : 0) + 17;
    parts.push(
      `<text x="${round(middle)}" y="${round(baseline)}" text-anchor="middle" font-size="17" font-weight="bold" fill="#0f172a">${escape(
        fitText(card.name, 17, inner)
      )}</text>`
    );

    if (card.meta) {
      baseline += 20;
      parts.push(
        `<text x="${round(middle)}" y="${round(baseline)}" text-anchor="middle" font-size="13" fill="#475569">${escape(
          fitText(card.meta, 13, inner)
        )}</text>`
      );
    }

    if (card.sub) {
      baseline += 18;
      parts.push(
        `<text x="${round(middle)}" y="${round(baseline)}" text-anchor="middle" font-size="12" fill="#64748b">${escape(
          fitText(card.sub, 12, inner)
        )}</text>`
      );
    }
  });

  const total = top + rows * height + (rows - 1) * ROW_GAP + BOTTOM;

  return `<svg viewBox="0 0 ${WIDTH} ${total}" xmlns="http://www.w3.org/2000/svg" font-family="system-ui,sans-serif">${parts.join(
    ""
  )}</svg>`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
