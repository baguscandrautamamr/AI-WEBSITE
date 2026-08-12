"use client";

import { useEffect } from "react";

/**
 * Mendaftarkan `public/sw.js`.
 *
 * Dulu ini disuntikkan otomatis oleh next-pwa. Sekarang eksplisit: satu efek,
 * di satu tempat, yang bisa dibaca tanpa menebak apa yang dilakukan plugin
 * build terhadap bundle-nya.
 *
 * Hanya di produksi. Service worker di `next dev` menyimpan aset yang berubah
 * setiap detik, dan hasilnya perubahan yang tidak muncul sampai cache-nya
 * dibersihkan manual.
 */
export default function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    // Setelah load, bukan saat render: pendaftarannya ikut berebut bandwidth
    // dengan permintaan yang benar-benar dibutuhkan halaman pertama.
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.error("[sw] gagal mendaftar", err);
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
