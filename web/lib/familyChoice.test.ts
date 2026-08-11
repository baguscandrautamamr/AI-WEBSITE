import { describe, expect, it } from "vitest";
import { resolveFamilies } from "./familyChoice";
import { COMMANDS_BY_NAME } from "./commands";

const MODEL = {
  "Lighting Fixtures": [
    "ACT_E_DOWNLIGHT 22WATT: DOWNLIGHT 22 WATT",
    "ACT_E_DOWNLIGHT 12WATT: DOWNLIGHT 12 WATT",
    "ACT_E_LIGHTING RECESSED 600x600_: RECESSED 600x600 NORMAL",
  ],
  "Electrical Fixtures": ["ACT_E_SOCKET 2P+E: SOCKET NORMAL"],
};

const lighting = COMMANDS_BY_NAME.place_lighting;

describe("resolveFamilies — yang bisa diselesaikan sendiri", () => {
  it("merapikan bentuk tampilan Revit jadi nama family model", () => {
    const { values, question } = resolveFamilies(
      lighting,
      { room: "PANTRY 6", fixture_type: "ACT_E_DOWNLIGHT 22WATT: DOWNLIGHT 22 WATT" },
      MODEL
    );
    expect(question).toBeNull();
    expect(values.fixture_type).toBe("ACT_E_DOWNLIGHT 22WATT");
  });

  it("menerima ejaan yang berbeda huruf besar-kecilnya", () => {
    const { values, question } = resolveFamilies(
      lighting,
      { fixture_type: "act_e_downlight 22watt" },
      MODEL
    );
    expect(question).toBeNull();
    expect(values.fixture_type).toBe("ACT_E_DOWNLIGHT 22WATT");
  });

  it("menerima sebutan pendek yang hanya cocok dengan satu family", () => {
    const { values, question } = resolveFamilies(lighting, { fixture_type: "recessed" }, MODEL);
    expect(question).toBeNull();
    expect(values.fixture_type).toBe("ACT_E_LIGHTING RECESSED 600x600_");
  });
});

describe("resolveFamilies — yang harus ditanyakan", () => {
  // Inilah kejadiannya: "pasang lampu downlight" tidak menyebut family mana pun,
  // model memilih salah satu, dan add-in yang tidak menemukan namanya memakai
  // bawaannya sambil melaporkan sukses. Yang salah baru terlihat di gambar.
  it("menawarkan kandidat kalau sebutannya cocok dengan lebih dari satu", () => {
    const { question } = resolveFamilies(lighting, { fixture_type: "downlight" }, MODEL);
    expect(question).toMatchObject({ field: "fixture_type", category: "lighting" });
    expect(question!.choices).toEqual(["ACT_E_DOWNLIGHT 22WATT", "ACT_E_DOWNLIGHT 12WATT"]);
  });

  it("menawarkan seluruh kategori kalau tidak ada yang mendekati", () => {
    const { question } = resolveFamilies(lighting, { fixture_type: "LED_15W" }, MODEL);
    expect(question!.guessed).toBe("LED_15W");
    expect(question!.choices).toHaveLength(3);
  });

  it("menahan perintahnya — nilainya tidak dirapikan jadi tebakan lain", () => {
    const { values } = resolveFamilies(lighting, { fixture_type: "downlight" }, MODEL);
    expect(values.fixture_type).toBe("downlight");
  });
});

describe("resolveFamilies — yang tidak boleh ditanyakan", () => {
  it("kolom family yang kosong dibiarkan: add-in memakai bawaannya", () => {
    const { question } = resolveFamilies(lighting, { room: "PANTRY 6", count: 4 }, MODEL);
    expect(question).toBeNull();
  });

  it("model yang belum dibaca tidak jadi alasan menahan perintah", () => {
    expect(resolveFamilies(lighting, { fixture_type: "apa saja" }, undefined).question).toBeNull();
    expect(resolveFamilies(lighting, { fixture_type: "apa saja" }, {}).question).toBeNull();
  });

  it("kolom yang bukan kolom family tidak disentuh", () => {
    const { values, question } = resolveFamilies(
      COMMANDS_BY_NAME.place_receptacle,
      { room: "Office A", count: 4, type: "double_grounded" },
      MODEL
    );
    expect(question).toBeNull();
    expect(values.type).toBe("double_grounded");
  });
});

describe("resolveFamilies — modify_devices", () => {
  it("kategorinya ikut kolom what", () => {
    const { question } = resolveFamilies(
      COMMANDS_BY_NAME.modify_devices,
      { room: "PANTRY 6", what: "lighting", count: 4, fixture_type: "downlight" },
      MODEL
    );
    expect(question).toMatchObject({ category: "lighting" });
  });

  it("kategori yang tidak punya family di model tidak menahan apa pun", () => {
    const { question } = resolveFamilies(
      COMMANDS_BY_NAME.modify_devices,
      { room: "PANTRY 6", what: "security", count: 2, fixture_type: "dome" },
      MODEL
    );
    expect(question).toBeNull();
  });
});
