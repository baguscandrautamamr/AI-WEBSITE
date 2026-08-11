import { describe, expect, it } from "vitest";
import {
  ELECTRICAL_SYSTEM_PROMPT,
  mentionsCommand,
  toolsForRole,
  withModelContext,
} from "./aiTools";

describe("mentionsCommand", () => {
  // Ini penjaga terhadap satu bentuk kegagalan yang terlihat persis seperti
  // keberhasilan: jawaban berupa teks `/place_lighting …` plus kalimat "sudah
  // dikirim ke antrean Revit", tanpa satu pun tool dipanggil — jadi tidak ada
  // baris di commands_queue, tidak ada apa pun di Revit, dan yang dibaca orangnya
  // adalah pernyataan bahwa perintahnya sudah berangkat.
  it("mengenali jawaban yang menuliskan perintah alih-alih memanggilnya", () => {
    expect(
      mentionsCommand(
        '/place_lighting LOUNGE 5 count=10 height=3 fixture_type="ACT_E_DOWNLIGHT 22WATT" Perintah ini dikirim ke antrean Revit.'
      )
    ).toBe(true);
    expect(mentionsCommand("Saya kirim `/modify_devices Lounge grid=2x5` sekarang.")).toBe(true);
    expect(mentionsCommand("/delete_devices Pantry what=lighting")).toBe(true);
  });

  it("tidak menyeret pertanyaan klarifikasi yang wajar", () => {
    // Kalau ini ikut terdeteksi, giliran berikutnya dipaksa memanggil tool — dan
    // tool yang dipanggil di tengah pertanyaan memasang perangkat dengan angka
    // yang belum pernah disebut siapa pun.
    for (const text of [
      "Baik, 6 lampu di Meeting 2 sudah saya catat. Tingginya berapa meter?",
      "Mau saya kirim sekarang, atau tunggu tingginya disebut dulu?",
      "Ruangan mana? Model punya MEETING 1 dan MEETING 2.",
      "Itu ada di halaman Standar Electrical.",
      "",
    ]) {
      expect(mentionsCommand(text), text).toBe(false);
    }
  });

  it("tidak tertipu nama yang cuma mirip", () => {
    expect(mentionsCommand("path/place_lighting_helper.cs")).toBe(false);
    expect(mentionsCommand("/place_lightingxyz")).toBe(false);
  });
});

