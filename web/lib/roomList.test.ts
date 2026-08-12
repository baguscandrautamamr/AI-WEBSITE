import { describe, expect, it } from "vitest";
import { expandRooms, meansEveryRoom } from "./roomList";

const MODEL_ROOMS = ["LOUNGE 5", "MEETING 1 9", "MEETING 2 8", "PANTRY 6", "SERVICE 7"];

describe("expandRooms — semua ruangan", () => {
  // "Kasih saklar di semua ruangan" dulu berakhir sebagai daftar ruangan dan
  // pertanyaan balik, lalu SATU perintah — dan empat ruangan sisanya harus
  // diminta lagi dengan kalimat yang sama.
  it("memekarkan penanda semua ruangan jadi daftar model", () => {
    for (const token of ["*", "all", "semua", "SEMUA RUANGAN", " all rooms "]) {
      expect(expandRooms(token, MODEL_ROOMS), token).toEqual(MODEL_ROOMS);
    }
  });

  it("mengembalikan daftar kosong kalau modelnya belum dibaca", () => {
    // Nol perintah adalah cara paling sunyi untuk tidak mengerjakan apa pun,
    // jadi bedanya harus terlihat: kosong, bukan null.
    expect(expandRooms("*", [])).toEqual([]);
    expect(expandRooms("*")).toEqual([]);
  });

  it("membuang nama kembar dan spasi di ujung", () => {
    expect(expandRooms("*", [" PANTRY 6 ", "PANTRY 6", "pantry 6", ""])).toEqual(["PANTRY 6"]);
  });
});

describe("expandRooms — beberapa ruangan yang disebut", () => {
  it("memisahkan daftar berkoma", () => {
    expect(expandRooms("MEETING 1, MEETING 2", MODEL_ROOMS)).toEqual(["MEETING 1", "MEETING 2"]);
  });

  it("melepas tanda kutip yang ikut terbawa", () => {
    expect(expandRooms('"MEETING 1", "PANTRY 6"', MODEL_ROOMS)).toEqual(["MEETING 1", "PANTRY 6"]);
  });

  it("koma yang hanya menyisakan satu nama bukan pengiriman berkelompok", () => {
    expect(expandRooms("MEETING 1,", MODEL_ROOMS)).toBeNull();
  });
});

describe("expandRooms — satu ruangan biasa", () => {
  it("nama tunggal tidak dimekarkan", () => {
    expect(expandRooms("LOUNGE 5", MODEL_ROOMS)).toBeNull();
    expect(expandRooms("PANTRY 6", MODEL_ROOMS)).toBeNull();
  });

  it("kosong tidak dimekarkan", () => {
    expect(expandRooms("", MODEL_ROOMS)).toBeNull();
    expect(expandRooms(undefined, MODEL_ROOMS)).toBeNull();
  });

  it("nama ruangan yang mengandung kata \"all\" tetap satu ruangan", () => {
    // "HALL" mengandung "all"; yang dibandingkan seluruh nilainya, bukan
    // sepotong di dalamnya.
    expect(expandRooms("HALL", MODEL_ROOMS)).toBeNull();
    expect(meansEveryRoom("HALL")).toBe(false);
  });
});
