import path from "node:path";
import { defineConfig } from "vitest/config";

// Hanya `lib/` yang diuji: di situlah logika yang berdiri sendiri berada —
// validasi command dan penyusunan riwayat chat. Komponen dan route handler
// butuh Next dan Supabase yang hidup, dan tiruan keduanya lebih rapuh daripada
// yang diamankannya.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
