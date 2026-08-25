import { describe, expect, it } from "vitest";
import { digestResult } from "./resultDigest";

describe("digestResult", () => {
  it("nama parameter ikut — inilah sebabnya file ini ada", () => {
    // `summarizeResult` menjawab "12 parameter" untuk hasil yang sama, dan itu
    // tidak bisa dipakai memutuskan langkah berikutnya. Yang dibutuhkan langkah
    // berikutnya adalah namanya, persis, karena nama yang salah mengembalikan
    // kolom KOSONG — dan kosong tidak bisa dibedakan dari model yang memang
    // tidak punya nilainya.
    const digest = digestResult({
      category: "lighting",
      parameters: [
        { name: "Wattage", type: "Double" },
        { name: "Mark", type: "String" },
      ],
    });

    expect(digest).toContain("Wattage");
    expect(digest).toContain("Mark");
    expect(digest).toContain("category: lighting");
  });

  it("skalar sebelum daftar, supaya yang dipotong bukan angkanya", () => {
    const digest = digestResult({
      rows: [{ Family: "A" }, { Family: "B" }],
      total: 128,
    });

    expect(digest.indexOf("total: 128")).toBeLessThan(digest.indexOf("rows"));
  });

  it("daftar yang dipotong menyebut jumlah sebenarnya", () => {
    // 40 yang dibaca sebagai seluruhnya adalah kesimpulan yang salah tanpa satu
    // pun tanda. Jumlah sebenarnya harus ada di teksnya.
    const digest = digestResult({
      rows: Array.from({ length: 200 }, (_, i) => ({ Mark: `M${i}` })),
    });

    expect(digest).toContain("rows (200,");
    expect(digest).toContain("40 pertama");
    expect(digest).toContain("160 lagi tidak ditampilkan");
  });

  it("daftar utuh tidak mengaku dipotong", () => {
    const digest = digestResult({ items: [{ id: "1" }, { id: "2" }] });
    expect(digest).toContain("items (2):");
    expect(digest).not.toContain("tidak ditampilkan");
  });

  it("pemotongan panjang dikatakan, bukan didiamkan", () => {
    const digest = digestResult({ note: "x".repeat(5_000) }, 200);
    expect(digest.length).toBeLessThan(400);
    expect(digest).toContain("dipotong");
  });

  it("angka tidak berubah jadi 128.40000000000001", () => {
    expect(digestResult({ total: 128.4 })).toBe("total: 128.4");
    expect(digestResult({ total: 37 })).toBe("total: 37");
  });

  it("daftar kosong dibedakan dari daftar yang tidak ada", () => {
    // Bedanya nyata: `rows: []` berarti perintahnya jalan dan tidak menemukan
    // apa pun — kemungkinan besar penyaringnya salah. Tidak adanya `rows`
    // berarti perintah itu tidak melaporkan baris sama sekali.
    expect(digestResult({ rows: [] })).toBe("rows: (kosong)");
    expect(digestResult({ total: 0 })).toBe("total: 0");
  });

  it("null dan undefined dilewati, bukan ditulis sebagai kata", () => {
    expect(digestResult({ room: null, family: undefined, total: 3 })).toBe("total: 3");
    expect(digestResult(null)).toBe("");
    expect(digestResult(undefined)).toBe("");
  });

  it("objek bersarang dirapikan satu tingkat", () => {
    expect(digestResult({ grid: { columns: 5, rows: 2 } })).toBe("grid: { columns=5 rows=2 }");
  });

  it("hasil yang bukan objek tetap terbaca", () => {
    expect(digestResult("selesai")).toBe("selesai");
    expect(digestResult(42)).toBe("42");
  });

  it("medan sebuah butir dibatasi, tapi butirnya tetap terbaca", () => {
    const wide = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`p${i}`, i])
    );
    const digest = digestResult({ rows: [wide] });
    expect(digest).toContain("p0=0");
    expect(digest).not.toContain("p20=20");
  });
});
