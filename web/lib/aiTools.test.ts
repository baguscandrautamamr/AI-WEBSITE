import { describe, expect, it } from "vitest";
import {
  ELECTRICAL_SYSTEM_PROMPT,
  asksToRun,
  mentionsCommand,
  modelContextBlock,
  refusesAsAlreadyDone,
  toolsForRole,
  withModelContext,
} from "./aiTools";

/**
 * Penjaga terhadap loop yang dilaporkan dari pemakaian sungguhan: orangnya
 * menatap Revit, lampunya belum berganti, ia meminta lagi — dan yang ia dapat
 * adalah kalimat bahwa itu sudah dikerjakan. Berapa kali pun.
 *
 * Kedua fungsi ini dipakai BERPASANGAN di `propose`, dan pasangannya yang
 * membuatnya aman: penolakan saja tidak cukup untuk memaksa sebuah perintah
 * berangkat, karena "sudah terpasang enam armatur" adalah jawaban yang benar
 * untuk sebuah pertanyaan.
 */
describe("asksToRun / refusesAsAlreadyDone", () => {
  it("kalimat yang menyuruh dikenali", () => {
    for (const line of [
      "modifikasi lampu downlight 3x2 di receptionist 3 meter",
      "pasang 6 lampu di Meeting 1 tinggi 3 meter",
      "tolong ganti armaturnya jadi downlight",
      "hapus stop kontak di pantry",
      "place 4 receptacles in Office",
    ]) {
      expect(asksToRun(line), line).toBe(true);
    }
  });

  it("pertanyaan tidak dianggap suruhan", () => {
    // Ini yang membuat pemaksaan aman. Sebuah pertanyaan yang dijawab "sudah
    // terpasang enam" adalah jawaban, bukan penolakan — dan mengubahnya jadi
    // perintah berarti memasang sesuatu yang tidak diminta siapa pun.
    for (const line of [
      "apakah lampunya sudah dipasang?",
      "di receptionist ada berapa lampu?",
      "kenapa jumlahnya cuma 34?",
    ]) {
      expect(asksToRun(line), line).toBe(false);
    }
  });

  it("penolakan dengan alasan sudah dikerjakan dikenali", () => {
    for (const line of [
      "Lampu downlight 3x2 di RECEPTIONIST sudah dipasang di langkah sebelumnya.",
      "Perintahnya sudah saya kirim tadi, jadi tidak perlu diulang.",
      "Modifikasinya sudah dijalankan.",
      "That layout has already been placed.",
    ]) {
      expect(refusesAsAlreadyDone(line), line).toBe(true);
    }
  });

  it("jawaban biasa tidak dianggap penolakan", () => {
    for (const line of [
      "Baik, 6 lampu di Meeting 1 sudah saya catat. Tingginya berapa meter?",
      "Mau saya kirim sekarang?",
      "Ruangan itu berisi 6 armatur.",
    ]) {
      expect(refusesAsAlreadyDone(line), line).toBe(false);
    }
  });
});

