import { describe, expect, it } from "vitest";
import { propose, type ModelContext } from "@/lib/propose";
import type { Role } from "@/lib/commands";
import cases from "./cases/electrical.json";

/**
 * Eval mode Electrical: apakah aturan di prompt masih berlaku.
 *
 * BUKAN bagian dari `npm test`. Suite ini memanggil model yang sungguhan, jadi
 * ia berbiaya, butuh jaringan, dan hasilnya tidak sepenuhnya sama dari satu
 * jalannya ke jalannya berikutnya. Menjalankannya di setiap PR berarti CI yang
 * kadang merah karena hal yang bukan kesalahan siapa pun — dan CI yang begitu
 * berhenti dibaca dalam dua minggu. Jalannya: `npm run eval` lokal, atau
 * Actions → Eval → Run workflow. MANUAL, tidak berjadwal — lihat sebabnya di
 * .github/workflows/eval.yml.
 *
 * Yang dipanggil `propose()` — fungsi yang SAMA dengan yang dipakai
 * /api/ai/electrical. Bukan tiruannya. Itu seluruh sebab fungsi itu dikeluarkan
 * dari route-nya: eval yang menguji salinan logika akan lulus sementara yang
 * dipakai pengguna sudah bergeser.
 *
 * Yang TIDAK diuji di sini: wewenang, batas laju, dan bentuk HTTP. Ketiganya di
 * route dan tidak melibatkan model.
 */

interface Expectation {
  kind?: string;
  kindIn?: string[];
  command?: string;
  commandIn?: string[];
  values?: Record<string, string | number | boolean>;
  /** Argumen yang harus TIDAK ada — atau ada tapi kosong. */
  absent?: string[];
  /** Regex atas seluruh argumen sebagai JSON. */
  valuesMatch?: string;
  valuesNotMatch?: string;
  /** Regex atas teks jawaban / catatan. */
  textMatches?: string;
  autoRun?: boolean;
  rooms?: string[];
}

interface Case {
  name: string;
  why?: string[];
  role?: Role;
  message: string;
  history?: { role: string; content: string }[];
  context?: ModelContext;
  expect: Expectation;
}

const suite = cases as unknown as { context: ModelContext; cases: Case[] };

/**
 * Tanpa kunci gateway, suite ini DILEWATI — tidak gagal.
 *
 * Bedanya penting: seorang kontributor yang menjalankan `npm run eval` tanpa
 * kunci harus diberi tahu bahwa ia melewatinya, bukan diberi tumpukan merah yang
 * tidak berhubungan dengan perubahannya.
 */
const hasKey = Boolean(process.env.AI_GATEWAY_API_KEY);

