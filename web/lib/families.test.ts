import { describe, expect, it } from "vitest";
import { categoriesWithFamilies, familyTypesFor } from "./families";
import {
  COMMANDS,
  COMMANDS_BY_NAME,
  familyCategoryOf,
  modifyCategoryFor,
  modifyValuesFrom,
} from "./commands";

describe("familyTypesFor", () => {
  it("menemukan daftarnya apa pun ejaan kunci yang dipakai add-in", () => {
    const spellings = [
      "lighting",
      "Lighting",
      "lighting_fixtures",
      "Lighting Fixtures",
      "LightingFixtures",
      "fixture",
    ];

    for (const key of spellings) {
      expect(familyTypesFor({ [key]: ["ACT_E_DOWNLIGHT 22WATT"] }, "lighting"), key).toEqual([
        "ACT_E_DOWNLIGHT 22WATT",
      ]);
    }
  });

  it("tidak mencampur kategori yang berbeda", () => {
    const model = {
      "Lighting Fixtures": ["ACT_E_DOWNLIGHT 22WATT"],
      "Lighting Devices": ["Saklar Ganda"],
      "Security Devices": ["Dome 4MP"],
    };

    expect(familyTypesFor(model, "lighting")).toEqual(["ACT_E_DOWNLIGHT 22WATT"]);
    expect(familyTypesFor(model, "lighting_device")).toEqual(["Saklar Ganda"]);
    expect(familyTypesFor(model, "security")).toEqual(["Dome 4MP"]);
    expect(familyTypesFor(model, "receptacle")).toEqual([]);
  });

  it("menggabungkan dua kunci yang mengarah ke kategori yang sama, tanpa duplikat", () => {
    expect(
      familyTypesFor({ lighting: ["A", "B"], "Lighting Fixtures": ["B", "C"] }, "lighting")
    ).toEqual(["A", "B", "C"]);
  });

  it("aman terhadap model yang belum dibaca atau isi yang tidak berbentuk", () => {
    expect(familyTypesFor(undefined, "lighting")).toEqual([]);
    expect(familyTypesFor({}, "lighting")).toEqual([]);
    expect(familyTypesFor({ lighting: "bukan array" as never }, "lighting")).toEqual([]);
    expect(familyTypesFor({ lighting: ["", "  ", "A"] }, "lighting")).toEqual(["A"]);
    expect(familyTypesFor({ lighting: ["A"] }, undefined)).toEqual([]);
  });
});

describe("categoriesWithFamilies", () => {
  it("hanya menyebut kategori yang benar-benar punya isi", () => {
    expect(
      categoriesWithFamilies({ "Lighting Fixtures": ["A"], "Data Devices": [] })
    ).toEqual(["lighting"]);
  });
});

describe("katalog — kolom nama family punya kategorinya", () => {
  // Kolom nama family yang tidak menyebutkan kategorinya akan jatuh kembali
  // menjadi kotak teks: satu-satunya kolom di form ini yang justru TIDAK boleh
  // diketik dari ingatan, karena nama family yang salah baru ditolak Revit
  // beberapa menit kemudian dengan gambar yang tetap kosong.
  it("setiap kolom family/fixture_type menyebut kategori atau sumbernya", () => {
    for (const spec of COMMANDS) {
      for (const field of spec.fields) {
        const looksLikeFamily =
          field.name === "family" ||
          field.name === "fixture_type" ||
          field.name.endsWith("_family");
        if (!looksLikeFamily) continue;

        expect(
          field.familyCategory ?? field.familyCategoryFrom,
          `${spec.name}.${field.name}`
        ).toBeTruthy();
      }
    }
  });

  it("fixture_type tidak lagi membawa default yang tidak ada di model mana pun", () => {
    // "LED_15W" dulu terisi otomatis di form, jadi ia ikut terkirim setiap kali
    // orang tidak menyentuh kolomnya.
    const field = COMMANDS_BY_NAME.place_lighting.fields.find((f) => f.name === "fixture_type");
    expect(field?.default).toBeUndefined();
  });
});

