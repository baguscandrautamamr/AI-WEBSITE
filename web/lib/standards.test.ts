import { describe, expect, it } from "vitest";
import { buildSources, chunkDocument, headingOf, labelOf, type FoundChunk } from "./standards";

const found = (over: Partial<FoundChunk> = {}): FoundChunk => ({
  doc_code: "PUIL 2011",
  doc_title: "Persyaratan Umum Instalasi Listrik",
  doc_edition: null,
  heading: "3.24.2.1 Proteksi terhadap kejut listrik",
  page: 142,
  content: "Isi pasalnya.",
  rank: 1,
  ...over,
});

describe("headingOf", () => {
  it("mengenali nomor pasal bertingkat beserta nomornya", () => {
    // Nomornya HARUS ikut: judul tanpa nomor tidak bisa dipakai sebagai
    // kutipan, dan kutipan itu seluruh gunanya fitur ini ada.
    expect(headingOf("3.24.2.1 Proteksi terhadap kejut listrik")).toBe(
      "3.24.2.1 Proteksi terhadap kejut listrik"
    );
  });

  it("mengenali markdown, Pasal, dan Table", () => {
    expect(headingOf("## Proteksi arus lebih")).toBe("Proteksi arus lebih");
    expect(headingOf("Pasal 5 Ketentuan umum")).toBe("Pasal 5 Ketentuan umum");
    expect(headingOf("Table 52.1 Current-carrying capacity")).toBe(
      "Table 52.1 Current-carrying capacity"
    );
  });

  it("baris tabel dan baris biasa BUKAN judul", () => {
    // Yang paling berbahaya di sini bukan judul yang terlewat — potongannya
    // mewarisi judul benar di atasnya — melainkan judul yang salah kenal, yang
    // memberi nomor pasal salah ke seluruh potongan sesudahnya.
    expect(headingOf("NYY 4x25 KHA 116 A pada suhu 30 °C")).toBeNull();
    expect(headingOf("PERINGATAN")).toBeNull();
    expect(headingOf("Penghantar netral harus diberi warna biru muda.")).toBeNull();
    expect(headingOf("")).toBeNull();
  });

  it("baris yang kepanjangan bukan judul", () => {
    expect(headingOf(`1. ${"kata ".repeat(60)}`)).toBeNull();
  });
});

describe("chunkDocument", () => {
  it("judul yang berlaku menempel pada potongannya", () => {
    const chunks = chunkDocument(
      [
        "3.1 Ruang lingkup",
        "Standar ini mengatur instalasi listrik tegangan rendah.",
        "3.2 Proteksi",
        "Setiap sirkit harus diberi proteksi arus lebih.",
      ].join("\n\n")
    );

    // Dokumen pendek: keduanya boleh masuk satu potongan, tapi judul yang
    // tercatat harus salah satu yang memang ada — bukan null.
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    for (const chunk of chunks) {
      expect(chunk.heading).toMatch(/^3\.[12] /);
    }
  });

  it("halaman dihitung dari form feed, seperti keluaran pdftotext", () => {
    const chunks = chunkDocument("Halaman satu.\f\nHalaman dua.\f\nHalaman tiga.");

    expect(chunks.map((c) => c.page)).toEqual([1, 2, 3]);
  });

  it("sumber tanpa halaman tidak mengarang nomor halaman", () => {
    // Nomor halaman yang dikarang adalah kutipan yang mengirim orang ke halaman
    // yang tidak memuat apa-apa — dan yang ia simpulkan dari situ bukan "nomor
    // halamannya salah" melainkan "sistemnya mengarang".
    const chunks = chunkDocument("Satu paragraf saja, tanpa form feed.");
    expect(chunks[0].page).toBeNull();
  });

  it("judul memulai potongan baru kalau yang sekarang sudah cukup panjang", () => {
    const body = "Kalimat yang cukup panjang untuk mengisi anggaran. ".repeat(20);
    const chunks = chunkDocument(`3.1 Awal\n\n${body}\n\n3.2 Lanjutan\n\n${body}`);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.some((c) => c.heading === "3.2 Lanjutan")).toBe(true);
  });

  it("ord berurutan dan tanpa lubang", () => {
    const body = "Isi paragraf. ".repeat(200);
    const chunks = chunkDocument(`1. Satu\n\n${body}\n\n2. Dua\n\n${body}`);

    expect(chunks.map((c) => c.ord)).toEqual(chunks.map((_, i) => i));
  });

  it("blok raksasa dipecah, dan tidak ada isi yang hilang", () => {
    // Sebuah tabel KHA bisa satu blok tanpa baris kosong sepanjang ribuan
    // karakter. Yang tidak boleh terjadi: potongan yang isinya hilang.
    const rows = Array.from({ length: 300 }, (_, i) => `NYY 4x${i} KHA ${i * 2} A`);
    const chunks = chunkDocument(`Tabel 1 KHA\n${rows.join("\n")}`);

    expect(chunks.length).toBeGreaterThan(1);
    const all = chunks.map((c) => c.content).join(" ");
    expect(all).toContain("NYY 4x0 KHA 0 A");
    expect(all).toContain("NYY 4x299 KHA 598 A");
  });

  it("CRLF tidak merusak pengenalan judul", () => {
    const chunks = chunkDocument("3.1 Ruang lingkup\r\n\r\nIsi.\r\n");
    expect(chunks[0].heading).toBe("3.1 Ruang lingkup");
  });

  it("dokumen kosong menghasilkan nol potongan, bukan satu yang kosong", () => {
    expect(chunkDocument("")).toEqual([]);
    expect(chunkDocument("   \n\n  \f  ")).toEqual([]);
  });
});

