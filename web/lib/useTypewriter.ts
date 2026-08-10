"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Menampilkan teks yang tumbuh dengan kecepatan tetap, bukan bergelombang.
 *
 * Jawaban dari API datang sebagai potongan yang besarnya tidak beraturan: satu
 * potongan bisa satu kata, potongan berikutnya satu paragraf penuh. Ditampilkan
 * apa adanya, yang terlihat bukan orang mengetik melainkan teks yang menyentak —
 * diam beberapa saat, lalu satu blok muncul sekaligus. Itu terasa seperti
 * aplikasi yang tersendat, padahal jaringannya normal.
 *
 * Yang ditahan hanya TAMPILANNYA. Teks lengkapnya sudah ada di state pemanggil
 * sejak potongannya datang, jadi tidak ada yang bisa hilang kalau komponennya
 * dilepas di tengah jalan.
 *
 * Kecepatannya dihitung dari sisa yang belum tampil, bukan tetap per karakter:
 * jawaban panjang tetap selesai dalam waktu yang wajar, dan begitu aliran
 * berhenti, sisanya menyusul tanpa membuat pembaca menunggu animasi.
 */
export function useTypewriter(full: string, active: boolean) {
  const [shown, setShown] = useState(active ? "" : full);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    // Selesai atau tidak sedang mengalir: tampilkan utuh. Ini juga jalan yang
    // dipakai saat riwayat dimuat ulang — percakapan kemarin tidak perlu
    // "diketik" ulang di depan pembacanya.
    if (!active) {
      setShown(full);
      return;
    }

    let cancelled = false;

    function step() {
      if (cancelled) return;

      setShown((current) => {
        if (current.length >= full.length) return full;

        // Aliran yang jauh di depan dikejar lebih cepat, dengan lantai 2
        // karakter supaya jawaban pendek pun tetap bergerak.
        const behind = full.length - current.length;
        const stride = Math.max(2, Math.round(behind / 12));
        return full.slice(0, current.length + stride);
      });

      frame.current = requestAnimationFrame(step);
    }

    frame.current = requestAnimationFrame(step);

    return () => {
      cancelled = true;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [full, active]);

  // Teks yang menyusut berarti gelembung ini dipakai untuk jawaban lain —
  // menahannya di panjang yang lama akan menampilkan sisa jawaban sebelumnya.
  return shown.length > full.length ? full : shown;
}
