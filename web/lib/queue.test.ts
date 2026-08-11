import { describe, expect, it, vi } from "vitest";
import { CommandValidationError, buildPayload, enqueueCommand } from "./queue";
import { COMMANDS_BY_NAME, type CommandSpec } from "./commands";

// Validasi di file ini adalah satu-satunya yang berdiri antara sebuah kalimat
// dan sesuatu yang benar-benar berubah di model Revit orang lain. Yang diuji
// adalah spesifikasi command yang asli, bukan spec buatan — kalau katalognya
// berubah sampai aturan ini tidak berlaku lagi, tesnya harus ikut gagal.

const spec = (name: string): CommandSpec => {
  const found = COMMANDS_BY_NAME[name];
  if (!found) throw new Error(`spec ${name} tidak ada di katalog`);
  return found;
};

/** Kumpulan pesan dari satu percobaan yang diharapkan gagal. */
function issuesOf(name: string, values: Record<string, unknown>): string[] {
  try {
    buildPayload(spec(name), values);
  } catch (err) {
    if (err instanceof CommandValidationError) return err.issues;
    throw err;
  }
  throw new Error("buildPayload berhasil padahal seharusnya gagal");
}

describe("buildPayload — angka", () => {
  it("menerima angka yang dikirim sebagai teks", () => {
    const { payload } = buildPayload(spec("place_lighting"), { room: "Meeting 1", count: "12" });
    expect(payload.count).toBe(12);
  });

  it("menolak bilangan pecahan pada field integer", () => {
    expect(issuesOf("place_lighting", { room: "Meeting 1", count: "3.5" })).toEqual([
      "count harus bilangan bulat",
    ]);
  });

  it("menolak yang bukan angka", () => {
    expect(issuesOf("place_lighting", { room: "Meeting 1", count: "dua belas" })).toEqual([
      "count harus berupa angka",
    ]);
  });

  it("menegakkan batas bawah dan batas atas", () => {
    expect(issuesOf("place_lighting", { room: "Meeting 1", count: 0 })).toEqual(["count minimal 1"]);
    expect(issuesOf("place_lighting", { room: "Meeting 1", count: 501 })).toEqual([
      "count maksimal 500",
    ]);
  });

  it("memperlakukan 0 sebagai nilai, bukan sebagai kosong", () => {
    // height boleh 0; kalau 0 dianggap kosong, nilainya diam-diam hilang dan
    // add-in memakai defaultnya — bukan yang diminta orangnya.
    const { payload } = buildPayload(spec("place_lighting"), { room: "Meeting 1", height: 0 });
    expect(payload.height).toBe(0);
  });
});

describe("buildPayload — tipe lain", () => {
  it("membaca boolean dalam bahasa Indonesia maupun Inggris", () => {
    for (const raw of [true, "true", "ya", "yes", "1"]) {
      const { payload } = buildPayload(spec("import_excel"), {
        file_url: "https://example.com/a.xlsx",
        dry_run: raw,
      });
      expect(payload.dry_run, `nilai ${JSON.stringify(raw)}`).toBe(true);
    }

    for (const raw of [false, "false", "tidak", "no"]) {
      const { payload } = buildPayload(spec("import_excel"), {
        file_url: "https://example.com/a.xlsx",
        dry_run: raw,
      });
      expect(payload.dry_run, `nilai ${JSON.stringify(raw)}`).toBe(false);
    }
  });

  it("menolak pilihan di luar daftar options", () => {
    const issues = issuesOf("query", { what: "kabel" });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/^what harus salah satu dari: all, lighting/);
  });

  it("merapikan grid dan menolak bentuk yang salah", () => {
    const { payload } = buildPayload(spec("place_lighting"), { room: "Meeting 1", grid: " 3 X 2 " });
    expect(payload.grid).toBe("3x2");

    expect(issuesOf("place_lighting", { room: "Meeting 1", grid: "3-2" })).toEqual([
      "grid harus berbentuk kolomXbaris, mis. 3x2",
    ]);
  });

  it("memangkas spasi di ujung field teks", () => {
    const { payload } = buildPayload(spec("place_lighting"), { room: "  Meeting 1  " });
    expect(payload.room).toBe("Meeting 1");
  });
});

describe("buildPayload — field wajib", () => {
  it("menganggap string kosong sama dengan tidak diisi", () => {
    expect(issuesOf("place_lighting", { room: "" })).toEqual(["room wajib diisi"]);
  });

  it("melaporkan semua masalah sekaligus, bukan satu per satu", () => {
    // Perilaku ini disengaja (lihat bagian Errors di COMMANDS.md): mengisi form
    // lalu ditolak satu kesalahan per kali adalah pekerjaan yang tidak perlu.
    const issues = issuesOf("place_lighting", { room: "", count: "x", grid: "nope" });
    expect(issues).toHaveLength(3);
    expect(issues).toContain("room wajib diisi");
    expect(issues).toContain("count harus berupa angka");
  });

  it("membiarkan field opsional yang kosong tidak ikut ke payload", () => {
    const { payload } = buildPayload(spec("place_lighting"), { room: "Meeting 1" });
    expect(payload).toEqual({ room: "Meeting 1" });
  });
});