/** Satu kasus dinilai; mengembalikan daftar keluhan, kosong berarti lulus. */
function check(payload: Record<string, unknown>, want: Expectation): string[] {
  const bad: string[] = [];
  const kind = String(payload.kind ?? "");
  const command = String(payload.command ?? "");
  const values = (payload.values ?? {}) as Record<string, unknown>;
  const valuesJson = JSON.stringify(values);

  if (want.kind && kind !== want.kind) bad.push(`kind=${kind}, diharap ${want.kind}`);
  if (want.kindIn && !want.kindIn.includes(kind)) {
    bad.push(`kind=${kind}, diharap salah satu dari ${want.kindIn.join("/")}`);
  }
  if (want.command && command !== want.command) {
    bad.push(`command=${command || "(tidak ada)"}, diharap ${want.command}`);
  }
  if (want.commandIn && !want.commandIn.includes(command)) {
    bad.push(`command=${command || "(tidak ada)"}, diharap salah satu dari ${want.commandIn.join("/")}`);
  }

  for (const [key, expected] of Object.entries(want.values ?? {})) {
    // Dibandingkan sebagai teks: model bisa mengirim 3 atau "3" untuk tinggi,
    // dan keduanya sama benarnya — `buildPayload` yang menormalkannya.
    const actual = values[key];
    if (String(actual) !== String(expected)) {
      bad.push(`${key}=${JSON.stringify(actual)}, diharap ${JSON.stringify(expected)}`);
    }
  }

  for (const key of want.absent ?? []) {
    const actual = values[key];
    if (actual !== undefined && actual !== null && actual !== "") {
      bad.push(`${key} seharusnya tidak diisi, tapi berisi ${JSON.stringify(actual)}`);
    }
  }

  if (want.valuesMatch && !new RegExp(want.valuesMatch, "i").test(valuesJson)) {
    bad.push(`argumen tidak memuat /${want.valuesMatch}/ — ${valuesJson}`);
  }
  if (want.valuesNotMatch && new RegExp(want.valuesNotMatch, "i").test(valuesJson)) {
    bad.push(`argumen seharusnya TIDAK memuat /${want.valuesNotMatch}/ — ${valuesJson}`);
  }

  if (want.textMatches) {
    const said = `${payload.text ?? ""}\n${payload.note ?? ""}`;
    if (!new RegExp(want.textMatches, "i").test(said)) {
      bad.push(`teks tidak memuat /${want.textMatches}/ — "${said.trim().slice(0, 200)}"`);
    }
  }

  if (want.autoRun !== undefined && payload.autoRun !== want.autoRun) {
    bad.push(`autoRun=${payload.autoRun}, diharap ${want.autoRun}`);
  }

  if (want.rooms) {
    const items = (payload.items ?? []) as { room?: string }[];
    const rooms = items.map((i) => i.room).sort();
    const expected = [...want.rooms].sort();
    if (JSON.stringify(rooms) !== JSON.stringify(expected)) {
      bad.push(`ruangan=${JSON.stringify(rooms)}, diharap ${JSON.stringify(expected)}`);
    }
  }

  return bad;
}

describe.skipIf(!hasKey)("eval: mode Electrical", () => {
  if (!hasKey) {
    console.warn("AI_GATEWAY_API_KEY tidak ada — eval Electrical dilewati.");
  }

  for (const kase of suite.cases) {
    /**
     * Dua percobaan, dan hanya gagal kalau KEDUANYA gagal.
     *
     * Model bahasa tidak menghasilkan hal yang sama persis setiap kali, dan
     * suite yang gagal sesekali tanpa sebab adalah suite yang orang berhenti
     * membacanya — sesudah itu ia tidak menjaga apa pun. Sebuah pergeseran yang
     * NYATA gagal dua kali; sebuah kebetulan tidak.
     *
     * Percobaan kedua hanya dijalankan kalau yang pertama gagal, jadi jalannya
     * yang normal tetap satu panggilan per kasus.
     */
    it(
      kase.name,
      async () => {
        const attempts: string[][] = [];

        for (let attempt = 0; attempt < 2; attempt++) {
          const result = await propose({
            role: kase.role ?? "editor",
            message: kase.message,
            history: kase.history,
            context: kase.context ?? suite.context,
          });

          if (!result.ok) {
            attempts.push([`gateway gagal: ${result.error}`]);
            continue;
          }

          const bad = check(result.payload, kase.expect);
          if (bad.length === 0) return;

          attempts.push([...bad, `payload: ${JSON.stringify(result.payload).slice(0, 400)}`]);
        }

        // Keluhan KEDUA percobaan ikut dilaporkan, beserta alasan kasus ini ada.
        // Kalau keduanya gagal dengan cara yang BERBEDA, itu keterangan
        // tersendiri: bukan satu aturan yang bergeser, melainkan model yang
        // sedang tidak stabil di kasus ini — dan yang membacanya perlu tahu
        // bedanya sebelum memutuskan mengubah prompt.
        const why = (kase.why ?? []).join(" ");
        expect.fail(
          [
            `${kase.name} — gagal 2 dari 2 percobaan`,
            why && `KENAPA KASUS INI ADA: ${why}`,
            ...attempts.map((a, i) => `percobaan ${i + 1}: ${a.join("; ")}`),
          ]
            .filter(Boolean)
            .join("\n")
        );
      },
      120_000
    );
  }
});
