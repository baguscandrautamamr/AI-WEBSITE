import { describe, expect, it } from "vitest";
import {
  ACCESS_CLASSES,
  areaOfPath,
  canOpen,
  canOpenArea,
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

describe("canOpenArea — kelas DAN sudah diberi akses", () => {
  /**
   * Lubang yang membuat fungsi ini ada.
   *
   * Sebuah akun yang baru mendaftar berkelas `full` — itu bawaannya, dan bawaan
   * apa pun yang lain akan mencabut akses dari semua orang saat migrasinya jalan.
   * Untuk halaman yang menyentuh Revit itu sudah tertutup sendiri: tidak ada
   * proyek berarti tidak ada peran, dan setiap route Revit menuntut peran.
   * Halaman Standar tidak punya proyek untuk dijadikan pagar, jadi ia satu-satunya
   * yang lolos — dan akun yang sedang menunggu diberi akses tetap bisa memakai
   * model bahasa di belakangnya.
   */
  it("akun yang menunggu diberi akses tidak bisa membuka Standar", () => {
    expect(canOpenArea({ access: "full", granted: false }, "standard")).toBe(false);
  });

  it("begitu diberi satu proyek, Standar terbuka", () => {
    expect(canOpenArea({ access: "full", granted: true }, "standard")).toBe(true);
  });

  it("standard_only tidak menuntut proyek — kelas itu SENDIRI pemberian aksesnya", () => {
    // Menuntut proyek untuk kelas ini berarti menuntut hal yang kelas ini ada
    // untuk menghindarinya: seorang admin yang memilihnya sudah menyatakan
    // "orang ini boleh bertanya soal standar, tanpa proyek".
    expect(canOpenArea({ access: "standard_only", granted: false }, "standard")).toBe(true);
  });

  it("no_standard tetap tertutup, diberi proyek atau tidak", () => {
    expect(canOpenArea({ access: "no_standard", granted: true }, "standard")).toBe(false);
    expect(canOpenArea({ access: "no_standard", granted: false }, "standard")).toBe(false);
  });

  it("bagian lain tidak ikut menuntut proyek di sini", () => {
    // Halaman Revit sudah dijaga peran proyeknya masing-masing, dan `grant`
    // memang harus tetap terbuka untuk akun berkelas penuh yang belum punya
    // proyek — di situlah ia membuat proyek pertamanya.
    expect(canOpenArea({ access: "full", granted: false }, "revit")).toBe(true);
    expect(canOpenArea({ access: "full", granted: false }, "grant")).toBe(true);
  });

  it("tidak pernah lebih longgar daripada kelasnya sendiri", () => {
    for (const cls of ACCESS_CLASSES) {
      for (const area of ["standard", "revit", "grant"] as const) {
        for (const granted of [true, false]) {
          if (!canOpen(cls, area)) {
            expect(canOpenArea({ access: cls, granted }, area), `${cls}/${area}/${granted}`).toBe(
              false
            );
          }
        }
      }
    }
  });
});
