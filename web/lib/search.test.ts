import { describe, expect, it } from "vitest";
import { matchesQuery, searchableText } from "./search";

const WITH_DIAGRAM = `Tinggi rack standar 42U.

\`\`\`svg
<svg viewBox="0 0 800 500"><rect x="10" y="10" fill="#fff"/><text x="20">42U</text></svg>
\`\`\`

Kedalaman 600–1.200 mm.`;

describe("searchableText", () => {
  it("membuang gambarnya, menyisakan teksnya", () => {
    const text = searchableText(WITH_DIAGRAM);
    expect(text).toContain("Tinggi rack standar 42U");
    expect(text).toContain("Kedalaman 600");
    expect(text).not.toContain("<svg");
    expect(text).not.toContain("viewBox");
  });

  it("teks tanpa gambar tidak berubah isinya", () => {
    expect(searchableText("PUIL 2011 pasal 3")).toContain("PUIL 2011 pasal 3");
  });
});

describe("matchesQuery", () => {
  it("mencocokkan tanpa peduli besar-kecil huruf", () => {
    expect(matchesQuery("Standar PUIL 2011", "puil")).toBe(true);
    expect(matchesQuery("standar puil 2011", "PUIL")).toBe(true);
  });

  it("semua kata harus ada, urutannya bebas", () => {
    // Bentuk yang sebenarnya diingat orang: dua kata kunci, bukan potongan
    // kalimat yang persis.
    const answer = "Cable tray di lantai 2 dipasang pada ketinggian 3 m.";
    expect(matchesQuery(answer, "tray lantai")).toBe(true);
    expect(matchesQuery(answer, "lantai tray")).toBe(true);
    expect(matchesQuery(answer, "tray tangga")).toBe(false);
  });

  it("kata di dalam markup gambar TIDAK dianggap cocok", () => {
    // Tanpa ini, "text" atau "rect" mencocokkan setiap jawaban yang memuat
    // gambar — dan pencarian yang mengembalikan semuanya sama tidak bergunanya
    // dengan yang tidak mengembalikan apa pun.
    expect(matchesQuery(WITH_DIAGRAM, "rect")).toBe(false);
    expect(matchesQuery(WITH_DIAGRAM, "viewBox")).toBe(false);
    expect(matchesQuery(WITH_DIAGRAM, "42U")).toBe(true);
  });

  it("pencarian kosong mencocokkan semuanya", () => {
    // Kolom yang kosong berarti tidak sedang mencari, bukan sedang mencari
    // kekosongan.
    expect(matchesQuery("apa pun", "")).toBe(true);
    expect(matchesQuery("apa pun", "   ")).toBe(true);
  });
});
