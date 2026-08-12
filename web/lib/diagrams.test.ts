import { describe, expect, it } from "vitest";
import { drawableSvg, splitDiagrams, svgSize, tightViewBox } from "./diagrams";

const svg = '<svg viewBox="0 0 100 60"><rect x="10" y="10" width="20" height="20"/></svg>';

describe("splitDiagrams", () => {
  it("leaves an answer with no diagram alone", () => {
    const text = "PUIL 2011 pasal 4.3 mensyaratkan tahanan pembumian ≤ 5 Ω.";
    expect(splitDiagrams(text)).toEqual([{ kind: "text", value: text }]);
  });

  it("pulls a diagram out of a fenced block without leaving the fence behind", () => {
    const segments = splitDiagrams(`Berikut diagramnya:\n\n\`\`\`svg\n${svg}\n\`\`\`\n\nUkur tiap 6 bulan.`);

    expect(segments.map((s) => s.kind)).toEqual(["text", "svg", "text"]);
    expect(segments[1].value).toBe(svg);
    expect(segments[0].value).not.toContain("```");
    expect(segments[2].value).not.toContain("```");
  });

  it("draws a diagram that arrived as bare markup, outside any code block", () => {
    const segments = splitDiagrams(`Skema pembumian:\n\n${svg}`);

    expect(segments.map((s) => s.kind)).toEqual(["text", "svg"]);
    expect(segments[1].value).toBe(svg);
  });

  /**
   * Bentuk yang benar-benar sampai ke layar pengguna: pemanggilan tool yang
   * tidak pernah didefinisikan, SVG-nya di dalam string JSON, baris barunya
   * sebagai dua karakter.
   */
  it("rescues the diagram from a tool-call wrapper and throws the wrapper away", () => {
    const escaped = '<svg viewBox="0 0 100 60">\\n  <text x="5" y="5">Grounding</text>\\n</svg>';
    const segments = splitDiagrams(
      `[TOOL_CALL] {"name": "diagram", "input": {"svg": "${escaped}" }} [/TOOL_CALL]`,
    );

    expect(segments).toHaveLength(1);
    expect(segments[0].kind).toBe("svg");
    expect(segments[0].value).toContain("\n  <text");
    expect(segments[0].value).not.toContain("\\n");
    expect(segments[0].value).not.toContain("TOOL_CALL");
  });

  it("keeps the prose around a tool-call wrapper", () => {
    const segments = splitDiagrams(
      `Skema pembumian TN-S:\n\n[TOOL_CALL] {"input": {"svg": "${svg}"}} [/TOOL_CALL]\n\nTahanan ≤ 5 Ω.`,
    );

    expect(segments.map((s) => s.kind)).toEqual(["text", "svg", "text"]);
    expect(segments[0].value).toContain("TN-S");
    expect(segments[2].value).toContain("5 Ω");
    expect(segments.some((s) => s.value.includes("TOOL_CALL"))).toBe(false);
  });

  it("drops the punctuation the wrapper leaves behind", () => {
    const segments = splitDiagrams(`{"svg": "${svg}" }}`);
    expect(segments).toEqual([{ kind: "svg", value: svg }]);
  });

  it("handles a wrapper the answer was cut off inside", () => {
    const segments = splitDiagrams(`Ini gambarnya:\n[TOOL_CALL] {"svg": "${svg}"`);

    expect(segments.map((s) => s.kind)).toEqual(["text", "svg"]);
    expect(segments[1].value).toBe(svg);
  });

  it("keeps more than one diagram, in the order they arrived", () => {
    const second = svg.replace("100 60", "200 90");
    const segments = splitDiagrams(`Satu:\n${svg}\nDua:\n${second}`);

    expect(segments.map((s) => s.kind)).toEqual(["text", "svg", "text", "svg"]);
    expect(segments[1].value).toBe(svg);
    expect(segments[3].value).toBe(second);
  });

  /**
   * Baris baru sungguhan berarti SVG-nya tidak pernah melewati string JSON, dan
   * `\n` yang ada di dalamnya adalah isi — sebuah label yang memang berbunyi
   * begitu. Membukanya justru akan mengubah gambar yang sudah benar.
   */
  it("leaves a well-formed diagram untouched even when it contains a backslash-n", () => {
    const source = '<svg viewBox="0 0 100 60">\n  <text x="5" y="5">C:\\new</text>\n</svg>';
    const segments = splitDiagrams(source);

    expect(segments).toEqual([{ kind: "svg", value: source }]);
  });

  it("does not mistake prose that merely mentions a brace for scaffolding", () => {
    const text = "{ ini kalimat yang diawali kurung kurawal dan tetap harus terbaca }";
    expect(splitDiagrams(text)).toEqual([{ kind: "text", value: text }]);
  });

  /**
   * Selama jawabannya mengalir, `</svg>` belum ada. Kalau potongan itu
   * diperlakukan sebagai teks, yang terlihat beberapa detik adalah sintaksis
   * SVG mentah memanjang di layar.
   */
  it("treats a diagram still being written as a diagram", () => {
    const partial = '<svg viewBox="0 0 100 60"><rect x="10"';
    const segments = splitDiagrams(`Menggambar:\n${partial}`);

    expect(segments.map((s) => s.kind)).toEqual(["text", "svg"]);
    expect(segments[1].value).toBe(partial);
  });

  /**
   * Pagar pembuka blok kode tidak boleh tertinggal di teks selama gambarnya
   * ditulis.
   *
   * Kalau ia tertinggal, markdown melihat blok kode yang tidak pernah ditutup
   * dan menggambar kotak abu-abu kosong selebar gelembung — di tempat gambarnya
   * akan muncul, selama seluruh waktu gambar itu ditulis. Yang terlihat: sebuah
   * kotak kosong dan tulisan "sedang menggambar" di bawahnya.
   */
  it("does not leave the opening fence behind while the diagram is still arriving", () => {
    const segments = splitDiagrams(
      'Berikut diagramnya:\n\n```svg\n<svg viewBox="0 0 800 500"><rect x="10"'
    );

    expect(segments.map((s) => s.kind)).toEqual(["text", "svg"]);
    expect(segments[0].value).not.toContain("```");
    expect(segments[0].value.trim()).toBe("Berikut diagramnya:");
  });

  it("drops a fence that is the only thing before the diagram", () => {
    const segments = splitDiagrams('```svg\n<svg viewBox="0 0 800 500"><g');

    expect(segments.map((s) => s.kind)).toEqual(["svg"]);
  });
});