describe("buildPayload — aturan antar-field", () => {
  it("create_cable_tray butuh follow, atau from dan to sekaligus", () => {
    expect(issuesOf("create_cable_tray", { tray_id: "CT-A1" })).toContain(
      "isi `follow`, atau `from` dan `to` sekaligus"
    );
    expect(issuesOf("create_cable_tray", { tray_id: "CT-A1", from: "PA-01" })).toContain(
      "isi `follow`, atau `from` dan `to` sekaligus"
    );

    expect(() =>
      buildPayload(spec("create_cable_tray"), { tray_id: "CT-A1", follow: "Thin Lines" })
    ).not.toThrow();
    expect(() =>
      buildPayload(spec("create_cable_tray"), { tray_id: "CT-A1", from: "PA-01", to: "Zone_A" })
    ).not.toThrow();
  });

  it("modify_devices butuh salah satu dari count atau grid", () => {
    expect(issuesOf("modify_devices", { room: "Meeting 1" })).toContain(
      "isi salah satu: jumlah baru atau grid baru"
    );

    expect(() =>
      buildPayload(spec("modify_devices"), { room: "Meeting 1", grid: "2x3" })
    ).not.toThrow();
  });
});

describe("buildPayload — grid diturunkan dari jumlah", () => {
  // Ini aturan yang menentukan gambarnya benar atau tidak. "10 lampu" tanpa grid
  // membuat add-in mencari grid yang CUKUP memuat sepuluh — 4x3, dua belas titik,
  // dua lubang di deret terakhir. Sepuluh punya jawaban tepat: 5x2.
  it("mengisi grid yang memuat persis sejumlah titiknya", () => {
    const cases: [number, string][] = [
      [10, "5x2"],
      [9, "3x3"],
      [6, "3x2"],
      [12, "4x3"],
      [8, "4x2"],
      [4, "2x2"],
      [1, "1x1"],
    ];

    for (const [count, grid] of cases) {
      const { payload } = buildPayload(spec("place_lighting"), { room: "Lounge", count });
      expect(payload.grid, `jumlah ${count}`).toBe(grid);
    }
  });

  it("ikut berlaku untuk modify_devices, yang punya kolom grid yang sama", () => {
    const { payload, commandText } = buildPayload(spec("modify_devices"), {
      room: "Lounge",
      what: "lighting",
      count: 10,
    });
    expect(payload.grid).toBe("5x2");
    // Terlihat di teks perintahnya, jadi yang dikirim tetap bisa dibaca.
    expect(commandText).toContain("grid=5x2");
  });

  it("tidak menyentuh grid yang memang disebut orangnya", () => {
    const { payload } = buildPayload(spec("place_lighting"), {
      room: "Lounge",
      count: 10,
      grid: "2x5",
    });
    expect(payload.grid).toBe("2x5");
  });

  it("menolak grid yang tidak memuat jumlahnya, dan menyebutkan yang benar", () => {
    const issues = issuesOf("place_lighting", { room: "Lounge", count: 10, grid: "3x3" });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("memuat 9 titik");
    expect(issues[0]).toContain("5x2");
  });

  it("tidak mengarang grid untuk perintah yang tidak punya kolomnya", () => {
    const { payload } = buildPayload(spec("place_receptacle"), { room: "Lounge", count: 10 });
    expect(payload).not.toHaveProperty("grid");
  });
});

describe("buildPayload — command_text", () => {
  it("menaruh argumen posisional lebih dulu, lalu pasangan kunci=nilai", () => {
    const { commandText } = buildPayload(spec("modify_devices"), {
      room: "Meeting_1",
      what: "lighting",
      grid: "2x3",
    });
    expect(commandText).toBe("/modify_devices Meeting_1 what=lighting grid=2x3");
  });

  it("mengapit nilai yang mengandung spasi dengan tanda kutip", () => {
    const { commandText } = buildPayload(spec("create_cable_tray"), {
      tray_id: "CT-A1",
      follow: "Thin Lines",
    });
    expect(commandText).toContain('follow="Thin Lines"');
  });

  it("tidak menyisakan spasi ganda saat tidak ada field selain posisional", () => {
    const { commandText } = buildPayload(spec("place_lighting"), { room: "Meeting1" });
    expect(commandText).toBe("/place_lighting Meeting1");
  });

  it("mengapit nama ruangan bersepasi, sama seperti argumen bernama", () => {
    // Setiap ruangan bernomor di gambar ini bersepasi ("LOUNGE 5"), dan tanpa
    // kutip teks ini terbaca sebagai ruangan "LOUNGE" dengan sebuah "5" yang
    // menggantung. command_json-nya memang selalu benar; yang dibaca orang di
    // Riwayat dan disalin ulang ke Telegram adalah teks ini.
    const { commandText } = buildPayload(spec("delete_devices"), {
      room: "LOUNGE 5",
      what: "lighting",
    });
    expect(commandText).toBe('/delete_devices "LOUNGE 5" what=lighting');
  });
});

