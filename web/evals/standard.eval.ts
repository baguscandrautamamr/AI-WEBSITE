import { describe, expect, it } from "vitest";
import { MODEL, llm, tokenCap } from "@/lib/llm";
import { redoReason, strayWords } from "@/lib/history";
import { buildSources, type FoundChunk } from "@/lib/standards";
import { STANDARD_MAX_TOKENS, systemPrompt } from "@/app/api/ai/standard/route";

/**
 * Eval mode Standar: apakah jawabannya masih berbentuk jawaban.
 *
 * Tiga kegagalan yang sudah benar-benar sampai ke layar pengguna, dan masing-
 * masing sudah punya pendeteksinya di lib/history.ts. Yang belum ada: sesuatu
 * yang memberi tahu SEBELUM penggunanya yang memberi tahu.
 *
 *   penanda "[diagram]" alih-alih gambar   → redoReason()
 *   kata beraksara asing di tengah kalimat → strayWords()
 *   kutipan yang tidak menunjuk apa pun    → dicek di sini
 *
 * Pendeteksinya dipakai apa adanya, bukan ditulis ulang: kalau ambangnya
 * bergeser, eval ini harus bergeser bersamanya — kalau tidak, ia menjaga aturan
 * yang sudah tidak berlaku.
 *
 * BUKAN bagian dari `npm test`. Lihat catatan di evals/electrical.eval.ts.
 */

const hasKey = Boolean(process.env.AI_GATEWAY_API_KEY);

/**
 * Satu pertanyaan, satu jawaban — dengan parameter yang SAMA dengan route.
 *
 * `systemPrompt` dan `STANDARD_MAX_TOKENS` diimpor dari route-nya, bukan
 * disalin. Yang tersisa di sini cuma bentuk pemanggilannya, dan itu sengaja
 * dijaga sama: streaming, karena jawaban mode ini memuat gambar SVG utuh dan
 * permintaan non-streaming sebesar itu menabrak batas waktu HTTP.
 */
async function ask(question: string, locale: "id" | "en" = "id"): Promise<string> {
  const stream = await llm.chat.completions.create({
    model: MODEL,
    ...tokenCap(STANDARD_MAX_TOKENS),
    stream: true,
    messages: [
      { role: "system", content: systemPrompt(locale) },
      { role: "user", content: question },
    ],
  });

  let text = "";
  for await (const chunk of stream) {
    const piece = chunk.choices?.[0]?.delta?.content;
    if (typeof piece === "string") text += piece;
  }
  return text.trim();
}

/** Sumber palsu, supaya kutipan bisa diuji tanpa korpus sungguhan. */
const chunk = (over: Partial<FoundChunk>): FoundChunk => ({
  doc_code: "PUIL 2011",
  doc_title: "Persyaratan Umum Instalasi Listrik",
  doc_edition: "2011",
  heading: "3.24.2.1 Warna penghantar",
  page: 142,
  content: "Penghantar netral harus diberi warna biru muda.",
  rank: 1,
  ...over,
});

/** Bentuk giliran pengguna yang sama dengan yang disusun route saat ada sumber. */
function withSources(question: string, chunks: FoundChunk[]): string {
  const { block } = buildSources(chunks);
  return (
    `SUMBER dari perpustakaan dokumen standar sistem ini:\n\n${block}\n\n` +
    `--- akhir SUMBER ---\n\nPERTANYAAN: ${question}`
  );
}