describe("drawableSvg — gambar yang masih ditulis", () => {
  // Ini yang mengubah satu menit "sedang menggambar" jadi gambar yang tumbuh.
  // Diagram berdimensi memakan beberapa ribu token, dan tidak ada cara membuat
  // model menulisnya lebih cepat — yang bisa diubah adalah apakah orangnya
  // menonton sesuatu terjadi atau menonton sebuah kalimat.
  it("memotong tag yang belum selesai, lalu menutup gambarnya", () => {
    expect(drawableSvg('<svg viewBox="0 0 10 10"><rect x="1" y="1"/><line x1="2')).toBe(
      '<svg viewBox="0 0 10 10"><rect x="1" y="1"/></svg>'
    );
  });

  it("gambar yang baru punya tag pembuka jadi kotak kosong seukurannya", () => {
    // Bukan kesia-siaan: kotak itulah yang memesan tempat, jadi isinya nanti
    // tidak mendorong percakapan di bawahnya.
    expect(drawableSvg('<svg viewBox="0 0 800 500">')).toBe('<svg viewBox="0 0 800 500"></svg>');
  });

  it("tidak menambah penutup kedua pada gambar yang sudah utuh", () => {
    const whole = '<svg viewBox="0 0 10 10"><rect/></svg>';
    expect(drawableSvg(whole)).toBe(whole);
  });

  it("belum ada satu tag pun: tidak ada yang bisa digambar", () => {
    expect(drawableSvg('<svg viewBox="0 0 10')).toBe("");
    expect(drawableSvg("")).toBe("");
  });
});

describe("svgSize", () => {
  it("membaca viewBox", () => {
    expect(svgSize('<svg viewBox="0 0 1000 640">')).toEqual({ width: 1000, height: 640 });
  });

  it("viewBox dengan koma dan spasi berlebih tetap terbaca", () => {
    expect(svgSize('<svg viewBox=" 0, 0, 800, 500 ">')).toEqual({ width: 800, height: 500 });
  });

  it("tanpa viewBox: perbandingan mendatar, bentuk yang diminta prompt", () => {
    // Dipakai untuk memesan tempat sebelum viewBox-nya terbaca, jadi tebakan
    // yang sedikit salah jauh lebih baik daripada nol.
    expect(svgSize("<svg>")).toEqual({ width: 1000, height: 700 });
    expect(svgSize('<svg viewBox="0 0 0 0">')).toEqual({ width: 1000, height: 700 });
  });
});

describe("tightViewBox — ruang kosong yang tidak diminta siapa pun", () => {
  // Model menyatakan viewBox SEBELUM menggambar, jadi angkanya adalah ruang yang
  // ia rencanakan. Ketika gambarnya selesai lebih kecil, sisanya tetap ada — dan
  // yang terlihat adalah gambar yang menggantung di kiri dengan garis tepi
  // berserakan di kanan.
  it("merapatkan gambar yang cuma mengisi separuh ruangnya", () => {
    const next = tightViewBox("0 0 1000 640", { x: 0, y: 0, width: 500, height: 300 });
    expect(next).toBe("-10 -10 520 320");
  });

  it("membiarkan gambar yang sudah mengisi ruangnya", () => {
    // Merapatkan yang sudah rapat cuma menggeser semuanya satu-dua piksel
    // setiap render, dan pergeseran yang tidak memperbaiki apa pun tetap
    // sebuah pergeseran.
    expect(tightViewBox("0 0 1000 640", { x: 0, y: 0, width: 980, height: 630 })).toBeNull();
  });

  it("isi yang tidak dimulai dari nol ikut digeser", () => {
    expect(tightViewBox("0 0 1000 1000", { x: 200, y: 100, width: 300, height: 200 })).toBe(
      "194 94 312 212"
    );
  });

  it("gambar tanpa viewBox tetap diberi satu", () => {
    expect(tightViewBox(null, { x: 0, y: 0, width: 100, height: 50 })).toBe("-2 -2 104 54");
  });

  it("isi yang tidak punya ukuran tidak diapa-apakan", () => {
    // getBBox() pada gambar yang belum tergambar mengembalikan nol, dan viewBox
    // selebar nol adalah gambar yang hilang sama sekali.
    expect(tightViewBox("0 0 10 10", { x: 0, y: 0, width: 0, height: 0 })).toBeNull();
    expect(tightViewBox("0 0 10 10", { x: 0, y: 0, width: 5, height: 0 })).toBeNull();
  });
});
