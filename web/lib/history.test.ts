import { describe, expect, it } from "vitest";
import { promisedButMissing, redoReason, REDACTED, strayScript, withoutDiagrams } from "./history";

const svg = '<svg viewBox="0 0 100 60"><rect x="10" y="10" width="20" height="20"/></svg>';

describe("withoutDiagrams — hemat token tanpa mengajari model hal yang salah", () => {
  it("membuang gambar berpagar, mentah, dan yang terbungkus tool-call", () => {
    expect(withoutDiagrams(`Ini:\n\`\`\`svg\n${svg}\n\`\`\``)).toBe(`Ini:\n${REDACTED}`);
    expect(withoutDiagrams(`Ini:\n${svg}`)).toBe(`Ini:\n${REDACTED}`);
    expect(withoutDiagrams(`[TOOL_CALL] {"svg": "${svg}"} [/TOOL_CALL]`)).toBe(REDACTED);
  });

  it("membuang blok kartu juga", () => {
    // Dua belas baris berisi markup simbol adalah ribuan token yang ditagih
    // ulang di setiap pertanyaan berikutnya.
    const block = "```cards\njudul: X\nA | a | b | <circle r=\"3\"/>\n```";
    expect(withoutDiagrams(`Ini:\n${block}\n\nSelesai.`)).toBe(`Ini:\n${REDACTED}\n\nSelesai.`);
  });

  it("teks di sekeliling gambarnya tidak ikut hilang", () => {
    const kept = withoutDiagrams(`Sebelum.\n${svg}\nSesudah.`);
    expect(kept).toContain("Sebelum.");
    expect(kept).toContain("Sesudah.");
  });

  /**
   * Ini inti bug-nya, dan alasan berkas ini punya tes sendiri.
   *
   * Riwayat dikirim ulang sebagai giliran ASISTEN — contoh jawaban yang pernah
   * ditulis model sendiri. Penanda "[diagram]" di sana terbaca sebagai "begini
   * caraku menjawab permintaan gambar", dan permintaan berikutnya dijawab
   * dengan judul lalu tulisan [diagram], tanpa gambar apa pun.
   */
  it("penanda penggantinya tidak berbentuk sesuatu yang masuk akal ditiru", () => {
    const redacted = withoutDiagrams(`Diagram Satu Garis\n${svg}`);

    expect(redacted).not.toMatch(/\[diagram\]/i);
    expect(promisedButMissing(redacted)).toBe(false);
    // Panjang dan berupa kalimat: bukan penanda ringkas yang bisa disalin
    // sebagai jawaban.
    expect(REDACTED.length).toBeGreaterThan(40);
  });

  it("pertanyaan yang menyebut svg sebagai kata biasa tidak disentuh", () => {
    const text = "Formatnya svg atau png?";
    expect(withoutDiagrams(text)).toBe(text);
  });
});

describe("promisedButMissing — janji gambar yang tidak ditepati", () => {
  it("mengenali jawaban yang cuma berisi penanda", () => {
    // Persis yang dilaporkan pengguna: sebuah judul, lalu [diagram], habis.
    expect(promisedButMissing("Instalasi Transformator — Diagram Satu Garis\n\n[diagram]")).toBe(
      true
    );
    expect(promisedButMissing("[gambar: denah panel]")).toBe(true);
    expect(promisedButMissing("Berikut [Diagram SLD] untuk trafo.")).toBe(true);
  });

  it("jawaban yang benar-benar memuat gambar bukan kegagalan", () => {
    // Termasuk kalau kalimatnya kebetulan menyebut penanda: yang menentukan
    // ADA atau TIDAKNYA gambar, bukan kata-katanya.
    expect(promisedButMissing(`[diagram]\n${svg}`)).toBe(false);
    expect(promisedButMissing("[diagram]\n```cards\njudul: X\nA | a | b |\n```")).toBe(false);
  });

  it("jawaban teks biasa tidak dianggap gagal", () => {
    expect(promisedButMissing("PUIL 2011 pasal 4.3: tahanan pembumian ≤ 5 Ω.")).toBe(false);
    // Rujukan berkurung siku itu wajar dalam jawaban standar dan bukan penanda.
    expect(promisedButMissing("Lihat [IEC 60364-4-41] untuk proteksi sentuh.")).toBe(false);
  });
});

describe("strayScript — kata asing yang nyelonong ke tengah kalimat", () => {
  const ID = "berapa ukuran bonding braid untuk gondola?";

  it("menangkap yang benar-benar dilaporkan pengguna", () => {
    expect(
      strayScript("Mau saya bantu hitung количество flexible bonding braid?", ID)
    ).toBe("Sirilik");
    expect(strayScript("普通铜编织带 | 25 mm² | Alternatif", ID)).toBe("Mandarin");
  });

  it("LAMBANG SATUAN bukan kata asing", () => {
    // Yunani sengaja tidak diperiksa: Ω, μ, φ, dan Δ ada di hampir setiap
    // jawaban kelistrikan yang benar. Menandainya berarti menulis ulang
    // jawaban yang paling tepat, berkali-kali.
    expect(strayScript("Tahanan pembumian ≤ 5 Ω, kapasitor 40 μF, cos φ 0,85.", ID)).toBeNull();
    expect(strayScript("Jatuh tegangan ΔV maksimum 5%.", ID)).toBeNull();
  });

  it("huruf beraksen pada nama merek dan standar dibiarkan", () => {
    expect(strayScript("Schneider Electric, Legrand Céliane, Häfele.", ID)).toBeNull();
  });

  it("kalau yang bertanya memakai aksara itu, jawabannya bukan kesalahan", () => {
    // Yang salah cuma aksara yang muncul entah dari mana.
    expect(strayScript("количество braid: 4", "сколько количество braid?")).toBeNull();
  });

  it("jawaban Indonesia biasa tidak pernah ditandai", () => {
    expect(
      strayScript(
        "PUIL 2011 pasal 3.20: luas penampang minimum penghantar bonding 6 mm².",
        ID
      )
    ).toBeNull();
  });
});

describe("redoReason — apa yang dikirim balik ke model", () => {
  const ID = "gambarkan instalasi transformer";

  it("gambar yang cuma dijanjikan diprioritaskan", () => {
    const reason = redoReason("## Diagram Satu Garis\n\n[diagram]", ID)!;
    expect(reason).toContain("[diagram]");
  });

  it("kata asing menyebut aksaranya, supaya model tahu apa yang dicari", () => {
    const reason = redoReason("Hitung количество braid-nya.", ID)!;
    expect(reason).toContain("Sirilik");
    expect(reason).toContain("huruf Latin");
  });

  it("jawaban yang baik tidak diulang", () => {
    // Mengulang jawaban yang sudah benar berarti menggandakan waktu tunggu
    // dan biayanya tanpa memperbaiki apa pun.
    expect(redoReason("Pakai 50 mm² untuk aplikasi bergerak.", ID)).toBeNull();
    expect(redoReason('Ini gambarnya:\n<svg viewBox="0 0 10 10"></svg>', ID)).toBeNull();
  });
});