describe("enqueueCommand", () => {
  /** Klien Supabase palsu yang cukup untuk `.from().insert().select().single()`. */
  function fakeSupabase(insert = vi.fn()) {
    const single = vi.fn().mockResolvedValue({ data: { id: "row-1" }, error: null });
    const client = {
      from: vi.fn().mockReturnValue({
        insert: insert.mockReturnValue({ select: vi.fn().mockReturnValue({ single }) }),
      }),
    };
    return { client: client as never, insert };
  }

  const base = {
    userId: "user-1",
    projectId: "project-1",
    values: { room: "Meeting 1" },
  };

  it("menolak command yang tidak ada di katalog", async () => {
    const { client } = fakeSupabase();
    await expect(
      enqueueCommand({ ...base, supabase: client, role: "admin", commandName: "rm_rf" })
    ).rejects.toThrow(CommandValidationError);
  });

  it("menolak peran yang tidak cukup, tanpa menyentuh database", async () => {
    const { client, insert } = fakeSupabase();
    await expect(
      enqueueCommand({ ...base, supabase: client, role: "viewer", commandName: "place_lighting" })
    ).rejects.toThrow(/peran viewer tidak boleh menjalankan \/place_lighting/);
    expect(insert).not.toHaveBeenCalled();
  });

  it("menulis baris pending tanpa chat_id dan mengembalikan id-nya", async () => {
    const { client, insert } = fakeSupabase();
    const result = await enqueueCommand({
      ...base,
      supabase: client,
      role: "editor",
      commandName: "place_lighting",
    });

    expect(result).toEqual({ id: "row-1", commandText: '/place_lighting "Meeting 1"' });

    const row = insert.mock.calls[0][0];
    expect(row).toMatchObject({
      user_id: "user-1",
      project_id: "project-1",
      command_type: "place_lighting",
      status: "pending",
    });
    // chat_id yang null adalah penanda "berasal dari website"; kalau ia terisi,
    // hasilnya ikut terkirim ke chat Telegram orang lain.
    expect(row).not.toHaveProperty("chat_id");
  });

  it("tidak menulis apa pun kalau validasinya gagal", async () => {
    const { client, insert } = fakeSupabase();
    await expect(
      enqueueCommand({
        ...base,
        values: {},
        supabase: client,
        role: "editor",
        commandName: "place_lighting",
      })
    ).rejects.toThrow(CommandValidationError);
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("buildPayload — nama family", () => {
  // model_info melaporkan tipe dalam bentuk tampilan Revit, `Family: Type`, dan
  // itulah yang disalin asisten ke argumennya. Perintahnya berjalan tanpa galat,
  // melaporkan sepuluh armatur terpasang — dan yang terpasang adalah family
  // bawaan add-in, bukan yang diminta. Dinormalkan di sini, bukan di form, supaya
  // perintah dari percakapan ikut terkena.
  it("mengirim nama family saja, bukan bentuk tampilan Revit", () => {
    const { payload, commandText } = buildPayload(spec("place_lighting"), {
      room: "LOUNGE 5",
      count: 10,
      fixture_type: "ACT_E_DOWNLIGHT 22WATT: DOWNLIGHT 22 WATT",
    });

    expect(payload.fixture_type).toBe("ACT_E_DOWNLIGHT 22WATT");
    expect(commandText).toContain('fixture_type="ACT_E_DOWNLIGHT 22WATT"');
    expect(commandText).not.toContain("DOWNLIGHT 22 WATT\"");
  });

  it("berlaku untuk kolom family di setiap perintah perangkat", () => {
    const { payload } = buildPayload(spec("place_receptacle"), {
      room: "Office A",
      count: 4,
      family: "ACT_E_SOCKET: SOCKET 2P+E",
    });
    expect(payload.family).toBe("ACT_E_SOCKET");
  });

  it("berlaku untuk modify_devices, yang kategorinya ikut kolom what", () => {
    const { payload } = buildPayload(spec("modify_devices"), {
      room: "Lounge",
      what: "lighting",
      count: 6,
      fixture_type: "ACT_E_DOWNLIGHT 22WATT: DOWNLIGHT 22 WATT",
    });
    expect(payload.fixture_type).toBe("ACT_E_DOWNLIGHT 22WATT");
  });

  it("tidak menyentuh kolom lain yang kebetulan mengandung titik dua", () => {
    const { payload } = buildPayload(spec("create_cable_tray"), {
      tray_id: "CT-A1",
      follow: "Thin Lines: A",
    });
    expect(payload.follow).toBe("Thin Lines: A");
  });
});