describe("toolsForRole", () => {
  it("viewer tidak pernah ditawari perintah yang mengubah model", () => {
    const names = toolsForRole("viewer").map((tool) => tool.name);
    expect(names).toContain("query");
    expect(names).not.toContain("place_lighting");
    expect(names).not.toContain("delete_devices");
  });

  it("editor mendapat perintah perangkat, tanpa yang tersembunyi", () => {
    const names = toolsForRole("editor").map((tool) => tool.name);
    expect(names).toContain("place_lighting");
    expect(names).toContain("modify_devices");
    // Argumennya URL berkas yang baru ada setelah unggahan; model tidak mungkin
    // mengisinya.
    expect(names).not.toContain("import_excel");
  });

  it("tidak menawarkan enum kosong, yang tidak bisa dipenuhi apa pun", () => {
    for (const tool of toolsForRole("admin")) {
      for (const [name, prop] of Object.entries(tool.input_schema.properties)) {
        if (prop.enum) {
          expect(prop.enum.length, `${tool.name}.${name}`).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("ELECTRICAL_SYSTEM_PROMPT", () => {
  it("menyatakan bahwa menulis teks tidak mengirim apa pun", () => {
    expect(ELECTRICAL_SYSTEM_PROMPT).toMatch(/TIDAK mengirim apa pun/);
  });

  it("menyuruh memakai modify_devices untuk ruangan yang sudah berisi", () => {
    expect(ELECTRICAL_SYSTEM_PROMPT).toContain("modify_devices");
  });

  it("menyuruh membiarkan grid kosong kalau yang disebut adalah jumlah", () => {
    expect(ELECTRICAL_SYSTEM_PROMPT).toMatch(/biarkan .*grid.* kosong/i);
  });
});

describe("withModelContext", () => {
  // Daftar inilah yang disalin model ke argumennya. Kalau ia memuat bentuk
  // tampilan Revit (`Family: Type`), perintahnya berangkat membawa nilai yang
  // tidak cocok dengan apa pun — dan add-in memasang family bawaannya sendiri
  // tanpa satu pun galat muncul.
  it("menyebut nama family, bukan bentuk tampilan Revit", () => {
    const prompt = withModelContext(ELECTRICAL_SYSTEM_PROMPT, {
      familyTypes: {
        "Lighting Fixtures": [
          "ACT_E_DOWNLIGHT 22WATT: DOWNLIGHT 22 WATT",
          "ACT_E_DOWNLIGHT 22WATT: DOWNLIGHT 18 WATT",
        ],
      },
      rooms: ["LOUNGE 5"],
    });

    expect(prompt).toContain("ACT_E_DOWNLIGHT 22WATT");
    expect(prompt).not.toContain("DOWNLIGHT 22 WATT");
    // Satu family, satu kali — dua tipe di dalamnya bukan dua pilihan.
    expect(prompt.match(/ACT_E_DOWNLIGHT 22WATT/g)).toHaveLength(1);
  });

  it("menyebut ruangan yang ada di model", () => {
    const prompt = withModelContext(ELECTRICAL_SYSTEM_PROMPT, { rooms: ["LOUNGE 5", "PANTRY"] });
    expect(prompt).toContain("LOUNGE 5 | PANTRY");
  });

  it("tidak menambah apa pun kalau modelnya belum dibaca", () => {
    expect(withModelContext(ELECTRICAL_SYSTEM_PROMPT, undefined)).toBe(ELECTRICAL_SYSTEM_PROMPT);
    expect(withModelContext(ELECTRICAL_SYSTEM_PROMPT, { familyTypes: {}, rooms: [] })).toBe(
      ELECTRICAL_SYSTEM_PROMPT
    );
  });
});

describe("katalog inspect — jalan menuju \"baca apa pun\"", () => {
  const inspect = () => {
    const tool = toolsForRole("viewer").find((t) => t.name === "inspect");
    if (!tool) throw new Error("inspect tidak ditawarkan ke viewer");
    return tool;
  };

  it("ditawarkan ke viewer: ia tidak membuka transaksi Revit", () => {
    expect(inspect()).toBeTruthy();
  });

  it("punya ketiga modenya", () => {
    expect(inspect().input_schema.properties.what.enum).toEqual([
      "categories",
      "parameters",
      "elements",
    ]);
  });

  it("menawarkan penjumlahan, penyaringan, dan pengelompokan", () => {
    const properties = inspect().input_schema.properties;
    for (const name of ["category", "params", "where", "total", "group_by", "limit"]) {
      expect(properties[name], name).toBeTruthy();
    }
  });

  it("prompt menyuruh menemukan nama parameter, bukan menebaknya", () => {
    // Kolom yang namanya salah kembali KOSONG, dan kosong tidak bisa dibedakan
    // dari model yang memang tidak punya nilainya.
    expect(ELECTRICAL_SYSTEM_PROMPT).toMatch(/what=categories/);
    expect(ELECTRICAL_SYSTEM_PROMPT).toMatch(/Jangan menebak nama parameter/);
  });

  it("prompt menyebut bahwa query sudah melaporkan panjang, watt, dan luas", () => {
    // Sebabnya nyata: asisten pernah menjawab "tidak ada tool untuk mengukur
    // panjang tray" untuk angka yang sudah dilaporkan add-in bertahun-tahun.
    expect(ELECTRICAL_SYSTEM_PROMPT).toMatch(/total meter/);
    expect(ELECTRICAL_SYSTEM_PROMPT).toMatch(/Jangan bilang tidak ada caranya/);
  });
});