describe("labelOf", () => {
  it("edisi ikut, karena pasal benar dari edisi salah adalah jawaban salah", () => {
    expect(labelOf(found({ doc_edition: "2011" }))).toBe(
      "PUIL 2011 (2011) — 3.24.2.1 Proteksi terhadap kejut listrik — hal. 142"
    );
  });

  it("yang tidak ada tidak ditulis", () => {
    expect(labelOf(found({ heading: null, page: null }))).toBe("PUIL 2011");
  });

  it("halaman 0 tetap disebut", () => {
    // `if (page)` akan menelan halaman 0. Tidak umum, tapi kalau sumbernya
    // menomori dari nol, kutipan tanpa halaman lebih buruk daripada "hal. 0".
    expect(labelOf(found({ heading: null, page: 0 }))).toContain("hal. 0");
  });
});

describe("buildSources", () => {
  it("bernomor, dan nomor di blok sama dengan nomor di daftar", () => {
    // Inti fungsi ini. `[2]` di dalam kalimat harus menunjuk dokumen yang sama
    // dengan `[2]` di daftar di bawah jawaban — kalau tidak, kutipannya
    // mengundang orang memeriksanya lalu menyesatkan pemeriksaannya.
    const { block, refs } = buildSources([
      found({ doc_code: "PUIL 2011" }),
      found({ doc_code: "IEC 60364", heading: "411.3.2", page: 12 }),
    ]);

    expect(block).toContain("[1] PUIL 2011");
    expect(block).toContain("[2] IEC 60364");
    expect(refs).toEqual([
      { n: 1, label: labelOf(found({ doc_code: "PUIL 2011" })) },
      { n: 2, label: labelOf(found({ doc_code: "IEC 60364", heading: "411.3.2", page: 12 })) },
    ]);
  });

  it("pemotongan anggaran memotong blok DAN daftar bersamaan", () => {
    const big = found({ content: "x".repeat(3_000) });
    const { block, refs } = buildSources([big, big, big, big], 5_000);

    // Berapa pun yang lolos, jumlah entri di blok harus sama dengan jumlah
    // entri di daftar. Itu yang menjaga nomornya tetap menunjuk hal yang sama.
    expect(refs.length).toBe(block.split("\n\n").filter((p) => p.startsWith("[")).length);
    expect(refs.length).toBeLessThan(4);
    expect(refs.length).toBeGreaterThan(0);
  });

  it("satu sumber yang sendirian melebihi anggaran tetap terkirim", () => {
    // Sebuah tabel KHA bisa lebih panjang dari seluruh anggaran. Jawaban tanpa
    // sumber lebih buruk daripada sumber tunggal yang kepanjangan.
    const { refs } = buildSources([found({ content: "y".repeat(20_000) })], 1_000);
    expect(refs).toHaveLength(1);
  });

  it("tanpa kecocokan, bloknya kosong — bukan blok kosong yang berbunyi", () => {
    // Kosong adalah penanda yang dipakai route untuk TIDAK memasang blok SUMBER
    // sama sekali, sehingga aturan "jawab dari ingatan, dan katakan begitu"
    // berlaku utuh seperti sebelum RAG ada.
    expect(buildSources([])).toEqual({ block: "", refs: [] });
  });
});
