import { describe, expect, it } from "vitest";
import { toolsForRole } from "./aiTools";
import { buildPayload } from "./queue";
import { COMMANDS_BY_NAME } from "./commands";

/**
 * Kontrak antara website dan add-in `electrical_ai`, untuk empat perintah yang
 * dipindahkan dari repo MCP-SERVER-BAGUS.
 *
 * Yang dijaga di sini adalah hal yang tidak bisa dilihat dari salah satu sisi
 * saja: handler C#-nya ditulis di repo lain, terhadap `command_json` yang
 * dibentuk file-file ini, dan spesifikasinya ada di
 * `docs/addin-electrical-commands.md`. Sebuah perubahan katalog yang mengganti
 * nama kunci atau membuat sebuah default ikut terkirim tidak akan menggagalkan
 * apa pun di sini — ia akan menggagalkan sesuatu di PC Revit orang lain,
 * berminggu-minggu kemudian, sebagai perintah yang argumennya tidak dikenali.
 */
describe("kontrak add-in — perintah kelistrikan", () => {
  it("ketiganya ditawarkan sebagai tool kepada model, show_element tidak", () => {
    // Ketiganya membaca saja, jadi seorang viewer pun boleh — dan itu yang
    // membuat rantai baca berantai bisa menjawab tanpa menunggu siapa pun.
    const names = toolsForRole("viewer").map((t) => t.name);
    for (const n of ["get_electrical_loads", "get_panel_schedule", "check_circuit_balance"]) {
      expect(names, n).toContain(n);
    }

    // show_element menimbulkan akibat di PC Revit — view aktif seseorang
    // berpindah — jadi ia tidak boleh berangkat dari sebuah kalimat.
    expect(names).not.toContain("show_element");
  });

  it("default katalog tidak ikut terkirim kalau tidak diisi", () => {
    // Inilah sebab spesifikasi add-in menuntut "kunci tidak ada = pakai
    // bawaan", dan kenapa bawaan di kedua sisi harus angka yang sama. Kalau
    // add-in menganggap `tolerance` yang hilang berarti 0, setiap panel akan
    // dilaporkan tidak seimbang.
    const { payload, commandText } = buildPayload(COMMANDS_BY_NAME.check_circuit_balance, {});
    expect(payload).toEqual({});
    expect(commandText).toBe("/check_circuit_balance");
  });

  it("kolom yang tidak berlaku tidak ikut berangkat", () => {
    // `limit` dan `include_element_ids` hanya berarti untuk detail=list.
    // Keduanya ikut terkirim pada detail=summary berarti add-in menerima
    // argumen yang tidak dipakainya — dan versi add-in yang menolak argumen
    // asing akan menolak seluruh perintahnya.
    const { payload } = buildPayload(COMMANDS_BY_NAME.get_electrical_loads, {
      detail: "summary",
      limit: 50,
      include_element_ids: true,
    });
    expect(payload).toEqual({ detail: "summary" });
  });

  it("nama panel bersepasi tetap terbaca utuh di command_text", () => {
    // command_text inilah yang dibaca orang di Riwayat dan disalin ke Telegram.
    // Tanpa tanda kutip, "PP-1 LANTAI 2" terbaca sebagai panel "PP-1" dengan
    // dua potongan menggantung oleh parser mana pun yang memecah per spasi.
    const { commandText } = buildPayload(COMMANDS_BY_NAME.get_panel_schedule, {
      panel: "PP-1 LANTAI 2",
      detail: "list",
    });
    expect(commandText).toBe('/get_panel_schedule "PP-1 LANTAI 2" detail=list');
  });

  it("nama family TIDAK dipangkas untuk perintah baca", () => {
    // Perintah yang MEMASANG memangkas "Family: Type" jadi nama family saja.
    // Perintah yang MEMBACA tidak boleh: presisinya justru yang diminta.
    // Ketiganya berperan viewer, dan itu yang menahannya (lihat
    // normalizesFamily di queue.ts).
    for (const n of ["get_electrical_loads", "get_panel_schedule", "check_circuit_balance"]) {
      expect(COMMANDS_BY_NAME[n].role, n).toBe("viewer");
    }
  });
});

describe("kontrak add-in — show_element", () => {
  it("ID dinormalkan sebelum berangkat", () => {
    const { payload, commandText } = buildPayload(COMMANDS_BY_NAME.show_element, {
      ids: " 384210 , 384215 ",
      view: "3d",
    });
    // Add-in cukup memecah per koma: spasinya sudah hilang di sini.
    expect(payload.ids).toBe("384210,384215");
    expect(commandText).toBe("/show_element 384210,384215 view=3d");
  });

  it("view=current tetap berangkat apa adanya", () => {
    const { payload } = buildPayload(COMMANDS_BY_NAME.show_element, {
      ids: "384210",
      view: "current",
    });
    expect(payload).toEqual({ ids: "384210", view: "current" });
  });
});
