/**
 * Memisahkan gambar dari teks dalam jawaban model.
 *
 * Sistem prompt meminta SVG dikirim sebagai blok kode berbahasa `svg`, dan
 * ketika itu yang datang, react-markdown sudah menanganinya. Yang datang tidak
 * selalu itu. Model juga mengirimkan hal seperti:
 *
 *   [TOOL_CALL] {"name": "diagram", "input": {"svg": "<svg ...>\n ... </svg>" }} [/TOOL_CALL]
 *
 * — sebuah pemanggilan tool yang tidak pernah kami definisikan, dengan SVG-nya
 * di dalam string JSON dan baris barunya sebagai dua karakter `\` dan `n`.
 * Karena ia bukan blok kode, override `pre`/`code` tidak pernah terpanggil, dan
 * markdown menampilkan seluruhnya sebagai teks: satu layar penuh sintaksis SVG
 * yang berakhir dengan `}} [/TOOL_CALL]`. Itu yang terlihat di halaman Standard.
 *
 * Prompt-nya diperketat, tapi prompt bukan jaminan — ini jawaban model, bukan
 * keluaran program. Jadi yang menentukan tampilnya sebuah gambar adalah bentuk
 * ISINYA, bukan pembungkus yang dipilih model saat itu.
 */

export type Segment =
  | { kind: "text"; value: string }
  | { kind: "svg"; value: string };

/**
 * Satu SVG, dengan pagar blok kode di sekelilingnya kalau ada.
 *
 * Pagarnya ikut dimakan supaya tidak meninggalkan blok kode kosong di tempat
 * gambarnya diangkat.
 */
const SVG_BLOCK = /(?:```[\w-]*[ \t]*\r?\n)?(<svg[\s>][\s\S]*?<\/svg>)[ \t]*\r?\n?(?:```)?/gi;

/** Pembungkus tool-call yang tidak pernah kami minta. */
const TOOL_CALL = /\[TOOL_CALL\][\s\S]*?(?:\[\/TOOL_CALL\]|$)/gi;

/**
 * Pagar blok kode yang menggantung, karena gambarnya belum selesai ditulis.
 *
 * `SVG_BLOCK` memakan pagar pembuka bersama gambarnya — tapi hanya untuk gambar
 * yang sudah punya `</svg>`. Selama masih mengalir, yang ada baru "```svg\n"
 * diikuti gambar yang belum utuh, dan pagar itu tertinggal di potongan teks
 * sebelumnya. Markdown lalu melihat blok kode yang tidak pernah ditutup dan
 * menggambarnya sebagai kotak abu-abu kosong selebar gelembung — persis di
 * tempat gambarnya akan muncul, selama seluruh waktu gambar itu ditulis.
 */
const DANGLING_FENCE = /```[\w-]*[ \t]*\r?\n?$/;

/** Sisa tanda baca setelah gambarnya diangkat: `" }}`, `",`, `}]`. */
const PUNCTUATION_ONLY = /^[\s"'`{}[\]:,\\()]*$/;

/**
 * Pembuka objek JSON yang menggantung, mis. `{"name": "diagram", "input": {"svg": "`.
 *
 * Dibatasi 300 karakter dan wajib berakhir pada sebuah `:` beserta kutipnya:
 * kalimat sungguhan tidak berbentuk begitu, dan batas itu menjaga agar paragraf
 * panjang yang kebetulan diawali `{` tidak ikut terbuang.
 */
