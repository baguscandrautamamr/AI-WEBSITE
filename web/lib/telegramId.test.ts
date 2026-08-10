import { describe, expect, it } from "vitest";
import { parseChatId } from "./telegramId";

describe("parseChatId", () => {
  it("menerima nomor apa adanya", () => {
    expect(parseChatId("123456789")).toBe(123456789);
  });

  it("memaafkan bentuk tempelan yang wajar", () => {
    expect(parseChatId("  123456789 ")).toBe(123456789);
    expect(parseChatId("ID: 123456789")).toBe(123456789);
    expect(parseChatId("(123456789)")).toBe(123456789);
    expect(parseChatId("Id 123456789 — Bagus")).toBe(123456789);
  });

  it("menolak yang tidak berisi angka", () => {
    expect(parseChatId("")).toBeNull();
    expect(parseChatId("   ")).toBeNull();
    expect(parseChatId("@baguscandra")).toBeNull();
  });

  it("menolak dua angka dalam satu ketikan", () => {
    // Bisa satu nomor yang terpotong, bisa dua nomor yang tertempel. Menebak
    // salah satu berarti mengirim hasil pekerjaan orang ke chat yang salah.
    expect(parseChatId("123 456")).toBeNull();
    expect(parseChatId("123456789 987654321")).toBeNull();
  });

  it("menolak nomor negatif", () => {
    // Itu nomor chat grup, bukan nomor orang.
    expect(parseChatId("-1001234567890")).toBeNull();
  });

  it("menolak angka di luar rentang yang bisa dibawa tanpa kehilangan presisi", () => {
    expect(parseChatId("0")).toBeNull();
    expect(parseChatId("99999999999999999999")).toBeNull();
  });

  it("melewatkan seluruh rentang nomor Telegram yang sah", () => {
    // Dokumentasi Telegram menyebut nomor bisa tumbuh sampai 52 bit.
    expect(parseChatId(String(2 ** 52))).toBe(2 ** 52);
  });
});