describe("familyCategoryOf", () => {
  const fieldOf = (command: string, name: string) => {
    const spec = COMMANDS_BY_NAME[command];
    const found = [spec.positional, ...spec.fields].find((f) => f?.name === name);
    if (!found) throw new Error(`${command}.${name} tidak ada`);
    return found;
  };

  it("kolom tipe armatur menunjuk kategori lighting", () => {
    expect(familyCategoryOf(fieldOf("place_lighting", "fixture_type"), {})).toBe("lighting");
  });

  it("kolom family saklar menunjuk kategori lighting_device", () => {
    expect(familyCategoryOf(fieldOf("place_lighting_device", "family"), {})).toBe(
      "lighting_device"
    );
  });

  it("pada modify_devices kategorinya ikut kolom Kategori", () => {
    const field = fieldOf("modify_devices", "fixture_type");
    expect(familyCategoryOf(field, { what: "lighting" })).toBe("lighting");
    expect(familyCategoryOf(field, { what: "security" })).toBe("security");
    // Belum dipilih, atau "all": tidak ada satu kategori yang bisa ditawarkan.
    expect(familyCategoryOf(field, {})).toBe("");
    expect(familyCategoryOf(field, { what: "all" })).toBe("");
  });

  it("kolom biasa bukan kolom family", () => {
    expect(familyCategoryOf(fieldOf("place_lighting", "count"), {})).toBe("");
    expect(familyCategoryOf(fieldOf("place_security", "camera_type"), {})).toBe("");
  });
});

describe("modifyCategoryFor", () => {
  it("memetakan perintah pemasangan ke kategori modify yang setara", () => {
    expect(modifyCategoryFor("place_lighting")).toBe("lighting");
    expect(modifyCategoryFor("place_lighting_device")).toBe("lighting_device");
    expect(modifyCategoryFor("place_receptacle")).toBe("receptacle");
    expect(modifyCategoryFor("place_communication")).toBe("communication");
  });

  it("mengembalikan null untuk yang tidak punya padanan", () => {
    expect(modifyCategoryFor("create_cable_tray")).toBeNull();
    expect(modifyCategoryFor("equip_room")).toBeNull();
    expect(modifyCategoryFor("query")).toBeNull();
  });

  it("setiap perintah place_* punya padanan modify", () => {
    // Kalau sebuah perintah pemasangan tidak punya padanan, ruangan yang sudah
    // berisi kategori itu akan ditumpuki tanpa satu pun pertanyaan.
    for (const spec of COMMANDS.filter((c) => c.name.startsWith("place_"))) {
      expect(modifyCategoryFor(spec.name), spec.name).not.toBeNull();
    }
  });
});

describe("modifyValuesFrom", () => {
  it("membawa jumlah, grid, ketinggian, dan family ke perintah modifikasi", () => {
    const out = modifyValuesFrom(COMMANDS_BY_NAME.place_lighting, "lighting", {
      room: "LOUNGE 5",
      count: 10,
      height: 3,
      fixture_type: "ACT_E_DOWNLIGHT 22WATT",
      lux_target: 300,
      mounting: "ceiling",
    });

    expect(out).toEqual({
      room: "LOUNGE 5",
      what: "lighting",
      count: 10,
      height: 3,
      fixture_type: "ACT_E_DOWNLIGHT 22WATT",
    });
  });

  it("membaca quantity dan family, yang dipakai perintah lain untuk hal yang sama", () => {
    expect(
      modifyValuesFrom(COMMANDS_BY_NAME.place_communication, "communication", {
        room: "Lobby",
        quantity: 3,
      })
    ).toMatchObject({ count: 3 });

    expect(
      modifyValuesFrom(COMMANDS_BY_NAME.place_lighting_device, "lighting_device", {
        room: "Meeting 1",
        count: 2,
        family: "Saklar Ganda",
      })
    ).toMatchObject({ fixture_type: "Saklar Ganda" });
  });

  it("tidak membawa kolom yang kosong", () => {
    const out = modifyValuesFrom(COMMANDS_BY_NAME.place_lighting, "lighting", {
      room: "Lounge",
      count: "",
      height: "",
      fixture_type: "",
    });
    expect(out).toEqual({ room: "Lounge", what: "lighting" });
  });
});
