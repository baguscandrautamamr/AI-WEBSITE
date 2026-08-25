import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * `.env.local` dibaca sendiri, karena vitest TIDAK membacanya.
 *
 * Diuji, bukan dikira: dengan AI_GATEWAY_API_KEY di `.env.local`, seluruh suite
 * tetap dilewati — dan yang terlihat orangnya adalah 19 tes yang di-skip tanpa
 * sebab yang jelas, padahal kuncinya sudah ia taruh di tempat yang dipakai
 * `next dev`. Itu setengah jam yang hilang untuk sesuatu yang bukan soal
 * kualitas jawaban.
 *
 * Yang dikirim lewat perintah MENANG atas yang di file: satu jalannya dengan
 * kunci lain — model lain, gateway lain — harus bisa dilakukan tanpa menyunting
 * apa pun.
 *
 * Kenapa tidak dipasang di vitest.config.mts juga: `npm test` sengaja tidak
 * boleh menyentuh jaringan. Sebuah suite yang perilakunya berubah karena ada
 * atau tidaknya sebuah file env bukan suite yang merahnya selalu berarti sama.
 */
for (const file of [".env.local", ".env"]) {
  const at = path.resolve(__dirname, file);
  if (!fs.existsSync(at)) continue;

  for (const line of fs.readFileSync(at, "utf8").split("\n")) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match || line.trim().startsWith("#")) continue;

    const [, key, raw] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw.trim().replace(/^(['"])(.*)\1$/, "$2");
  }
}

/**
 * Konfigurasi TERPISAH untuk eval, dan pemisahannya bukan soal kerapian.
 *
 * `npm test` harus tetap cepat, gratis, dan pasti: 371 tes yang jalan dalam dua
 * detik tanpa jaringan, dan yang merahnya SELALU berarti ada kode yang salah.
 * Eval memanggil model sungguhan — berbiaya, butuh jaringan, dan hasilnya tidak
 * sepenuhnya sama dari satu jalannya ke jalannya berikutnya. Digabung, sifat
 * pertama hilang: CI jadi kadang merah karena hal yang bukan kesalahan siapa
 * pun, dan CI yang begitu berhenti dibaca dalam dua minggu.
 *
 * Jadi dua perintah, dua arti:
 *   npm test  — apakah kodenya benar. Di setiap push.
 *   npm run eval — apakah PERILAKU MODELNYA masih seperti yang kami rancang.
 *                  Sekali sehari, dan sebelum menaikkan AI_MODEL.
 */
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    environment: "node",
    include: ["evals/**/*.eval.ts"],
    // Satu file pada satu waktu, dan di dalamnya berurutan: yang dijaga bukan
    // kecepatan melainkan batas laju gateway. Belasan permintaan serentak dari
    // satu kunci adalah cara membuat suite ini gagal karena 429 dan menyebutnya
    // regresi.
    fileParallelism: false,
    // Model bisa berpikir lama pada permintaan gambar. Batas bawaan 5 detik
    // akan menggagalkan hampir semuanya.
    testTimeout: 180_000,
    hookTimeout: 60_000,
    // Satu percobaan per kasus dari sisi vitest; pengulangannya diurus di dalam
    // kasusnya sendiri, supaya kedua kegagalannya bisa dilaporkan bersama.
    retry: 0,
  },
});
