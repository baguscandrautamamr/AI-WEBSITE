import { describe, expect, it } from "vitest";
import {
  cardsSvg,
  columnsFor,
  fitText,
  looksLikeCards,
  parseCards,
  safeArt,
  textWidth,
} from "./cards";

const BLOCK = `judul: Jenis Socket Outlet Internasional
catatan: Tampang depan, IEC 60906-1
Type A | US / Jepang | 100-127 V, 15 A | <circle cx="50" cy="50" r="34"/>
Type C | Eropa / Indonesia | 220-250 V, 2,5 A | <circle cx="50" cy="50" r="34"/>
Type G | Inggris / Malaysia | 220-240 V, 13 A |`;

describe("parseCards", () => {
  it("membaca judul, catatan, dan tiap kartunya", () => {
    const spec = parseCards(BLOCK)!;

    expect(spec.title).toBe("Jenis Socket Outlet Internasional");
    expect(spec.note).toBe("Tampang depan, IEC 60906-1");
    expect(spec.cards).toHaveLength(3);
    expect(spec.cards[0]).toEqual({
      name: "Type A",
      meta: "US / Jepang",
      sub: "100-127 V, 15 A",
      art: '<circle cx="50" cy="50" r="34"/>',
    });
  });

  it("kolom yang dikosongkan tidak jadi string kosong", () => {
    // Yang kosong harus HILANG, bukan jadi baris teks tanpa isi: baris kosong
    // tetap memakan tingginya dan yang terlihat adalah kartu yang isinya
    // menggantung di atas ruang kosong.
    expect(parseCards("judul: X\nA | | | \nB | b | |")!.cards[0]).toEqual({ name: "A" });
  });

  it("tanda hubung di depan baris dimaafkan", () => {
    // Model menulis daftar sebagai daftar; itu kebiasaan yang tidak bisa
    // dihapus dengan satu kalimat di prompt.
    expect(parseCards("judul: X\n- A | a | x\n- B | b | y")!.cards).toHaveLength(2);
  });

  it("blok tanpa satu pun kartu bukan kartu", () => {
    expect(parseCards("judul: X\ncatatan: Y")).toBeNull();
    expect(parseCards("")).toBeNull();
  });

  it("gambar yang memuat tanda pemisah tetap utuh", () => {
    // `path` boleh memuat apa saja, termasuk `|`. Yang dipecah cuma tiga kolom
    // pertamanya; sisanya milik gambar.
    const spec = parseCards('judul: X\nA | a | b | <path d="M0 0"/>|<circle r="1"/>')!;
    expect(spec.cards[0].art).toBe('<path d="M0 0"/>|<circle r="1"/>');
  });
});

describe("looksLikeCards", () => {
  it("mengenali blok kartu tanpa melihat label bahasanya", () => {
    expect(looksLikeCards(BLOCK)).toBe(true);
  });

  it("perintah shell yang penuh tanda pipa bukan kartu", () => {
    // Blok kode yang salah dikira kartu adalah kode yang HILANG dari layar,
    // jadi syaratnya sengaja ketat: harus ada baris judul atau catatan.
    expect(looksLikeCards("cat log.txt | grep ERROR | wc -l\nps aux | grep node")).toBe(false);
  });

  it("tabel markdown di dalam blok kode bukan kartu", () => {
    expect(looksLikeCards("| A | B |\n|---|---|\n| 1 | 2 |")).toBe(false);
  });
});

describe("columnsFor — kisi yang penuh dan tidak jangkung", () => {
  it("membagi supaya baris terakhir tidak bolong", () => {
    // Baris terakhir yang bolong terbaca seperti ada yang hilang.
    expect(columnsFor(4)).toBe(2);
    expect(columnsFor(6)).toBe(3);
    expect(columnsFor(8)).toBe(4);
    expect(columnsFor(9)).toBe(3);
    expect(columnsFor(12)).toBe(4);
  });

  it("jumlah yang tidak habis dibagi tetap dipilihkan yang paling pendek", () => {
    expect(columnsFor(7)).toBe(4);
    expect(columnsFor(10)).toBe(4);
    expect(columnsFor(11)).toBe(4);
  });

  it("yang sedikit berjejer dalam satu baris", () => {
    expect(columnsFor(1)).toBe(1);
    expect(columnsFor(2)).toBe(2);
    expect(columnsFor(3)).toBe(3);
  });
});

describe("fitText — nama yang lebih lebar dari kartunya", () => {
  it("membiarkan yang muat", () => {
    expect(fitText("Type A", 17, 200)).toBe("Type A");
  });

  it("memendekkan yang tidak muat, dan hasilnya benar-benar muat", () => {
    const cut = fitText("NEMA L6-20R twist-lock 250 V 20 A", 17, 120);

    expect(cut.endsWith("…")).toBe(true);
    expect(textWidth(cut, 17)).toBeLessThanOrEqual(120);
  });

  it("ruang yang mustahil tetap menghasilkan sesuatu", () => {
    expect(fitText("Type A", 17, 1)).toBe("…");
  });
});

