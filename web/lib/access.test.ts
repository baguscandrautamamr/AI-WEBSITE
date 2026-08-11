import { describe, expect, it } from "vitest";
import {
  ACCESS_CLASSES,
  areaOfPath,
  canOpen,
  isAccessClass,
  landingFor,
  type AccessClass,
} from "./access";

describe("canOpen — tiga kelas yang diminta", () => {
  it("full membuka semuanya", () => {
    expect(canOpen("full", "standard")).toBe(true);
    expect(canOpen("full", "revit")).toBe(true);
    expect(canOpen("full", "grant")).toBe(true);
  });

  it("standard_only hanya halaman Standar", () => {
    expect(canOpen("standard_only", "standard")).toBe(true);
    expect(canOpen("standard_only", "revit")).toBe(false);
    // Boleh MELIHAT halaman admin — itu tidak dijaga di sini — tapi tidak boleh
    // memberi akses kepada siapa pun.
    expect(canOpen("standard_only", "grant")).toBe(false);
  });

  it("no_standard: semuanya kecuali halaman Standar", () => {
    expect(canOpen("no_standard", "standard")).toBe(false);
    expect(canOpen("no_standard", "revit")).toBe(true);
    expect(canOpen("no_standard", "grant")).toBe(true);
  });

  it("setiap kelas punya jawaban untuk setiap bagian", () => {
    // Bagian baru yang lupa dimasukkan ke tabel akan terbaca `undefined`, dan
    // `undefined` di sebuah penjaga berarti terbuka.
    for (const cls of ACCESS_CLASSES) {
      for (const area of ["standard", "revit", "grant"] as const) {
        expect(typeof canOpen(cls, area), `${cls}/${area}`).toBe("boolean");
      }
    }
  });
});

describe("areaOfPath", () => {
  it("memetakan halaman ke bagiannya", () => {
    expect(areaOfPath("/standard")).toBe("standard");
    expect(areaOfPath("/electrical")).toBe("revit");
    expect(areaOfPath("/inspect")).toBe("revit");
    expect(areaOfPath("/import")).toBe("revit");
    expect(areaOfPath("/export-import")).toBe("revit");
    expect(areaOfPath("/history")).toBe("revit");
  });

  it("halaman admin tidak dijaga: kelas apa pun boleh melihatnya", () => {
    // Yang dijaga di dalamnya adalah memberi akses, dan itu ada di route-nya.
    expect(areaOfPath("/admin/users")).toBeNull();
  });

  it("path lain tidak dijaga", () => {
    expect(areaOfPath("/")).toBeNull();
    expect(areaOfPath("/login")).toBeNull();
  });

  it("tidak tertipu nama yang cuma berawalan sama", () => {
    // `/importir` bukan `/import`. Kalau ia terbaca begitu, sebuah halaman yang
    // tidak ada hubungannya ikut tertutup — atau lebih buruk, sebuah halaman
    // Revit yang bernama mirip lolos karena dicocokkan ke bagian yang salah.
    expect(areaOfPath("/importir")).toBeNull();
    expect(areaOfPath("/standardisasi")).toBeNull();
  });

  it("ikut menjaga sub-halaman", () => {
    expect(areaOfPath("/electrical/detail")).toBe("revit");
    expect(areaOfPath("/standard/arsip")).toBe("standard");
  });
});

describe("landingFor", () => {
  it("mendarat di halaman yang memang boleh dibuka", () => {
    // Tanpa ini, akun standard_only mendarat di /electrical setelah login —
    // halaman yang langsung menolaknya, sebagai hal pertama yang ia lihat.
    expect(landingFor("full")).toBe("/electrical");
    expect(landingFor("no_standard")).toBe("/electrical");
    expect(landingFor("standard_only")).toBe("/standard");
  });

  it("halaman pendaratan setiap kelas memang boleh dibuka kelas itu", () => {
    for (const cls of ACCESS_CLASSES) {
      const area = areaOfPath(landingFor(cls));
      if (area) expect(canOpen(cls, area), cls).toBe(true);
    }
  });
});

describe("isAccessClass", () => {
  it("menerima yang tiga itu saja", () => {
    for (const cls of ACCESS_CLASSES) expect(isAccessClass(cls)).toBe(true);
  });

  it("menolak apa pun yang lain", () => {
    // Nilainya datang dari body request di route PATCH; yang tidak dikenali
    // harus ditolak di sana, bukan ditulis ke kolom lalu ditolak Postgres.
    for (const value of ["admin", "FULL", "", null, undefined, 1, {}]) {
      expect(isAccessClass(value), JSON.stringify(value) ?? "undefined").toBe(false);
    }
  });

  it("mengecualikan yang tidak bertipe AccessClass dari daftar", () => {
    const classes: AccessClass[] = [...ACCESS_CLASSES];
    expect(classes).toHaveLength(3);
  });
});