const JSON_OPENER = /^\{[\s\S]{0,300}["'\s]:\s*["']?\s*$/;

/**
 * Baris baru dan kutip yang masih berupa dua karakter, karena SVG-nya pernah
 * berada di dalam sebuah string JSON.
 *
 * Hanya dilakukan kalau tidak ada satu pun baris baru sungguhan — SVG yang
 * memang ditulis wajar punya banyak, dan menyentuhnya hanya akan merusak.
 */
function unescape(source: string) {
  if (/\r|\n/.test(source) || !/\\[nrt"\\]/.test(source)) return source;

  const table: Record<string, string> = {
    n: "\n",
    r: "\r",
    t: "\t",
    '"': '"',
    "\\": "\\",
  };

  return source.replace(/\\([nrt"\\])/g, (_, char: string) => table[char]);
}

/** Teks yang tersisa dan tidak lagi berarti apa-apa bagi pembacanya. */
function isScaffolding(value: string) {
  const trimmed = value.trim();
  if (trimmed.length === 0) return true;
  return PUNCTUATION_ONLY.test(trimmed) || JSON_OPENER.test(trimmed);
}

/** Mengambil SVG dari sepotong teks, sisanya tetap teks. */
function scan(source: string, into: Segment[]) {
  let last = 0;

  for (const match of source.matchAll(SVG_BLOCK)) {
    const before = source.slice(last, match.index);
    if (!isScaffolding(before)) into.push({ kind: "text", value: before });

    into.push({ kind: "svg", value: unescape(match[1]) });
    last = match.index + match[0].length;
  }

  const rest = source.slice(last);

  // Gambar yang belum selesai ditulis tetap sebuah gambar.
  //
  // Selama jawabannya masih mengalir, `</svg>` belum ada. Tanpa bagian ini
  // pengguna melihat sintaksis SVG mentah memanjang di layar selama beberapa
  // detik, lalu tiba-tiba berganti menjadi gambar — dan yang terbaca selama
  // detik-detik itu adalah kesan bahwa jawabannya rusak. SvgBlock sudah tahu
  // cara menampilkan "sedang menggambar" untuk sumber yang belum utuh.
  // Tag pembukanya harus sudah selesai, bukan cuma dimulai.
  //
  // `<svg` saja bisa muncul di tengah kalimat — jawaban yang MENYEBUT elemen
  // svg, atau potongan pertama sebuah aliran yang belum tentu berlanjut jadi
  // gambar. Menganggapnya diagram terlalu dini membuat seluruh gelembung
  // berganti jadi "Menggambar diagram…" untuk jawaban yang tidak menggambar
  // apa-apa.
  const opening = rest.search(/<svg[^>]*>/i);
  if (opening >= 0) {
    const before = rest.slice(0, opening).replace(DANGLING_FENCE, "");
    if (!isScaffolding(before)) into.push({ kind: "text", value: before });
    into.push({ kind: "svg", value: unescape(rest.slice(opening)) });
    return;
  }

  if (!isScaffolding(rest)) into.push({ kind: "text", value: rest });
}

/**
 * Jawaban model sebagai deretan potongan teks dan gambar, dalam urutan aslinya.
 *
 * Isi sebuah blok tool-call dibuang kecuali SVG di dalamnya: yang lain adalah
 * nama tool dan tanda baca JSON, dan tak satu pun dari itu ditujukan kepada
 * pembaca.
 */
export function splitDiagrams(text: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;

  for (const match of text.matchAll(TOOL_CALL)) {
    scan(text.slice(last, match.index), segments);

    // Di dalam pembungkusnya, hanya gambarnya yang dipertahankan.
    for (const svg of match[0].matchAll(SVG_BLOCK)) {
      segments.push({ kind: "svg", value: unescape(svg[1]) });
    }

    last = match.index + match[0].length;
  }

  scan(text.slice(last), segments);

  // Potongan teks yang bersebelahan disatukan kembali supaya markdown melihat
  // satu dokumen, bukan potongan yang paragraf dan daftarnya terputus.
  return segments.reduce<Segment[]>((merged, segment) => {
    const previous = merged[merged.length - 1];
    if (segment.kind === "text" && previous?.kind === "text") {
      previous.value += segment.value;
      return merged;
    }
    merged.push({ ...segment });
    return merged;
  }, []);
}

/**
 * Ukuran gambar menurut viewBox-nya.
 *
 * Dipakai dua kali dan untuk dua hal yang berbeda: menentukan tinggi PNG saat
 * gambarnya disimpan, dan memesan tempat di halaman selagi gambarnya masih
 * ditulis. Yang belum menyebutkan viewBox dijawab dengan perbandingan mendatar —
 * bentuk yang diminta prompt, jadi tempat yang dipesan tidak akan jauh salah.
 */
export function svgSize(svg: string): { width: number; height: number } {
  const match = svg.match(
    /viewBox\s*=\s*["']\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i
  );
  if (!match) return { width: 1000, height: 700 };

  const width = Number(match[3]);
  const height = Number(match[4]);
  return width > 0 && height > 0 ? { width, height } : { width: 1000, height: 700 };
}

/**
 * Gambar setengah jadi, dibuat sah supaya bisa langsung digambar.
 *
 * Ada supaya sebuah diagram terlihat TUMBUH alih-alih menghilang di balik
 * tulisan "sedang menggambar" selama satu menit penuh. Diagram berdimensi
 * memakan beberapa ribu token untuk ditulis, dan tidak ada cara membuat model
 * menulisnya lebih cepat — yang bisa diubah adalah apakah orangnya menonton
 * sesuatu terjadi atau menonton sebuah kalimat.
 *
 * Dipotong pada `>` terakhir, bukan di tempat alirannya berhenti: `<rect x="10`
 * adalah tag yang belum selesai, dan tag yang belum selesai membuat parser
 * menelan apa pun sesudahnya. Yang dipotong di batas tag selalu berupa
 * elemen-elemen utuh, ditambah satu tag penutup di ujungnya.
 *
 * Grup yang belum ditutup tidak perlu diurus — parser HTML menutup sendiri apa
 * yang tertinggal terbuka.
 */
export function drawableSvg(source: string): string {
  const end = source.lastIndexOf(">");
  if (end === -1) return "";

  const head = source.slice(0, end + 1);
  return /<\/svg\s*>\s*$/i.test(head) ? head : `${head}</svg>`;
}
