"use client";

import { useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { useI18n } from "@/lib/i18n";

/** Lebar hasil PNG. Cukup untuk ditempel ke laporan tanpa terlihat pecah. */
const PNG_WIDTH = 2000;

/** Ukuran gambar menurut viewBox-nya, untuk menentukan tinggi PNG. */
function sizeOf(svg: string): { width: number; height: number } {
  const match = svg.match(/viewBox\s*=\s*["']\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (!match) return { width: 1000, height: 700 };

  const width = Number(match[3]);
  const height = Number(match[4]);
  return width > 0 && height > 0 ? { width, height } : { width: 1000, height: 700 };
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

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
  const [saving, setSaving] = useState(false);

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

  /**
   * Menyimpan diagram sebagai PNG.
   *
   * Ada tombolnya karena klik kanan tidak menawarkan "Simpan gambar": yang di
   * halaman ini bukan sebuah gambar, melainkan elemen <svg> yang digambar
   * browser. Menu itu hanya muncul untuk <img>, dan tidak ada cara membuatnya
   * muncul untuk yang lain.
   *
   * PNG, bukan SVG, karena tujuannya ditempel — ke laporan, ke WhatsApp, ke
   * berita acara. SVG lebih tajam tapi separuh aplikasi menolak membukanya.
   */
  async function downloadPng() {
    setSaving(true);
    try {
      const { width, height } = sizeOf(clean!);
      const scale = PNG_WIDTH / width;

      // Ukuran eksplisit disuntikkan: SVG dari model hanya membawa viewBox, dan
      // tanpa width/height sebagian browser meraster-nya pada 150px.
      const sized = clean!.replace(
        /<svg\b/i,
        `<svg width="${Math.round(width * scale)}" height="${Math.round(height * scale)}"`
      );

      const source = new Blob([sized], { type: "image/svg+xml;charset=utf-8" });
      const sourceUrl = URL.createObjectURL(source);

      try {
        const image = new Image();
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error("render failed"));
          image.src = sourceUrl;
        });

        const canvas = document.createElement("canvas");
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);

        const context = canvas.getContext("2d");
        if (!context) throw new Error("no canvas");

        // Latar putih: PNG dari SVG transparan tidak terbaca saat ditempel ke
        // dokumen berlatar gelap, dan diagram ini memang dirancang di atas putih.
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);

        const png = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/png")
        );
        if (!png) throw new Error("encode failed");

        saveBlob(png, "diagram.png");
      } finally {
        URL.revokeObjectURL(sourceUrl);
      }
    } catch {
      // Rasterisasi bisa gagal karena hal-hal di luar kendali halaman ini.
      // SVG-nya sendiri tetap bisa disimpan, dan itu lebih baik daripada tombol
      // yang tidak melakukan apa-apa.
      saveBlob(new Blob([clean!], { type: "image/svg+xml;charset=utf-8" }), "diagram.svg");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="my-2 space-y-1">
      {/* Diagram lebar menggulir di dalam kotaknya sendiri; di HP, halaman yang
          ikut bergeser ke samping membuat seluruh tata letak terasa rusak. */}
      <div
        className="svg-diagram overflow-x-auto rounded-xl bg-white p-2 dark:bg-white/90"
        dangerouslySetInnerHTML={{ __html: clean }}
      />
      <button
        type="button"
        onClick={downloadPng}
        disabled={saving}
        className="text-xs text-accent underline disabled:opacity-40"
      >
        {saving ? t("standard.saving") : t("standard.savePng")}
      </button>
    </div>
  );
}
