import { describe, expect, it } from "vitest";
import { asciiTable } from "./asciiTable";

/** Bentuk yang benar-benar sampai ke layar pengguna. */
const REPORTED = `| BRAND / TIPE          | UKURAN     | PENGGUNAAN     |
|-----------------------|------------|----------------|
| BICC Flexibra         | 25 mm²     | Umum           |
| Furse WB25            | 25 mm²     | IEC standar    |
| Kunda / OBO           | 25-50 mm²  | Gondola        |
| Generic tinned copper | 25 mm²     | Alternatif     |`;

describe("asciiTable — tabel yang digambar dengan karakter", () => {
  it("membaca kepala dan isinya", () => {
    const table = asciiTable(REPORTED)!;

    expect(table.head).toEqual(["BRAND / TIPE", "UKURAN", "PENGGUNAAN"]);
    expect(table.rows).toHaveLength(4);
    expect(table.rows[2]).toEqual(["Kunda / OBO", "25-50 mm²", "Gondola"]);
  });

  it("menyatukan sel yang meluber ke baris berikutnya", () => {
    // Model memecah nama panjang jadi dua baris. Dibaca apa adanya, yang kedua
    // jadi baris tabel yang hampir seluruhnya kosong.
    const table = asciiTable(`| MERK              | UKURAN |
|-------------------|--------|
| Generic tinned    | 25 mm² |
| (copper braid)    |        |
| Furse WB25        | 25 mm² |`)!;

    expect(table.rows).toHaveLength(2);
    expect(table.rows[0][0]).toBe("Generic tinned (copper braid)");
  });

  it("baris kosong dan garis pemisah tidak jadi baris tabel", () => {
    const table = asciiTable(`| A     | B     |
|-------|-------|
|       |       |
| satu  | dua   |
| tiga  | empat |`)!;

    expect(table.rows).toEqual([
      ["satu", "dua"],
      ["tiga", "empat"],
    ]);
  });

  it("tabel bergambar kotak juga terbaca", () => {
    const table = asciiTable(`┌───────────┬────────┐
│ MERK      │ UKURAN │
├───────────┼────────┤
│ Furse     │ 25 mm² │
│ OBO       │ 50 mm² │
└───────────┴────────┘`)!;

    expect(table.head).toEqual(["MERK", "UKURAN"]);
    expect(table.rows).toEqual([
      ["Furse", "25 mm²"],
      ["OBO", "50 mm²"],
    ]);
  });

  it("kolom yang jumlahnya tidak sama diratakan", () => {
    const table = asciiTable(`| A | B | C |
|---|---|---|
| 1 | 2 |
| 3 | 4 | 5 |`)!;

    expect(table.head).toHaveLength(3);
    expect(table.rows[0]).toEqual(["1", "2", ""]);
  });
});

describe("asciiTable — yang BUKAN tabel harus tetap tampil sebagai kode", () => {
  // Blok kode yang salah dikira tabel adalah kode yang hilang dari layar, dan
  // itu jauh lebih buruk daripada tabel yang tampil apa adanya.
  it("perintah shell berantai bukan tabel", () => {
    expect(asciiTable("cat log.txt | grep ERROR | wc -l\nps aux | grep node\nls -la | head")).toBeNull();
  });

  it("kode yang kebetulan punya garis pemisah tetap kode", () => {
    expect(
      asciiTable("// ---------------------------\nconst a = x | y;\nconst b = y | z;")
    ).toBeNull();
  });

  it("pohon dengan keterangan menggantung bukan tabel", () => {
    // Ada baris yang bukan garis dan bukan kolom, jadi membacanya sebagai tabel
    // akan membuang isinya.
    expect(
      asciiTable(`INDONESIA (PUIL 2011):
├── Tipe C ──── Steker Europlug
│       charger, TV, audio
└── Tipe F ──── Schuko`)
    ).toBeNull();
  });

  it("yang terlalu pendek untuk jadi tabel", () => {
    expect(asciiTable("| A | B |\n|---|---|")).toBeNull();
    expect(asciiTable("")).toBeNull();
  });

  it("tanpa garis pemisah, bukan tabel", () => {
    expect(asciiTable("| A | B |\n| 1 | 2 |\n| 3 | 4 |")).toBeNull();
  });
});