describe("modelContextBlock", () => {
  // Blok inilah yang harus berdiri sendiri supaya prompt statisnya bisa
  // di-cache: cache mencocokkan prefiks, dan daftar family yang menempel di
  // ujung prompt membuat setiap proyek punya prefiks yang berbeda.
  it("kosong kalau tidak ada yang bisa disebut", () => {
    expect(modelContextBlock(undefined)).toBe("");
    expect(modelContextBlock({})).toBe("");
    expect(modelContextBlock({ familyTypes: {}, rooms: [] })).toBe("");
  });

  it("tidak memuat prompt sistemnya sendiri", () => {
    const block = modelContextBlock({ rooms: ["LOUNGE 5", "MEETING 2"] });
    expect(block).toContain("LOUNGE 5");
    expect(block).not.toContain(ELECTRICAL_SYSTEM_PROMPT.slice(0, 60));
  });

  it("withModelContext tetap menggabungkan keduanya", () => {
    const joined = withModelContext(ELECTRICAL_SYSTEM_PROMPT, { rooms: ["PANTRY"] });
    expect(joined.startsWith(ELECTRICAL_SYSTEM_PROMPT)).toBe(true);
    expect(joined).toContain("PANTRY");
  });
});

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
  it("menyatakan bahwa catatan hasil adalah masa lalu, bukan keadaan model", () => {
    // Tanpa ini model memperlakukan riwayat percakapan sebagai isi model
    // sekarang. Sepuluh downlight yang sudah dihapus orangnya tetap "terpasang"
    // menurut chat, dan permintaan memasangnya lagi dijawab dengan penolakan.
    expect(ELECTRICAL_SYSTEM_PROMPT).toMatch(/SATU SAAT DI MASA LALU/i);
    expect(ELECTRICAL_SYSTEM_PROMPT).toMatch(/Ctrl\+Z/);
  });

  it("permintaan menjalankan selalu menang atas catatan", () => {
    expect(ELECTRICAL_SYSTEM_PROMPT).toMatch(/MEMINTA SESUATU DIJALANKAN, JALANKAN/i);
    // Kata-kata yang benar-benar diketik orangnya saat model sudah berubah.
    for (const phrase of ["Pasang lagi", "coba lagi", "sudah saya hapus"]) {
      expect(ELECTRICAL_SYSTEM_PROMPT, phrase).toContain(phrase);
    }
  });

  it("menolak karena catatan menyebut hasilnya sudah ada dilarang tegas", () => {
    expect(ELECTRICAL_SYSTEM_PROMPT).toMatch(
      /jangan pernah menolak karena catatan sistem menyebut hasilnya\s+sudah ada/i
    );
  });

  it("membatasi panjang jawaban sesudah tool dipanggil", () => {
    // Keluhannya harfiah: "jawaban ai tidak to the point terlalu banyak balasan".
    expect(ELECTRICAL_SYSTEM_PROMPT).toMatch(/SATU KALIMAT, LALU BERHENTI/i);
    expect(ELECTRICAL_SYSTEM_PROMPT).toMatch(/JANGAN menuliskan ulang isi catatan sistem/i);
    expect(ELECTRICAL_SYSTEM_PROMPT).toMatch(/JANGAN menawarkan langkah berikutnya/i);
  });

  it("menyatakan bahwa menulis teks tidak mengirim apa pun", () => {
    expect(ELECTRICAL_SYSTEM_PROMPT).toMatch(/TIDAK mengirim apa pun/);
  });

  it("menyuruh memakai modify_devices untuk ruangan yang sudah berisi", () => {
    expect(ELECTRICAL_SYSTEM_PROMPT).toContain("modify_devices");
  });

  it("menyuruh membiarkan grid kosong kalau yang disebut adalah jumlah", () => {
    expect(ELECTRICAL_SYSTEM_PROMPT).toMatch(/biarkan .*grid.* kosong/i);
  });

  it("menyuruh menjawab dari hasil yang sudah ada, bukan menjalankan ulang", () => {
    // Riwayatnya sekarang memuat angka yang dijawab Revit. Tanpa aturan ini,
    // "tadi totalnya berapa?" tetap dijawab dengan satu perintah baru dan
    // setengah menit menunggu — untuk angka yang sudah tertulis di layar.
    expect(ELECTRICAL_SYSTEM_PROMPT).toContain("HASILNYA");
    expect(ELECTRICAL_SYSTEM_PROMPT).toMatch(/tanpa\s+memanggil tool apa pun/i);
    expect(ELECTRICAL_SYSTEM_PROMPT).toMatch(/Salin angkanya persis/i);
  });
});

