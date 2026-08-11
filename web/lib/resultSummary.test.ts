import { describe, expect, it } from "vitest";
import id from "@/messages/id.json";
import en from "@/messages/en.json";
import { summarizeResult } from "./resultSummary";

/** `t` yang sama dengan yang dipakai halaman, supaya kunci yang belum ada ketahuan di sini. */
const translator = (dict: unknown) => (key: string) => {
  let cur: unknown = dict;
  for (const part of key.split(".")) {
    cur = typeof cur === "object" && cur !== null ? (cur as Record<string, unknown>)[part] : undefined;
  }
  return typeof cur === "string" ? cur : key;
};

const t = translator(id);
const tEn = translator(en);

describe("summarizeResult — /query", () => {
  const query = {
    what: "all",
    total: 165,
    groups: [
      { label: "lighting.title", count: 128 },
      { label: "cable_tray.title", count: 37, detail: "128.4 m" },
    ],
  };

  it("menyebut tiap kelompok beserta angkanya", () => {
    expect(summarizeResult(query, t)).toBe("Lampu: 128, Cable tray: 37 (128.4 m)");
  });

  it("menerjemahkan kunci add-in, bukan menampilkannya mentah", () => {
    // Add-in mengirim kunci milik bot Telegram. Kalau ini bocor ke layar,
    // yang dibaca orangnya adalah "lighting.title: 128".
    expect(summarizeResult(query, t)).not.toContain("lighting.title");
    expect(summarizeResult(query, tEn)).toBe("Lighting: 128, Cable tray: 37 (128.4 m)");
  });

  it("merapikan kunci yang belum punya terjemahan, bukan menyerah", () => {
    // Kategori baru di add-in tidak boleh membuat jawabannya berhenti muncul.
    const summary = summarizeResult({ groups: [{ label: "busbar_riser.title", count: 4 }] }, t);
    expect(summary).toBe("busbar riser: 4");
  });

  it("menyebut family yang disaring — tanpa itu angkanya ambigu", () => {
    // "Lampu: 6" untuk satu family terbaca persis sama dengan "Lampu: 6" untuk
    // seluruh ruangan.
    expect(
      summarizeResult(
        {
          groups: [{ label: "lighting.title", count: 6 }],
          family: "ACT_E_DOWNLIGHT 22WATT",
        },
        t
      )
    ).toBe("Lampu: 6 · ACT_E_DOWNLIGHT 22WATT");
  });

  it("memotong daftar yang kepanjangan alih-alih menumpahkan semuanya", () => {
    const groups = Array.from({ length: 10 }, (_, i) => ({ label: `x${i}`, count: i }));
    const summary = summarizeResult({ groups }, t);
    expect(summary).toContain("+4");
    expect(summary).not.toContain("x6");
  });
});

describe("summarizeResult — /inspect", () => {
  it("kategori: berapa banyak, lalu yang teratas", () => {
    const summary = summarizeResult(
      {
        categories: [
          { name: "Doors", count: 120 },
          { name: "Walls", count: 88 },
        ],
      },
      t
    );
    expect(summary).toBe("2 kategori — Doors 120, Walls 88");
  });

  it("parameter: jumlahnya saja — nama parameter ada di tabel di bawah", () => {
    expect(summarizeResult({ parameters: [{ name: "Width" }, { name: "Height" }] }, t)).toBe(
      "2 parameter"
    );
  });

  it("elemen: totalnya lebih dulu, karena itu yang ditanyakan", () => {
    const summary = summarizeResult(
      {
        total: 42,
        shown: 42,
        rows: [{ Id: "1" }],
        totals: [{ parameter: "Width", sum: 37800.0000001, unit: "mm", counted: 42, missing: 0 }],
      },
      t
    );
    expect(summary).toBe("Width: 37800 mm, 42 baris");
  });

  it("mengatakan kalau yang tampil hanya sebagian", () => {
    const summary = summarizeResult({ total: 900, shown: 200, rows: [], groups: [] }, t);
    expect(summary).toBe("900 baris (200 ditampilkan)");
  });

  it("menyebut kelompok teratas, dibatasi tiga", () => {
    const summary = summarizeResult(
      {
        total: 10,
        shown: 10,
        rows: [],
        groups: [
          { value: "L1", count: 5 },
          { value: "L2", count: 3 },
          { value: "L3", count: 1 },
          { value: "L4", count: 1 },
        ],
      },
      t
    );
    expect(summary).toBe("10 baris, L1 5, L2 3, L3 1");
    expect(summary).not.toContain("L4");
  });

  it("membulatkan angka yang panjangnya cuma sisa pembagian biner", () => {
    const summary = summarizeResult(
      { total: 1, shown: 1, rows: [], totals: [{ parameter: "P", sum: 128.40000000000001, unit: "m" }] },
      t
    );
    expect(summary).toContain("128.4 m");
  });
});

describe("summarizeResult — perintah yang mengubah model", () => {
  it("menyebut jumlah, ruangan, dan family yang benar-benar dipakai", () => {
    // Family-nya disebut karena persis di situ sistem ini pernah diam-diam
    // salah: yang diminta satu family, yang terpasang family lain.
    expect(
      summarizeResult(
        { devices_placed: 6, room: "LOUNGE 5", family_used: "ACT_E_DOWNLIGHT 22WATT : DOWNLIGHT 22 WATT" },
        t
      )
    ).toBe("6 perangkat dipasang · ruangan LOUNGE 5 · ACT_E_DOWNLIGHT 22WATT : DOWNLIGHT 22 WATT");
  });

  it("nol tetap dilaporkan — itu jawaban, bukan ketiadaan jawaban", () => {
    expect(summarizeResult({ devices_placed: 0 }, t)).toBe("0 perangkat dipasang");
  });

  it("menandai uji coba di depan, sebelum angkanya terbaca", () => {
    const summary = summarizeResult({ dry_run: true, devices_placed: 6, room: "PANTRY" }, t);
    expect(summary.startsWith("Uji coba: ")).toBe(true);
  });

  it("penghapusan", () => {
    expect(summarizeResult({ devices_removed: 4, room: "PANTRY" }, t)).toBe(
      "4 perangkat dihapus · PANTRY"
    );
  });

  it("import tabel: nama view-nya, karena itu yang harus dibuka orangnya", () => {
    expect(summarizeResult({ view: "DAFTAR PANEL", rows: 42, columns: 6 }, t)).toBe(
      "View: DAFTAR PANEL — 42×6"
    );
  });
});

describe("summarizeResult — diam kalau memang tidak ada yang bisa dipendekkan", () => {
  it("bentuk yang tidak dikenali tidak dikarang", () => {
    for (const value of [null, undefined, "selesai", 7, [], {}, { ok: true }]) {
      expect(summarizeResult(value, t), JSON.stringify(value) ?? "undefined").toBe("");
    }
  });

  it("hasil kosong tidak jadi kalimat kosong yang menyesatkan", () => {
    expect(summarizeResult({ groups: [] }, t)).toBe("");
    expect(summarizeResult({ categories: [] }, t)).toBe("");
  });
});
