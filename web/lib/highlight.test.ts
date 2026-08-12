import { describe, expect, it } from "vitest";
import { splitHighlights } from "./highlight";

/** Bentuk yang mudah dibaca di harapan tes: "a[b]c" = b ditandai. */
const shape = (text: string, terms: string[]) =>
  splitHighlights(text, terms)
    .map((piece) => (piece.hit ? `[${piece.text}]` : piece.text))
    .join("");

describe("splitHighlights", () => {
  it("menandai kemunculan, tanpa peduli besar-kecil huruf", () => {
    expect(shape("Beban Through Glass", ["through"])).toBe("Beban [Through] Glass");
  });

  it("menampilkan huruf aslinya, bukan huruf yang diketik pencarinya", () => {
    // Yang dicari boleh huruf kecil; yang tampil harus tetap seperti di jawaban.
    const pieces = splitHighlights("PUIL 2011", ["puil"]);
    expect(pieces[0]).toEqual({ text: "PUIL", hit: true });
  });

  it("menandai semua kemunculan, bukan yang pertama saja", () => {
    expect(shape("beban lalu beban lagi", ["beban"])).toBe("[beban] lalu [beban] lagi");
  });

  it("beberapa kata dicari sekaligus", () => {
    expect(shape("cold aisle dan hot aisle", ["cold", "hot"])).toBe(
      "[cold] aisle dan [hot] aisle"
    );
  });

  it("kecocokan yang bertindihan digabung jadi satu", () => {
    // "beban pendingin" pada tulisan "beban pendinginan": kedua kata menutupi
    // huruf yang sama. Tanpa digabung, yang tergambar adalah dua kotak kuning
    // yang saling menimpa di tengah kata.
    expect(shape("beban pendinginan", ["beban pendingin", "pendinginan"])).toBe(
      "[beban pendinginan]"
    );
  });

  it("kemunculan yang tumpang tindih dengan dirinya sendiri tetap terhitung", () => {
    expect(shape("aaaa", ["aa"])).toBe("[aaaa]");
  });

  it("tanpa kata pencarian, teksnya utuh dan tidak ditandai", () => {
    expect(splitHighlights("apa pun", [])).toEqual([{ text: "apa pun", hit: false }]);
    expect(splitHighlights("apa pun", [""])).toEqual([{ text: "apa pun", hit: false }]);
  });

  it("tidak cocok sama sekali: satu potong, tidak ditandai", () => {
    expect(splitHighlights("PUIL 2011", ["nec"])).toEqual([{ text: "PUIL 2011", hit: false }]);
  });

  it("teks kosong tidak menghasilkan potongan kosong", () => {
    // Sebuah <mark> berisi string kosong tetap sebuah simpul yang dirender.
    expect(splitHighlights("", ["a"])).toEqual([]);
  });

  it("potongan-potongannya kalau disambung kembali sama persis dengan aslinya", () => {
    // Ini yang menjaga agar penandaan tidak pernah menghilangkan atau
    // menggandakan satu huruf pun dari jawaban.
    const text = "Cold aisle 900–1.200 mm, hot aisle 600–900 mm.";
    for (const terms of [["aisle"], ["mm", "cold"], ["900"], ["tidak ada"], []]) {
      expect(
        splitHighlights(text, terms).map((p) => p.text).join(""),
        terms.join("|")
      ).toBe(text);
    }
  });
});