describe("withModelContext", () => {
  const sample = {
    familyTypes: {
      "Lighting Fixtures": [
        "ACT_E_DOWNLIGHT 22WATT: DOWNLIGHT 22 WATT",
        "ACT_E_DOWNLIGHT 22WATT: DOWNLIGHT 18 WATT",
      ],
    },
    rooms: ["LOUNGE 5"],
  };

  // Daftar inilah yang disalin model ke argumennya. Kalau bentuk tampilan Revit
  // (`Family: Type`) muncul di daftar family, perintahnya berangkat membawa nilai
  // yang tidak cocok dengan apa pun — dan add-in memasang family bawaannya
  // sendiri tanpa satu pun galat muncul.
  it("daftar family memuat nama family saja, tanpa bentuk tampilan Revit", () => {
    const prompt = withModelContext(ELECTRICAL_SYSTEM_PROMPT, sample);
    const families = prompt.slice(
      prompt.indexOf("YANG ADA DI MODEL"),
      prompt.indexOf("NAMA TIPE DI MODEL")
    );

    expect(families).toContain("ACT_E_DOWNLIGHT 22WATT");
    expect(families).not.toContain("DOWNLIGHT 22 WATT");
    // Titik dua hanya milik label kategorinya; tidak ada satu pun di sisi nilai,
    // karena di situlah bentuk `Family: Type` akan terlihat.
    const line = families.split("\n").find((l) => l.includes("ACT_E_DOWNLIGHT")) ?? "";
    expect(line.slice(line.indexOf(":") + 1)).not.toContain(":");
    // Satu family, satu kali — dua tipe di dalamnya bukan dua pilihan.
    expect(families.match(/ACT_E_DOWNLIGHT 22WATT/g)).toHaveLength(1);
  });

  // Nama tipe dulu dibuang seluruhnya, dan akibatnya `where="Type=…"` tidak bisa
  // dipakai sama sekali: satu-satunya nama yang sah di situ justru yang tidak
  // pernah dikirim.
  it("nama tipe ikut, di bloknya sendiri, dengan larangan memakainya untuk `family`", () => {
    const prompt = withModelContext(ELECTRICAL_SYSTEM_PROMPT, sample);
    const types = prompt.slice(prompt.indexOf("NAMA TIPE DI MODEL"));

    expect(types).toContain("DOWNLIGHT 22 WATT");
    expect(types).toContain("DOWNLIGHT 18 WATT");
    expect(types).toMatch(/JANGAN untuk argumen/);
    expect(types).toMatch(/where="Type=/);
  });

  it("tidak menambah blok tipe kalau modelnya tidak melaporkan tipe", () => {
    const prompt = withModelContext(ELECTRICAL_SYSTEM_PROMPT, {
      familyTypes: { "Lighting Fixtures": ["ACT_E_DOWNLIGHT 22WATT"] },
    });

    expect(prompt).toContain("ACT_E_DOWNLIGHT 22WATT");
    expect(prompt).not.toContain("NAMA TIPE DI MODEL");
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

  it("query menawarkan penyaringan per family, bukan cuma per ruangan dan lantai", () => {
    // Tanpa ini, "berapa downlight 22W di lantai 1" dijawab dengan jumlah SELURUH
    // armatur di lantai 1 — angka yang benar untuk pertanyaan yang tidak
    // ditanyakan siapa pun, dan yang terbaca persis seperti jawabannya.
    const query = toolsForRole("viewer").find((t) => t.name === "query");
    expect(query?.input_schema.properties.family).toBeTruthy();
    expect(query?.description).toMatch(/family/);
  });

  it("prompt menyuruh menyaring pertanyaan yang menyebut nama family", () => {
    expect(ELECTRICAL_SYSTEM_PROMPT).toMatch(/MENYEBUT NAMA FAMILY/);
    expect(ELECTRICAL_SYSTEM_PROMPT).toMatch(/where="Family=/);
    // Dan menyuruh memakai ~ ketika ejaannya tidak berasal dari daftar model:
    // `=` menuntut sama persis, dan nol baris tidak bisa dibedakan dari tidak ada.
    expect(ELECTRICAL_SYSTEM_PROMPT).toMatch(/where="Family~/);
  });

  it("prompt menyebut kolom yang tidak perlu ditanyakan lebih dulu", () => {
    // Enam kolom ini selalu ada. Menyuruh what=parameters untuk keenamnya adalah
    // satu putaran ke Revit untuk sesuatu yang sudah pasti.
    for (const column of ["Family", "Type", "Level", "Room", "Category", "Length"]) {
      expect(ELECTRICAL_SYSTEM_PROMPT, column).toContain(`\`${column}\``);
    }
  });

  it("prompt menyebut multi-kategori dan multi-syarat", () => {
    expect(ELECTRICAL_SYSTEM_PROMPT).toContain('category="lighting, lighting_device, receptacle"');
    expect(ELECTRICAL_SYSTEM_PROMPT).toMatch(/SEMUANYA harus terpenuhi/);
    expect(ELECTRICAL_SYSTEM_PROMPT).toContain("group_by=Family");
  });

  it("prompt menyebut bahwa query sudah melaporkan panjang, watt, dan luas", () => {
    // Sebabnya nyata: asisten pernah menjawab "tidak ada tool untuk mengukur
    // panjang tray" untuk angka yang sudah dilaporkan add-in bertahun-tahun.
    expect(ELECTRICAL_SYSTEM_PROMPT).toMatch(/total meter/);
    expect(ELECTRICAL_SYSTEM_PROMPT).toMatch(/Jangan bilang tidak ada caranya/);
  });
});
