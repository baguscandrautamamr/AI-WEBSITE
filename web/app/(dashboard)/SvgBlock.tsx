"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { useI18n } from "@/lib/i18n";
import { drawableSvg, svgSize, tightViewBox } from "@/lib/diagrams";

/** Lebar hasil PNG. Cukup untuk ditempel ke laporan tanpa terlihat pecah. */
const PNG_WIDTH = 2000;

/**
 * Berapa karakter baru sebelum gambar yang sedang mengalir digambar ulang.
 *
 * Menggambar ulang setiap potongan berarti mem-parse dan menyaring ulang seluruh
 * markup puluhan kali per detik — untuk gambar 20 KB itu beberapa milidetik
 * setiap kali, ditambah ribuan node DOM yang langsung dibuang. Halamannya jadi
 * tersendat justru selagi menunggu, yang persis kebalikan dari maksudnya.
 *
 * Dengan langkah sebesar ini, gambar biasa digambar ulang lima sampai sepuluh
 * kali sepanjang penulisannya — cukup untuk terlihat tumbuh, dan tidak sampai
 * membebani.
 */
const DRAFT_STEP = 500;

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

  const complete = /<\/svg\s*>/i.test(source);

  /**
   * Bagian gambar yang sudah boleh tampil.
   *
   * Dibulatkan ke bawah per DRAFT_STEP karakter, jadi nilainya hanya BERUBAH
   * sekali per langkah walau `source` bertambah setiap potongan — dan itulah yang
   * membuat sanitasi di bawahnya berjalan sepuluh kali, bukan seribu kali.
   * Diturunkan begitu saja dari `source`, tanpa ref dan tanpa state, supaya tidak
   * ada dua sumber kebenaran tentang apa yang sedang tampil.
   *
   * Langkah PERTAMA tidak dibulatkan. Kalau ia ikut dibulatkan, tidak ada satu
   * garis pun yang tampil sampai 500 karakter terkumpul — dan yang terlihat
   * selama itu adalah kotak putih kosong seukuran gambarnya, yang lebih mirip
   * gagal daripada sedang berjalan. Sebelum 500 karakter markup-nya masih kecil,
   * jadi menyaringnya tiap potongan tidak ada biayanya.
   */
  const windows = Math.floor(source.length / DRAFT_STEP);
  const upTo = complete || windows === 0 ? source : source.slice(0, windows * DRAFT_STEP);

  const clean = useMemo(() => {
    const markup = drawableSvg(upTo);
    if (!markup) return null;

    return DOMPurify.sanitize(markup, {
      USE_PROFILES: { svg: true, svgFilters: true },
      // Tidak ada alasan sebuah diagram menarik sesuatu dari luar, dan setiap
      // URL di dalamnya adalah permintaan yang memberi tahu pemiliknya siapa
      // yang sedang membaca jawaban apa.
      FORBID_TAGS: ["script", "foreignObject", "image", "use"],
      FORBID_ATTR: ["href", "xlink:href", "style"],
    });
  }, [upTo]);

  /**
   * viewBox dirapatkan ke isi gambarnya, setelah gambarnya jadi.
   *
   * Model menyatakan viewBox sebelum menggambar apa pun, jadi angkanya adalah
   * ruang yang ia RENCANAKAN — bukan yang akhirnya ia pakai. Selisihnya tampil
   * sebagai ruang kosong di kanan, sering dengan sisa garis tepi yang tidak
   * bertemu apa-apa: gambar yang menggantung di satu sisi kotaknya.
   *
   * Diukur dari `getBBox()`, kotak sesungguhnya dari apa yang benar-benar
   * tergambar. Jadi ini perbaikan yang tidak bergantung pada model menuruti
   * aturan mana pun — ia mengukur hasilnya, bukan memercayai niatnya.
   *
   * Atributnya diubah langsung, bukan lewat state: isinya memang ditulis dengan
   * dangerouslySetInnerHTML, jadi React tidak menggambar ulang simpul itu sampai
   * `clean` berubah — dan ketika ia berubah, efek ini ikut berjalan lagi.
   */
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!complete) return;

    const svg = box.current?.querySelector("svg");
    if (!svg) return;

    try {
      const next = tightViewBox(svg.getAttribute("viewBox"), svg.getBBox());
      if (next) svg.setAttribute("viewBox", next);
    } catch {
      // getBBox() menolak pada simpul yang belum punya tata letak — mis. ketika
      // gelembungnya sedang tersembunyi. Gambarnya tetap tampil apa adanya.
    }
  }, [clean, complete]);

  /**
   * Tinggi kotaknya sudah ditetapkan sejak viewBox terbaca.
   *
   * Tanpa ini, kotak yang tumbuh sambil digambar mendorong seluruh percakapan ke
   * bawah berkali-kali, dan karena gulirnya mengikuti bagian bawah, yang terlihat
   * adalah layar yang bergerak sendiri sepanjang gambar ditulis. Perbandingan
   * sisinya sudah diketahui dari baris pertama SVG — jauh sebelum isinya ada —
   * jadi tempatnya bisa disiapkan sekali lalu diisi tanpa menggeser apa pun.
   */
  const { width, height } = svgSize(source);
  const reserved = complete ? undefined : { aspectRatio: `${width} / ${height}` };

  // viewBox datang di baris pertama SVG, jauh sebelum ada satu elemen pun yang
  // bisa digambar. Begitu ia terbaca, tempatnya sudah bisa dipesan — dan yang
  // dipesan lebih awal tidak perlu mendorong apa pun nanti.
  const measured = /viewBox/i.test(source);

  if (!clean && !measured) {
    // Belum ada apa pun yang bisa disiapkan, bahkan ukurannya.
    return <p className="text-xs opacity-60">{t("standard.drawing")}</p>;
  }

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
      // Diambil dari simpul yang TAMPIL, bukan dari markup aslinya: viewBox-nya
      // sudah dirapatkan ke isi gambar setelah dirender, dan menyimpan dari
      // markup asli menghasilkan PNG yang membawa serta ruang kosong yang baru
      // saja dibuang dari layar.
      const drawn = box.current?.querySelector("svg")?.outerHTML ?? clean!;

      const { width, height } = svgSize(drawn);
      const scale = PNG_WIDTH / width;

      // Ukuran eksplisit disuntikkan: SVG dari model hanya membawa viewBox, dan
      // tanpa width/height sebagian browser meraster-nya pada 150px.
      const sized = drawn.replace(
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
        ref={box}
        className="svg-diagram overflow-x-auto rounded-xl bg-white p-2 dark:bg-white/90"
        style={reserved}
        dangerouslySetInnerHTML={{ __html: clean ?? "" }}
      />
      {/* Unduhan baru ditawarkan setelah gambarnya utuh: PNG dari gambar yang
          separuh adalah berkas yang terlihat benar dan isinya kurang. */}
      {complete ? (
        <button
          type="button"
          onClick={downloadPng}
          disabled={saving}
          className="text-xs text-accent underline disabled:opacity-40"
        >
          {saving ? t("standard.saving") : t("standard.savePng")}
        </button>
      ) : (
        <p className="text-xs opacity-60">{t("standard.drawing")}</p>
      )}
    </div>
  );
}
