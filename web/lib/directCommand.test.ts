import { describe, expect, it } from "vitest";
import { directCommand } from "./directCommand";

/**
 * Parser ini ada karena mode chat pernah berhenti bekerja seluruhnya untuk
 * kalimat yang paling jelas yang bisa diketik orang — balasan teks berkali-kali
 * berturut-turut, tanpa satu pun perintah berangkat.
 *
 * Yang diuji di sini dua hal, dan yang kedua lebih penting: bahwa ia membaca
 * kalimat yang memang lugas, DAN bahwa ia menolak menjawab untuk apa pun yang
 * tidak ia yakini. Parser yang memaksakan diri mengirim perintah yang salah ke
 * model Revit orang, dan itu jauh lebih mahal daripada satu panggilan API.
 */

const ctx = {
  rooms: ["MEETING 1", "MEETING 2", "RECEPTIONIST 12", "LOUNGE 5", "OFFICE", "PANTRY"],
  familyTypes: {
    lighting: [
      "ACT_E_DOWNLIGHT 22WATT: DOWNLIGHT 22 WATT",
      "ACT_E_LIGHTING RECESSED: RECESSED 600x600",
    ],
  },
};

describe("directCommand — kalimat yang dilaporkan pengguna", () => {
  it("pasang lampu recessed di meeting 2 5x3 tinggi 3 meter", () => {
    const out = directCommand("pasang lampu recessed di meeting 2 5x3 tinggi 3 meter", "editor", ctx);

    expect(out?.spec.name).toBe("place_lighting");
    expect(out?.values).toMatchObject({
      room: "MEETING 2",
      grid: "5x3",
      height: 3,
      // "recessed" DICARI di daftar family model, bukan diterka.
      fixture_type: "ACT_E_LIGHTING RECESSED",
    });
    // Grid sudah menyatakan jumlahnya; keduanya sekaligus bisa bertentangan.
    expect(out?.values).not.toHaveProperty("count");
  });

  it("pasang lampu 5x3 downlight di meeting 1 tinggi 3 meter", () => {
    const out = directCommand("pasang lampu 5x3 downlight di meeting 1 tinggi 3 meter", "editor", ctx);

    expect(out?.spec.name).toBe("place_lighting");
    expect(out?.values).toMatchObject({
      room: "MEETING 1",
      grid: "5x3",
      height: 3,
      fixture_type: "ACT_E_DOWNLIGHT 22WATT",
    });
  });

  it("kata kerja yang menentukan perintahnya, bukan terkaan isi ruangan", () => {
    const out = directCommand("modifikasi lampu downlight 3x2 di receptionist 12", "editor", ctx);

    expect(out?.spec.name).toBe("modify_devices");
    expect(out?.values).toMatchObject({ room: "RECEPTIONIST 12", what: "lighting", grid: "3x2" });
  });

  it("jumlah dibaca kalau gridnya tidak disebut", () => {
    const out = directCommand("pasang 6 lampu di Meeting 1 tinggi 3 meter", "editor", ctx);
    expect(out?.values).toMatchObject({ room: "MEETING 1", count: 6, height: 3 });
  });

  it("ruangan terpanjang yang menang", () => {
    // "MEETING 1" cocok untuk kalimat yang menyebut "MEETING 12" juga; yang
    // pertama cocok bukan yang benar.
    const out = directCommand("pasang lampu di receptionist 12", "editor", ctx);
    expect(out?.values.room).toBe("RECEPTIONIST 12");
  });
});

describe("directCommand — yang TIDAK dijawabnya", () => {
  const nulls: [string, string][] = [
    ["pertanyaan", "di meeting 2 ada berapa lampu?"],
    ["kalimat bersyarat", "pasang lampu di meeting 2 kalau belum ada"],
    ["negasi", "pasang lampu di meeting 2 jangan yang downlight"],
    ["ruangan tidak ada di model", "pasang lampu di gudang bawah tanah"],
    ["tanpa kategori", "pasang sesuatu di meeting 2"],
    ["tanpa kata kerja", "lampu 5x3 di meeting 2"],
    ["dua kata kerja sekaligus", "ganti dan pasang lampu di meeting 2"],
  ];

  for (const [why, line] of nulls) {
    it(`${why}: "${line}"`, () => {
      expect(directCommand(line, "editor", ctx)).toBeNull();
    });
  }

  it("tanpa daftar ruangan dari Revit, tidak menjawab sama sekali", () => {
    // Nama ruangan tidak pernah diterka dari prosa. Tanpa daftar yang dilaporkan
    // add-in, perintah ini bisa berangkat ke ruangan yang salah.
    expect(directCommand("pasang lampu di meeting 2 5x3", "editor", {})).toBeNull();
  });

  it("peran yang tidak boleh menjalankannya tidak dilayani", () => {
    expect(directCommand("pasang lampu di meeting 2 5x3", "viewer", ctx)).toBeNull();
  });

  it("family yang tidak menunjuk satu pun dibiarkan kosong, bukan ditebak", () => {
    // Add-in yang menerima nama yang tidak ada menolak perintahnya sambil
    // menyebut family apa saja yang ada — jauh lebih baik daripada tebakan.
    const out = directCommand("pasang lampu di meeting 2 5x3", "editor", ctx);
    expect(out?.values).not.toHaveProperty("fixture_type");
  });
});
