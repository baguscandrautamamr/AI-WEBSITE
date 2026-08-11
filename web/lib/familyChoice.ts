import { familyCategoryOf, type CommandSpec } from "./commands";
import { familiesFor, matchFamily } from "./families";

/**
 * Family yang ditebak model, diperiksa terhadap isi model yang sebenarnya.
 *
 * Ini menutup satu lubang yang tidak bisa ditutup oleh prompt sebaik apa pun:
 * "pasang lampu downlight" tidak menyebut family mana pun, dan model harus
 * memilih satu. Ia memilih yang paling masuk akal — dan yang paling masuk akal
 * bukan selalu yang benar. Kesalahannya tidak pernah dilaporkan: add-in yang
 * tidak menemukan nama itu memakai family bawaannya, melaporkan enam armatur
 * terpasang, dan yang salah baru terlihat di gambar.
 *
 * Jadi tebakannya tidak diteruskan. Kalau ia cocok dengan satu family di model,
 * namanya dirapikan jadi ejaan model dan perintahnya jalan. Kalau tidak,
 * perintahnya DITAHAN dan daftar family kategori itu ditawarkan di percakapan —
 * satu ketukan, bukan mengisi ulang formulir. Yang memilih tetap orangnya,
 * karena hanya dia yang tahu family mana yang benar untuk proyeknya.
 */
export interface FamilyQuestion {
  /** Kolom yang harus dijawab, mis. `fixture_type`. */
  field: string;
  /** Kategori family-nya, mis. `lighting`. */
  category: string;
  /** Nama yang tadi ditebak model. */
  guessed: string;
  /** Family yang ada di model untuk kategori itu. */
  choices: string[];
}

export interface FamilyResolution {
  /** Nilai perintah dengan nama family yang sudah dirapikan ke ejaan model. */
  values: Record<string, unknown>;
  /** Ada kalau masih harus ditanyakan; perintahnya belum boleh berangkat. */
  question: FamilyQuestion | null;
}

export function resolveFamilies(
  spec: CommandSpec,
  values: Record<string, unknown>,
  familyTypes: Record<string, string[]> | undefined | null
): FamilyResolution {
  const out = { ...values };

  /**
   * Perintah baca tidak pernah ditahan oleh pertanyaan ini.
   *
   * Yang dilindungi pertanyaan itu adalah gambar: nama yang tidak dikenali
   * berakhir sebagai family bawaan add-in terpasang di plafon, dan itu tidak
   * bisa dibatalkan dari sini. Sebuah pembacaan tidak memasang apa pun. Yang
   * terburuk yang bisa terjadi adalah jawaban yang terlalu luas atau nol baris —
   * dan add-in sudah mencocokkan sebagian nama sendiri lalu menyebutkan family
   * apa saja yang sebenarnya ada, yang persis merupakan jawaban atas pertanyaan
   * yang akan diajukan di sini.
   *
   * Menahannya berarti "ada berapa downlight?" dijawab dengan sebuah pertanyaan.
   */
  const asks = spec.role !== "viewer";

  for (const field of spec.fields) {
    const category = familyCategoryOf(field, out);
    if (!category) continue;

    const guessed = typeof out[field.name] === "string" ? (out[field.name] as string).trim() : "";
    if (!guessed) continue;

    // Model belum pernah dibaca: tidak ada daftar untuk membandingkan, dan
    // menahan perintah karena daftar yang tidak kita punya hanya menambah satu
    // penghalang tanpa menambah satu pun kepastian.
    const families = familiesFor(familyTypes, category);
    if (!families.length) continue;

    const match = matchFamily(families, guessed);
    if (match.kind === "exact") {
      out[field.name] = match.name;
      continue;
    }

    // Ejaan yang tidak dikenali diteruskan apa adanya ke add-in, yang akan
    // mencocokkan sebagiannya dan melaporkan apa yang dipakai.
    if (!asks) continue;

    return {
      values: out,
      question: { field: field.name, category, guessed, choices: match.choices },
    };
  }

  return { values: out, question: null };
}
