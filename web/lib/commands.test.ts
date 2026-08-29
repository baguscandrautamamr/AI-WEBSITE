import { describe, expect, it } from "vitest";
import {
  COMMANDS,
  COMMANDS_BY_NAME,
  canAutoRun,
  canRun,
  placeCommandFor,
  placeValuesFrom,
} from "./commands";

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
  it("tepat lima perintah, dan kelimanya memang membaca", () => {
    const auto = COMMANDS.filter(canAutoRun).map((c) => c.name).sort();

    // Daftar HARFIAH, bukan sebuah aturan yang dihitung ulang di sini.
    //
    // Menuliskan ulang syaratnya sebagai tes berarti menguji fungsi dengan
    // fungsi yang sama, yang tidak menguji apa pun. Yang harus gagal adalah
    // perubahan katalog yang MENAMBAH sesuatu ke daftar ini tanpa ada yang
    // memutuskannya — dan yang membuatnya gagal cuma daftar yang ditulis tangan.
    //
    // Bertambah tiga pada pemindahan perintah kelistrikan dari repo
    // MCP-SERVER-BAGUS, dan itu keputusan yang diambil sadar: ketiganya tidak
    // membuka transaksi Revit dan tidak meninggalkan apa pun di PC-nya — yang
    // mereka lakukan hanya membaca sirkuit, panel, dan sebaran fasa. Sebuah
    // pertanyaan seperti "panel mana yang paling berat" memang menuntut dua
    // pembacaan berurutan, dan yang menjalankan keduanya adalah sistem.
    expect(auto).toEqual([
      "check_circuit_balance",
      "get_electrical_loads",
      "get_panel_schedule",
      "inspect",
      "query",
    ]);
  });

  it("show_element tidak, karena ia menimbulkan akibat di PC Revit", () => {
    // Lolos tiga syarat pertama — group "read", viewer, tanpa confirm — dan
    // ditolak oleh `hidden`, yang di sana dipasang justru untuk ini.
    //
    // Sebabnya sama dengan sebab print_pdf ditolak: yang ditinggalkannya bukan
    // jawaban, melainkan akibat pada komputer orang lain. View aktif seseorang
    // berpindah dan pilihannya berganti — di tengah ia menggambar, dipicu oleh
    // sebuah kalimat yang tidak pernah memintanya. Perintah ini berangkat hanya
    // kalau orangnya sendiri yang mengetik ID-nya.
    const spec = COMMANDS_BY_NAME.show_element;
    expect(spec.group).toBe("read");
    expect(spec.role).toBe("viewer");
    expect(spec.hidden).toBe(true);
    expect(canAutoRun(spec)).toBe(false);
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

/**
 * Arah kebalikan dari modifyCategoryFor: menata ulang ruangan yang ternyata
 * sudah kosong harus jadi pemasangan, bukan perintah yang berangkat lalu tidak
 * memasang apa pun.
 */
describe("placeCommandFor / placeValuesFrom", () => {
  it("setiap kategori modify punya perintah place-nya", () => {
    for (const category of COMMANDS_BY_NAME.modify_devices.fields
      .find((f) => f.name === "what")!
      .options!.filter((o) => o !== "all")) {
      expect(placeCommandFor(category), category).not.toBeNull();
    }
  });

  it("kategori yang tidak punya padanan mengembalikan null", () => {
    expect(placeCommandFor("all")).toBeNull();
    expect(placeCommandFor("mengarang")).toBeNull();
  });

  it("hanya kolom yang dideklarasikan perintah tujuannya yang ikut", () => {
    // fixture_type berarti sesuatu untuk place_lighting...
    const lighting = placeCommandFor("lighting")!;
    expect(
      placeValuesFrom(lighting, {
        room: "LOUNGE 5",
        what: "lighting",
        count: 50,
        grid: "10x5",
        height: 3,
        fixture_type: "ACT_E_DOWNLIGHT 22WATT",
      })
    ).toEqual({
      room: "LOUNGE 5",
      count: 50,
      grid: "10x5",
      height: 3,
      fixture_type: "ACT_E_DOWNLIGHT 22WATT",
    });

    // ...dan tidak ada sama sekali di place_security. Argumen yang tidak dikenal
    // adalah cara lain untuk gagal di Revit sesudah menunggu.
    const security = placeCommandFor("security")!;
    expect(placeValuesFrom(security, {
      room: "LOUNGE 5",
      what: "security",
      count: 2,
      fixture_type: "ACT_E_DOWNLIGHT 22WATT",
    })).toEqual({ room: "LOUNGE 5", count: 2 });
  });

  it("`what` tidak ikut sebagai argumen — ia yang memilih perintahnya", () => {
    const lighting = placeCommandFor("lighting")!;
    expect(placeValuesFrom(lighting, { what: "lighting", room: "X" })).not.toHaveProperty("what");
  });
});