describe("safeArt", () => {
  it("membuang grup, karena satu yang lupa ditutup menggeser separuh gambar", () => {
    expect(safeArt('<g transform="scale(2)"><circle r="3"/></g>')).toBe('<circle r="3"/>');
  });

  it("membuang yang bukan bentuk, beserta isinya", () => {
    // Badan fungsinya ikut dibuang: membuang tagnya saja meninggalkan `x()`
    // sebagai teks lepas yang lalu tergambar di tengah kartu.
    expect(safeArt('<svg><script>x()</script><rect width="2"/></svg>')).toBe('<rect width="2"/>');
  });

  it("membuang penangan kejadian", () => {
    expect(safeArt('<circle r="3" onclick="steal()"/>')).toBe('<circle r="3"/>');
  });

  it("bentuk yang wajar dibiarkan apa adanya", () => {
    const art = '<circle cx="50" cy="50" r="34" fill="none" stroke="#0f172a"/>';
    expect(safeArt(art)).toBe(art);
  });
});

describe("cardsSvg — yang dihitung program tidak meleset", () => {
  const spec = parseCards(BLOCK)!;
  const svg = cardsSvg(spec);

  function rects(markup: string) {
    return [...markup.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="(\d+)"/g)].map(
      (match) => ({
        x: Number(match[1]),
        y: Number(match[2]),
        width: Number(match[3]),
        height: Number(match[4]),
      })
    );
  }

  it("punya viewBox dan tidak punya width/height dalam piksel", () => {
    expect(svg).toMatch(/^<svg viewBox="0 0 960 \d+"/);
    expect(svg).not.toMatch(/<svg[^>]*\swidth=/);
  });

  it("tidak ada satu kartu pun yang bertumpuk dengan kartu lain", () => {
    // Inti dari seluruh berkas ini. Diperiksa sebagai perpotongan kotak, bukan
    // dengan membaca angkanya — yang diuji hasilnya, bukan niatnya.
    const boxes = rects(cardsSvg(parseCards(`judul: X\n${rows(9)}`)!));
    expect(boxes).toHaveLength(9);

    for (let a = 0; a < boxes.length; a += 1) {
      for (let b = a + 1; b < boxes.length; b += 1) {
        const overlaps =
          boxes[a].x < boxes[b].x + boxes[b].width &&
          boxes[b].x < boxes[a].x + boxes[a].width &&
          boxes[a].y < boxes[b].y + boxes[b].height &&
          boxes[b].y < boxes[a].y + boxes[a].height;
        expect(overlaps).toBe(false);
      }
    }
  });

  it("semua kartu berukuran sama persis", () => {
    const boxes = rects(cardsSvg(parseCards(`judul: X\n${rows(7)}`)!));
    expect(new Set(boxes.map((box) => `${box.width}x${box.height}`)).size).toBe(1);
  });

  it("seluruh isinya berada di dalam viewBox", () => {
    // Yang di luar kotak dipotong browser dan hilang tanpa jejak.
    const markup = cardsSvg(parseCards(`judul: X\n${rows(11)}`)!);
    const total = Number(markup.match(/viewBox="0 0 960 (\d+)"/)![1]);

    for (const box of rects(markup)) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(960);
      expect(box.y + box.height).toBeLessThanOrEqual(total);
    }
  });

  it("baris terakhir yang tidak penuh ditaruh di tengah", () => {
    // 7 kartu jadi 4 + 3. Yang tiga itu rata kiri terbaca seperti ada satu yang
    // hilang di kanan.
    const boxes = rects(cardsSvg(parseCards(`judul: X\n${rows(7)}`)!));
    const last = boxes.slice(4);

    const left = last[0].x;
    const right = 960 - (last[2].x + last[2].width);
    expect(Math.abs(left - right)).toBeLessThan(0.5);
  });

  it("kartu tanpa gambar jadi kartu yang lebih pendek", () => {
    const withArt = cardsSvg(parseCards('judul: X\nA | a | b | <circle r="3"/>\nB | c | d |')!);
    const plain = cardsSvg(parseCards("judul: X\nA | a | b |\nB | c | d |")!);

    expect(rects(withArt)[0].height).toBeGreaterThan(rects(plain)[0].height);
  });

  it("tidak menggambar bingkai mengelilingi seluruh gambar", () => {
    // Bingkai dekoratif tidak menerangkan apa pun, dan ia bagian yang paling
    // menyita perhatian ketika warnanya meleset.
    for (const box of rects(svg)) {
      expect(box.width).toBeLessThan(960);
    }
  });

  it("nama dari model tidak bisa menyuntikkan markup", () => {
    const markup = cardsSvg(parseCards('judul: X\n<script>a()</script> | b | c |\nB | c | d |')!);
    expect(markup).not.toContain("<script");
    expect(markup).toContain("&lt;script&gt;");
  });
});

/** Sekian baris kartu yang isinya tidak penting, hanya jumlahnya. */
function rows(count: number): string {
  return Array.from(
    { length: count },
    (_, index) => `Type ${index} | wilayah | 230 V | <circle cx="50" cy="50" r="30"/>`
  ).join("\n");
}
