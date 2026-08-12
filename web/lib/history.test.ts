import { describe, expect, it } from "vitest";
import { fitHistory, promisedButMissing, redoReason, scrubLeaks, strayScript } from "./history";

const svg = '<svg viewBox="0 0 100 60"><rect x="10" y="10" width="20" height="20"/></svg>';

describe("scrubLeaks — sisa penanda buatan kami sendiri", () => {
  /**
   * Ini akar dari dua bug berturut-turut.
   *
   * Riwayat dikirim ulang sebagai giliran ASISTEN — contoh jawaban yang seolah
   * pernah ditulis model sendiri. Mula-mula penandanya "[diagram]", dan model
   * menjawab permintaan gambar dengan menulis [diagram]. Penandanya diganti
   * kalimat panjang yang "tidak mungkin ditiru", dan kalimat itu pun muncul di
   * layar kata demi kata, di bawah judul yang menjanjikan gambar.
   *
   * Sekarang tidak ada yang disisipkan sama sekali. Yang ini menyapu sisa yang
   * telanjur tersimpan di jawaban lama.
   */
  it("membuang kalimat catatan sistem yang telanjur tersalin", () => {
    const stored =
      "Diagram Instalasi Penangkal Petir di Gondola\n\n" +
      "(catatan sistem: gambar pada jawaban ini sudah tampil di layar pengguna dan " +
      "dihilangkan dari riwayat untuk menghemat token)";

    expect(scrubLeaks(stored)).toBe("Diagram Instalasi Penangkal Petir di Gondola");
  });

  it("membuang penanda [diagram] yang berdiri sendiri", () => {
    expect(scrubLeaks("Judulnya\n\n[diagram]\n")).toBe("Judulnya");
  });

  it("jawaban yang wajar tidak disentuh", () => {
    const answer = "PUIL 2011 pasal 4.3 mensyaratkan tahanan pembumian <= 5 Ohm.";
    expect(scrubLeaks(answer)).toBe(answer);
  });

  it("gambar di dalam riwayat DIPERTAHANKAN", () => {
    // Inti perubahannya: tagihan dihitung per permintaan, bukan per token, jadi
    // membuang gambar dari riwayat tidak pernah menghemat apa pun — dan
    // penanda yang ditinggalkannya dua kali membuat model berhenti menggambar.
    const answer = 'Ini gambarnya:\n<svg viewBox="0 0 100 60"><rect/></svg>';
    expect(scrubLeaks(answer)).toBe(answer);
  });
});

describe("fitHistory — jaring pengaman, bukan penghematan", () => {
  it("riwayat wajar tidak disentuh sama sekali", () => {
    const turns = [{ text: "a" }, { text: "b" }, { text: "c" }];
    expect(fitHistory(turns)).toEqual(turns);
  });

  it("yang benar-benar raksasa kehilangan giliran PALING LAMA, utuh", () => {
    // Dibuang per giliran, bukan dipotong isinya: memotong isi berarti menaruh
    // penanda di tempatnya, dan penanda di riwayat persis yang baru dicabut.
    const turns = [
      { text: "x".repeat(150_000) },
      { text: "y".repeat(150_000) },
      { text: "z" },
    ];
    const kept = fitHistory(turns);

    expect(kept).toHaveLength(2);
    expect(kept[0].text[0]).toBe("y");
  });
});

describe("promisedButMissing — janji gambar yang tidak ditepati", () => {
  it("mengenali jawaban yang cuma berisi penanda", () => {
    // Persis yang dilaporkan pengguna: sebuah judul, lalu [diagram], habis.
    expect(promisedButMissing("Instalasi Transformator — Diagram Satu Garis\n\n[diagram]")).toBe(
      true
    );
    expect(promisedButMissing("[gambar: denah panel]")).toBe(true);
  });

  /**
   * Ini yang membuat jawaban ditulis dua kali di layar.
   *
   * Versi pertama pemeriksaan ini mencari penanda DI MANA PUN, dan empat dari
   * lima jawaban biasa ikut ditulis ulang — termasuk jawaban yang menyebut
   * aturannya sendiri, karena sistem prompt memuat kata "[diagram]" secara
   * harfiah dan model mengutipnya kembali. Yang terlihat pengguna: jawaban
   * selesai, hilang, lalu kembali hampir sama.
   */
  it("penanda di TENGAH kalimat bukan kegagalan", () => {
    expect(promisedButMissing("Seperti pada [Gambar 1], jaraknya 1,5 m.")).toBe(false);
    expect(promisedButMissing("Berikut [Diagram SLD] untuk trafo.")).toBe(false);
    expect(promisedButMissing("Bagian: [Diagram Satu Garis], [Tabel Beban].")).toBe(false);
    expect(
      promisedButMissing("Saya tidak pernah menulis penanda [diagram] tanpa gambarnya.")
    ).toBe(false);
  });

  it("tautan markdown bukan penanda", () => {
    expect(promisedButMissing("[gambar teknis](https://contoh.id/a.png)")).toBe(false);
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

  it("kalimat catatan sistem yang tersalin ke jawaban ditangkap", () => {
    // Jaring terakhir. Sumbernya sudah dicabut dan sisanya disapu saat riwayat
    // dibaca, jadi kalau ini sampai menangkap sesuatu, log-nya yang memberi
    // tahu — bukan pengguna yang menemukannya di layar.
    const redo = redoReason(
      "Diagram Penangkal Petir\n\n(catatan sistem: gambar pada jawaban ini sudah tampil)",
      ID
    )!;
    expect(redo.instruction).toContain("catatan sistem");
    expect(redo.notice).toContain("catatan internal");
  });

  it("gambar yang cuma dijanjikan diprioritaskan", () => {
    const redo = redoReason("## Diagram Satu Garis\n\n[diagram]", ID)!;
    expect(redo.instruction).toContain("[diagram]");
  });

  it("kata asing menyebut aksaranya, supaya model tahu apa yang dicari", () => {
    const redo = redoReason("Hitung количество braid-nya.", ID)!;
    expect(redo.instruction).toContain("Sirilik");
    expect(redo.instruction).toContain("huruf Latin");
    // Pengguna diberi tahu juga, dengan kalimat pendek — bukan dibiarkan
    // menebak kenapa jawabannya ditulis dua kali.
    expect(redo.notice).toContain("Sirilik");
  });

  it("satu huruf asing saja tidak cukup untuk menulis ulang", () => {
    // Menulis ulang seluruh jawaban karena satu karakter berarti pengguna
    // menonton jawabannya dihapus tanpa alasan yang bisa ia lihat.
    expect(redoReason("Ukuran tray 100 mm 一 sesuai SNI.", ID)).toBeNull();
  });

  it("jawaban yang baik tidak diulang", () => {
    // Mengulang jawaban yang sudah benar berarti menggandakan waktu tunggu
    // dan biayanya tanpa memperbaiki apa pun.
    expect(redoReason("Pakai 50 mm² untuk aplikasi bergerak.", ID)).toBeNull();
    expect(redoReason('Ini gambarnya:\n<svg viewBox="0 0 10 10"></svg>', ID)).toBeNull();
  });
});
