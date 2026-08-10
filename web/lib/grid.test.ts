import { describe, expect, it } from "vitest";
import {
  autoGrid,
  awkwardCount,
  factorPairs,
  flip,
  formatGrid,
  friendlierCounts,
  gridCount,
  parseGrid,
} from "./grid";

describe("autoGrid", () => {
  it("memuat persis sejumlah titiknya, tanpa satu pun lubang", () => {
    for (let count = 1; count <= 200; count++) {
      const grid = autoGrid(count);
      expect(grid, `jumlah ${count}`).not.toBeNull();
      expect(gridCount(grid!), `jumlah ${count}`).toBe(count);
    }
  });

  it("memilih pasangan yang paling mendekati persegi", () => {
    // 10 lampu: 5x2, bukan 10x1 dan bukan grid berlubang seperti 4x3.
    expect(formatGrid(autoGrid(10)!)).toBe("5x2");
    expect(formatGrid(autoGrid(9)!)).toBe("3x3");
    expect(formatGrid(autoGrid(12)!)).toBe("4x3");
    expect(formatGrid(autoGrid(16)!)).toBe("4x4");
    expect(formatGrid(autoGrid(24)!)).toBe("6x4");
    expect(formatGrid(autoGrid(36)!)).toBe("6x6");
  });

  it("lanskap secara bawaan, dan bisa dibalik", () => {
    expect(autoGrid(10)).toEqual({ cols: 5, rows: 2 });
    expect(autoGrid(10, { orientation: "portrait" })).toEqual({ cols: 2, rows: 5 });
  });

  it("menolak jumlah yang bukan bilangan bulat positif", () => {
    for (const bad of [0, -3, 2.5, NaN, Infinity]) {
      expect(autoGrid(bad), `jumlah ${bad}`).toBeNull();
    }
  });
});

describe("factorPairs", () => {
  it("berurutan dari paling lonjong ke paling persegi", () => {
    expect(factorPairs(12)).toEqual([
      { cols: 12, rows: 1 },
      { cols: 6, rows: 2 },
      { cols: 4, rows: 3 },
    ]);
  });

  it("bilangan prima hanya punya satu pasangan", () => {
    expect(factorPairs(7)).toEqual([{ cols: 7, rows: 1 }]);
  });
});

describe("awkwardCount", () => {
  it("menandai jumlah yang satu-satunya grid tepatnya adalah satu deret", () => {
    expect(awkwardCount(7)).toBe(true);
    expect(awkwardCount(11)).toBe(true);
    expect(awkwardCount(10)).toBe(false);
    expect(awkwardCount(9)).toBe(false);
    // Satu, dua, dan tiga titik memang wajar berderet — itu bukan masalah.
    expect(awkwardCount(2)).toBe(false);
    expect(awkwardCount(3)).toBe(false);
  });
});

describe("friendlierCounts", () => {
  it("menawarkan jumlah terdekat yang bisa dua baris", () => {
    expect(friendlierCounts(7)).toEqual([6, 8]);
    expect(friendlierCounts(11)).toEqual([10, 12]);
  });
});

describe("parseGrid", () => {
  it("menerima ejaan yang longgar", () => {
    expect(parseGrid(" 3 X 2 ")).toEqual({ cols: 3, rows: 2 });
    expect(parseGrid("2x5")).toEqual({ cols: 2, rows: 5 });
  });

  it("menolak yang bukan grid", () => {
    for (const bad of ["3-2", "x", "", null, undefined, "0x3", "3x0"]) {
      expect(parseGrid(bad), `nilai ${String(bad)}`).toBeNull();
    }
  });
});

describe("flip", () => {
  it("menukar kolom dan baris", () => {
    expect(flip({ cols: 5, rows: 2 })).toEqual({ cols: 2, rows: 5 });
  });
});
