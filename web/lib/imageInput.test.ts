import { describe, expect, it } from "vitest";
import {
  attachmentNote,
  base64Bytes,
  checkImages,
  isImageType,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
} from "./imageInput";

/** base64 sepanjang `bytes` byte, isinya tidak penting. */
const bytes = (n: number) => "A".repeat(Math.ceil((n * 4) / 3));

describe("checkImages — apa yang boleh sampai ke model", () => {
  it("tanpa gambar tetap sah — pertanyaan teks adalah yang paling biasa", () => {
    expect(checkImages(undefined)).toEqual({ ok: true, images: [] });
    expect(checkImages(null)).toEqual({ ok: true, images: [] });
    expect(checkImages([])).toEqual({ ok: true, images: [] });
  });

  it("menerima gambar yang bentuknya benar", () => {
    const result = checkImages([{ media_type: "image/jpeg", data: "AAAA" }]);
    expect(result).toEqual({ ok: true, images: [{ media_type: "image/jpeg", data: "AAAA" }] });
  });

  it("awalan data URL dipotong, bukan ditolak", () => {
    // Yang mengirimnya menyalin apa adanya dari FileReader, dan menolak
    // permintaannya karena sebuah awalan yang bisa dipotong sendiri tidak
    // menjaga apa pun.
    const result = checkImages([{ media_type: "image/png", data: "data:image/png;base64,AAAA" }]);
    expect(result).toEqual({ ok: true, images: [{ media_type: "image/png", data: "AAAA" }] });
  });

  it("format di luar yang bisa dibaca model ditolak di sini", () => {
    // Kalau lolos, yang menolaknya adalah gateway dengan 400 — dan yang
    // membacanya cuma log kami, bukan orangnya.
    const result = checkImages([{ media_type: "image/tiff", data: "AAAA" }]);
    expect(result.ok).toBe(false);
  });

  it("isi yang bukan base64 ditolak", () => {
    expect(checkImages([{ media_type: "image/jpeg", data: "bukan base64!" }]).ok).toBe(false);
  });

  it("lebih dari batas jumlahnya ditolak", () => {
    const many = Array.from({ length: MAX_IMAGES + 1 }, () => ({
      media_type: "image/jpeg",
      data: "AAAA",
    }));
    expect(checkImages(many).ok).toBe(false);
  });

  it("gambar yang lebih besar dari batas ditolak", () => {
    const big = [{ media_type: "image/jpeg", data: bytes(MAX_IMAGE_BYTES + 1024) }];
    expect(checkImages(big).ok).toBe(false);
  });

  it("yang persis di bawah batas tetap diterima", () => {
    const near = [{ media_type: "image/jpeg", data: bytes(MAX_IMAGE_BYTES - 1024) }];
    expect(checkImages(near).ok).toBe(true);
  });

  it("bukan daftar ditolak", () => {
    expect(checkImages("AAAA").ok).toBe(false);
    expect(checkImages({ media_type: "image/jpeg", data: "AAAA" }).ok).toBe(false);
  });

  it("alasannya kalimat yang dibaca orangnya, bukan kode", () => {
    const result = checkImages([{ media_type: "image/tiff", data: "AAAA" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/format gambar/i);
      expect(result.reason).not.toMatch(/^[A-Z_]+$/);
    }
  });
});

describe("base64Bytes — ukuran tanpa membongkarnya", () => {
  it("menghitung padding", () => {
    // "AAAA" = 3 byte; satu '=' berarti 2 byte, dua '=' berarti 1 byte.
    expect(base64Bytes("AAAA")).toBe(3);
    expect(base64Bytes("AAA=")).toBe(2);
    expect(base64Bytes("AA==")).toBe(1);
  });
});

describe("isImageType", () => {
  it("hanya empat yang bisa dibaca model", () => {
    expect(isImageType("image/jpeg")).toBe(true);
    expect(isImageType("image/png")).toBe(true);
    expect(isImageType("image/webp")).toBe(true);
    expect(isImageType("image/gif")).toBe(true);
    expect(isImageType("image/svg+xml")).toBe(false);
    expect(isImageType("application/pdf")).toBe(false);
    expect(isImageType(undefined)).toBe(false);
  });
});

describe("attachmentNote — yang tertinggal di riwayat", () => {
  it("menyebut jumlahnya dan bahwa gambarnya tidak tersimpan", () => {
    // Giliran berikutnya yang berbunyi "tadi yang di gambar itu berapa?" harus
    // dijawab dengan mengaku tidak lagi melihatnya, bukan dengan mengarang.
    const note = attachmentNote(2);
    expect(note).toContain("2 gambar");
    expect(note).toMatch(/tidak tersimpan/i);
  });

  it("tanpa gambar tidak meninggalkan apa pun", () => {
    expect(attachmentNote(0)).toBe("");
  });
});
