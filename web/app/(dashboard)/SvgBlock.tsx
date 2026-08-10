"use client";

import { useMemo } from "react";
import DOMPurify from "dompurify";
import { useI18n } from "@/lib/i18n";

/**
 * Diagram yang digambar asisten, sebagai SVG.
 *
 * Kenapa SVG dan bukan gambar dari model gambar: yang ditanyakan di halaman ini
 * adalah hal yang berdimensi — radius proteksi, jarak antar titik, tinggi
 * pemasangan. Model difusi menghasilkan gambar yang *terlihat* seperti diagram,
 * dengan angka dan simbol yang mirip dan tidak satu pun dijamin benar; untuk
 * jawaban yang mungkin dipakai seorang engineer sebagai dasar keputusan, itu
 * lebih berbahaya daripada tidak ada gambar. SVG disusun dari angka yang baru
 * saja dihitung asisten di jawaban yang sama, jadi gambarnya konsisten dengan
 * perhitungannya.
 *
 * Disaring, bukan dipercaya. Isinya memang datang dari model, bukan dari orang
 * lain — tapi ia disimpan di baris database yang juga ditulis bot Telegram, dan
 * `<script>` atau `onclick` di dalam SVG berjalan persis seperti di HTML. Jadi
 * yang masuk ke halaman hanya yang lolos DOMPurify dengan profil SVG.
 */
export default function SvgBlock({ source }: { source: string }) {
  const { t } = useI18n();

  // Selama jawaban masih mengalir, potongan SVG yang belum utuh akan
  // menghasilkan gambar rusak atau kosong. Ditunggu sampai tag penutupnya ada.
  const complete = /<\/svg\s*>/i.test(source);

  const clean = useMemo(() => {
    if (!complete) return null;
    return DOMPurify.sanitize(source, {
      USE_PROFILES: { svg: true, svgFilters: true },
      // Tidak ada alasan sebuah diagram menarik sesuatu dari luar, dan setiap
      // URL di dalamnya adalah permintaan yang memberi tahu pemiliknya siapa
      // yang sedang membaca jawaban apa.
      FORBID_TAGS: ["script", "foreignObject", "image", "use"],
      FORBID_ATTR: ["href", "xlink:href", "style"],
    });
  }, [source, complete]);

  if (!complete) {
    return <p className="text-xs opacity-60">{t("standard.drawing")}</p>;
  }

  if (!clean) return null;

  return (
    // Diagram lebar menggulir di dalam kotaknya sendiri; di HP, halaman yang
    // ikut bergeser ke samping membuat seluruh tata letak terasa rusak.
    <div
      className="svg-diagram my-2 overflow-x-auto rounded-xl bg-white p-2 dark:bg-white/90"
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
