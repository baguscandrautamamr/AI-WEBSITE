"use client";

import dynamic from "next/dynamic";

/**
 * Pembungkus malas untuk perender markdown.
 *
 * react-markdown + remark-gfm berukuran puluhan kilobyte, dan halaman yang
 * paling sering dibuka — Electrical, Export — tidak menampilkan markdown apa pun
 * sampai ada jawaban asisten. Mengimpornya secara statis berarti setiap orang
 * mengunduhnya sebelum melihat satu kalimat pun. Dimuat saat benar-benar ada
 * yang dirender, halaman-halaman itu kembali ringan.
 *
 * ssr:false karena isinya murni tampilan: tidak ada yang berubah kalau server
 * ikut merendernya, dan mengeluarkannya dari bundel server memangkas satu
 * salinan lagi.
 */
const MarkdownBody = dynamic(() => import("./MarkdownBody"), {
  ssr: false,
  // Teks apa adanya selama modulnya dimuat: isinya sudah terbaca, hanya belum
  // tertata. Itu lebih baik daripada gelembung kosong yang berkedip.
  loading: () => null,
});

export default function Markdown({
  children,
  highlight,
}: {
  children: string;
  /** Kata yang sedang dicari, untuk ditandai di dalam jawabannya. */
  highlight?: string[];
}) {
  return <MarkdownBody highlight={highlight}>{children}</MarkdownBody>;
}