describe.skipIf(!hasKey)("eval: mode Standar", () => {
  if (!hasKey) {
    console.warn("AI_GATEWAY_API_KEY tidak ada — eval Standar dilewati.");
  }

  it(
    "permintaan gambar menghasilkan gambar, bukan penanda [diagram]",
    async () => {
      const question = "Gambarkan skema pembumian sistem TN-S untuk gedung 3 lantai.";
      const reply = await ask(question);

      // Pendeteksi yang sama yang dipakai route untuk memutuskan menulis ulang.
      // Kalau ia menyala di sini, ia akan menyala di produksi — dan di produksi
      // harganya satu jawaban yang dihapus di depan mata penggunanya.
      const redo = redoReason(reply, question, "id");

      expect(
        redo?.notice ?? null,
        `redoReason menyala — jawaban ini akan ditulis ulang di produksi.\n` +
          `Potongan jawaban: ${reply.slice(0, 300)}`
      ).toBeNull();

      // Dan memang ada gambarnya, bukan cuma tidak ada penandanya.
      expect(/```(svg|cards)/.test(reply), `tidak ada blok svg/cards di jawaban`).toBe(true);
    },
    180_000
  );

  it(
    "sekumpulan hal sejenis digambar sebagai kartu, bukan SVG",
    async () => {
      // Aturan KISI KARTU ada karena sembilan kartu sebagai SVG berarti belasan
      // koordinat dihitung sambil menulis, tanpa melihat hasilnya — dan satu
      // yang meleset menghasilkan dua kartu yang saling menimpa. Sudah terjadi
      // berkali-kali.
      const reply = await ask("Tunjukkan jenis-jenis socket outlet internasional beserta simbolnya.");
      expect(/```cards/.test(reply), `diharap blok cards, dapat:\n${reply.slice(0, 400)}`).toBe(
        true
      );
    },
    180_000
  );

  it(
    "tidak ada kata beraksara asing di tengah jawaban",
    async () => {
      // Kalimat "Mau saya bantu hitung количество flexible bonding braid" sudah
      // benar-benar sampai ke layar pengguna. Satu kata asing membuat seluruh
      // jawaban tidak bisa dipercaya, dan ia tidak punya cara menebak artinya.
      const question =
        "Jelaskan fungsi flexible bonding braid pada busbar dan berapa banyak yang biasanya dipakai.";
      const reply = await ask(question);
      const stray = strayWords(reply, question);

      expect(
        stray?.words ?? null,
        `kata beraksara ${stray?.script} muncul di jawaban: ${stray?.words.join(", ")}`
      ).toBeNull();
    },
    180_000
  );

  it(
    "jawaban dari sumber MENUNJUK nomornya",
    async () => {
      const reply = await ask(
        withSources("Apa warna penghantar netral menurut PUIL?", [chunk({})])
      );

      expect(
        /\[1\]/.test(reply),
        `tidak ada kutipan [1] di jawaban yang sumbernya memuat jawabannya:\n${reply.slice(0, 400)}`
      ).toBe(true);
      expect(/biru/i.test(reply), `jawabannya tidak menyebut warna dari sumber`).toBe(true);
    },
    180_000
  );

  it(
    "sumber yang TIDAK memuat jawabannya tidak dikutip",
    async () => {
      /**
       * Kegagalan yang paling mahal dari seluruh fitur RAG, dan yang paling
       * mudah terjadi: menjawab dari ingatan lalu menempelkan [1] padanya.
       *
       * Nomor kutipan yang menunjuk sumber yang tidak mengatakannya bukan
       * sekadar salah — ia mengundang orang memeriksanya, lalu menyesatkan
       * pemeriksaannya. Lebih buruk daripada tidak ada kutipan sama sekali.
       *
       * Sumbernya di sini soal warna penghantar; pertanyaannya soal hal yang
       * sama sekali lain.
       */
      const reply = await ask(
        withSources("Berapa suhu maksimum operasi kabel XLPE 20 kV?", [chunk({})])
      );

      expect(
        /\[1\]/.test(reply),
        `sumber tentang warna penghantar dikutip untuk pertanyaan tentang suhu XLPE:\n` +
          reply.slice(0, 400)
      ).toBe(false);
    },
    180_000
  );

  it(
    "tanpa sumber, nomor pasal tidak dijual sebagai kepastian",
    async () => {
      // Aturan NOMOR PASAL DAN ANGKA TABEL: yang tidak diyakini disebut isinya
      // tanpa nomornya, dan jawaban yang memuat nomor pasal ditutup satu kalimat
      // bahwa nomornya perlu dicek di dokumen aslinya.
      const reply = await ask("Pasal berapa di PUIL yang mengatur proteksi kejut listrik?");

      const hedged =
        /cek|periksa|verifikasi|dokumen asli|tidak yakin|kurang yakin|pastikan/i.test(reply);

      expect(
        hedged,
        `jawaban menyebut nomor pasal tanpa satu pun kalimat bahwa itu perlu dicek:\n` +
          reply.slice(0, 500)
      ).toBe(true);
    },
    180_000
  );
});
