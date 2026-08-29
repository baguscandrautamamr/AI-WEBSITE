import { describe, expect, it } from "vitest";
import { elementIdsIn } from "./elementIds";

/**
 * Yang diuji di sini adalah sebuah BATAS, dan kedua sisinya sama pentingnya.
 *
 * Terlalu longgar: sebuah pertanyaan dikenali sebagai ID, tidak pernah sampai
 * ke model, dan yang terlihat orangnya adalah pertanyaan yang dijawab dengan
 * memindahkan layar Revit. Terlalu ketat: orangnya mengetik dua ID dipisah
 * spasi, dan yang menjawabnya adalah model bahasa yang tidak punya cara
 * menunjukkan apa pun di Revit.
 */
describe("elementIdsIn", () => {
  it("angka telanjang adalah ID", () => {
    expect(elementIdsIn("384210")).toBe("384210");
    expect(elementIdsIn("  384210  ")).toBe("384210");
  });

  it("beberapa ID, dipisah koma maupun spasi", () => {
    expect(elementIdsIn("384210,384215")).toBe("384210,384215");
    expect(elementIdsIn("384210, 384215")).toBe("384210,384215");
    expect(elementIdsIn("384210 384215")).toBe("384210,384215");
    expect(elementIdsIn("384210 , 384215 ,384220")).toBe("384210,384215,384220");
  });

  it("duplikat dibuang, urutan ketik dipertahankan", () => {
    expect(elementIdsIn("5 3 5 9 3")).toBe("5,3,9");
  });

  it("apa pun yang mengandung kata adalah pertanyaan, bukan ID", () => {
    // Inilah sisi yang paling mahal kalau salah: masing-masing di bawah punya
    // jawaban berupa kalimat, dan tidak satu pun dari mereka meminta layar
    // Revit berpindah.
    expect(elementIdsIn("elemen 384210")).toBeNull();
    expect(elementIdsIn("384210 itu apa")).toBeNull();
    expect(elementIdsIn("ada berapa lampu di Level 1")).toBeNull();
    expect(elementIdsIn("tunjukkan 384210")).toBeNull();
    expect(elementIdsIn("pasang 6 lampu di Meeting 1 tinggi 3 meter")).toBeNull();
  });

  it("angka yang bukan ID dilewatkan ke model", () => {
    // 0 adalah InvalidElementId; angka sepanjang ini bukan ElementId Revit.
    // Keduanya dibiarkan jatuh ke model, yang bisa menjelaskan kenapa —
    // sementara perintah yang berangkat cuma akan ditolak add-in.
    expect(elementIdsIn("0")).toBeNull();
    expect(elementIdsIn("384210, 0")).toBeNull();
    expect(elementIdsIn("1234567890123")).toBeNull();
  });

  it("bukan angka bulat positif bukan ID", () => {
    expect(elementIdsIn("12.5")).toBeNull();
    expect(elementIdsIn("-4")).toBeNull();
    expect(elementIdsIn("3x2")).toBeNull();
  });

  it("kosong bukan apa-apa", () => {
    expect(elementIdsIn("")).toBeNull();
    expect(elementIdsIn("   ")).toBeNull();
    expect(elementIdsIn(",")).toBeNull();
  });
});
