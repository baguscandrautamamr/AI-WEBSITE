import { describe, expect, it } from "vitest";
import { COMMANDS, COMMANDS_BY_NAME, canAutoRun, canRun } from "./commands";

/**
 * Tes ini menjaga satu pertanyaan: perintah mana yang boleh dijalankan sistem
 * tanpa seorang manusia menekan apa pun.
 *
 * Bukan tes gaya. `canAutoRun` adalah pagar rantai baca berantai, dan
 * kegagalannya berbentuk perintah yang MENGUBAH model orang lain berjalan
 * sendiri, beberapa kali, di tengah satu pertanyaan yang tidak pernah meminta
 * itu. Karena syaratnya diturunkan dari katalog — bukan dari daftar nama —
 * sebuah perintah baru yang salah dikelompokkan akan lolos tanpa ada yang
 * mengubah satu baris pun di fungsi itu. Yang menangkapnya harus tes ini.
 */
describe("canAutoRun", () => {
  it("tepat dua perintah, dan keduanya memang membaca", () => {
    const auto = COMMANDS.filter(canAutoRun).map((c) => c.name).sort();

    // Daftar HARFIAH, bukan sebuah aturan yang dihitung ulang di sini.
    //
    // Menuliskan ulang syaratnya sebagai tes berarti menguji fungsi dengan
    // fungsi yang sama, yang tidak menguji apa pun. Yang harus gagal adalah
    // perubahan katalog yang MENAMBAH sesuatu ke daftar ini tanpa ada yang
    // memutuskannya — dan yang membuatnya gagal cuma daftar yang ditulis tangan.
    expect(auto).toEqual(["inspect", "query"]);
  });

  it("tidak satu pun perintah yang mengubah model", () => {
    const writers = COMMANDS.filter(
      (c) => c.group === "device" || c.group === "layout"
    );

    // Semua place_*, cable tray, hangers, equip_room, modify, delete, undo.
    expect(writers.length).toBeGreaterThan(10);
    for (const spec of writers) {
      expect(canAutoRun(spec), `${spec.name} tidak boleh berjalan sendiri`).toBe(false);
    }
  });

  it("yang menulis berkas ke disk PC Revit juga tidak", () => {
    // print_pdf, export_cad, export: membaca model, ya — tapi akibatnya sebuah
    // berkas di komputer orang lain, dan berkas yang ditimpa tidak kembali.
    for (const name of ["print_pdf", "export_cad", "export"]) {
      expect(canAutoRun(COMMANDS_BY_NAME[name]), name).toBe(false);
    }
  });

  it("perintah tersembunyi tidak, walaupun ia berkelompok read", () => {
    // model_info: group "read", role viewer, tanpa confirm — lolos tiga syarat
    // pertama, dan tetap ditolak karena `hidden`. Ia tidak pernah ditawarkan
    // sebagai tool (lihat toolsForRole), jadi ini penjagaan atas sesuatu yang
    // seharusnya tidak mungkin — dan tetap dinyatakan.
    expect(COMMANDS_BY_NAME.model_info.group).toBe("read");
    expect(COMMANDS_BY_NAME.model_info.hidden).toBe(true);
    expect(canAutoRun(COMMANDS_BY_NAME.model_info)).toBe(false);
  });

  it("yang butuh konfirmasi tidak, apa pun kelompoknya", () => {
    for (const spec of COMMANDS.filter((c) => c.confirm)) {
      expect(canAutoRun(spec), spec.name).toBe(false);
    }
  });

  it("yang boleh berjalan sendiri selalu boleh dijalankan seorang viewer", () => {
    // Konsekuensi yang harus tetap benar: rantai baca berjalan dengan peran
    // pemanggilnya, dan seorang viewer adalah peran terendah yang ada. Sebuah
    // perintah auto-run yang menuntut editor akan ditolak /api/commands di
    // tengah rantai — untuk pengguna, itu rantai yang mati tanpa sebab.
    for (const spec of COMMANDS.filter(canAutoRun)) {
      expect(canRun(spec, "viewer"), spec.name).toBe(true);
    }
  });
});
