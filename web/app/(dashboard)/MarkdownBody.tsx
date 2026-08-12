"use client";

import { isValidElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { splitHighlights } from "@/lib/highlight";
import SvgBlock from "./SvgBlock";

/**
 * Jawaban model ditulis dalam markdown — judul, tabel, tebal, daftar.
 * Menampilkannya sebagai teks polos berarti pengguna membaca sintaksnya:
 * `**IEC 60906**`, `| --- |`, `## Standar Indonesia`. Itu yang terlihat di
 * halaman Standard sebelum ini.
 *
 * remark-gfm dipakai justru karena tabel: jawaban standar hampir selalu
 * berbentuk tabel "Standar | Deskripsi", dan itu ekstensi GFM, bukan markdown
 * dasar.
 */
/**
 * Isi teks sebuah simpul React, sedalam apa pun ia bersarang.
 *
 * `<pre>` menerima `<code>` yang menerima string; kadang beberapa string kalau
 * react-markdown memecahnya. Yang dicari di sini isinya, bukan bentuknya.
 */
function textOf(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) {
    return textOf((node.props as { children?: ReactNode }).children);
  }
  return "";
}

/**
 * Sepotong teks yang memang sebuah gambar.
 *
 * Sengaja hanya menerima yang benar-benar diawali `<svg` supaya potongan HTML
 * lain — dan contoh kode yang kebetulan menyebut SVG — tetap tampil sebagai
 * kode. Tag penutupnya tidak dituntut di sini: selama jawaban masih mengalir ia
 * belum ada, dan SvgBlock yang menampilkan "sedang menggambar".
 */
function looksLikeSvg(source: string) {
  return /^\s*<svg[\s>]/i.test(source);
}

/**
 * Satu simpul hast — pohon HTML yang dipakai react-markdown sebelum ia jadi
 * elemen React. Yang dibutuhkan di sini hanya dua bentuknya.
 */
interface HastText {
  type: "text";
  value: string;
}

interface HastParent {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

type HastNode = HastText | HastParent;

/**
 * Penjaga tipe, bukan sekadar `node.type === "text"`.
 *
 * `HastParent.type` bertipe string, jadi ia mencakup "text" juga — pemeriksaan
 * biasa tidak mempersempit apa pun, dan `value` tetap terbaca `unknown`.
 */
function isText(node: HastNode): node is HastText {
  return node.type === "text" && typeof (node as HastText).value === "string";
}

/**
 * Menandai kata yang sedang dicari, sebagai <mark>.
 *
 * Dikerjakan pada POHON, bukan pada teks markdown-nya dan bukan pada DOM yang
 * sudah jadi. Ketiganya menghasilkan tampilan yang sama dan hanya satu yang
 * benar:
 *
 *   - menyisipkan <mark> ke teks markdown sebelum diurai berarti menyuntikkan
 *     HTML dari string, dan pintu itu tidak bisa dibuka sedikit saja
 *   - membungkus simpul teks di DOM setelah React menggambarnya berarti mengubah
 *     pohon yang bukan milik kita; render berikutnya menemukan simpul yang tidak
 *     ia kenali dan bisa gagal saat mencoba menggantinya
 *
 * Di sini, <mark> lahir sebagai elemen di pohon — persis seperti elemen lain
 * yang dibuat markdown-nya sendiri — jadi React tidak pernah tahu ada yang
 * istimewa.
 */
function rehypeMark(terms: string[]) {
  return function transform(tree: HastNode) {
    if (terms.length === 0) return;
    walk(tree);
  };

  function walk(node: HastNode) {
    const children = (node as { children?: HastNode[] }).children;
    if (!Array.isArray(children)) return;

    const out: HastNode[] = [];

    for (const child of children) {
      if (!isText(child)) {
        walk(child);
        out.push(child);
        continue;
      }

      const pieces = splitHighlights(child.value, terms);

      // Tidak ada yang cocok: simpulnya diteruskan apa adanya, bukan disusun
      // ulang jadi simpul baru yang isinya sama.
      if (pieces.length === 1 && !pieces[0].hit) {
        out.push(child);
        continue;
      }

      for (const piece of pieces) {
        out.push(
          piece.hit
            ? {
                type: "element",
                tagName: "mark",
                properties: {},
                children: [{ type: "text", value: piece.text }],
              }
            : { type: "text", value: piece.text }
        );
      }
    }

    (node as { children?: HastNode[] }).children = out;
  }
}

export default function Markdown({
  children,
  highlight = [],
}: {
  children: string;
  /** Kata yang sedang dicari, untuk ditandai di dalam jawabannya. */
  highlight?: string[];
}) {
  return (
    <div className="prose-chat">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={highlight.length ? [[rehypeMark, highlight]] : []}
        components={{
          // Tabel lebar menggeser tabelnya sendiri, bukan seluruh halaman.
          table: ({ node, ...props }) => (
            <div className="table-scroll">
              <table {...props} />
            </div>
          ),
          // Tautan dari model selalu dibuka di tab baru, dan tidak boleh
          // membawa referrer atau akses ke window pemanggilnya.
          a: ({ node, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer noopener" />
          ),
          // Blok berisi SVG digambar, bukan ditampilkan sebagai kode.
          //
          // Lewat sini, bukan lewat rehype-raw: rehype-raw akan membuka jalan
          // bagi SELURUH HTML yang ditulis model ke dalam halaman, sedangkan
          // yang dibutuhkan hanya satu jenis blok yang isinya disaring lebih
          // dulu. Blok kode dengan isi lain tetap tampil sebagai kode.
          //
          // Dikenali dari ISINYA, bukan dari label bahasanya. Label itu tidak
          // bisa diandalkan: model kadang menulis ```svg, kadang ```html,
          // kadang tanpa label sama sekali — dan ketiganya sama-sama gambar
          // yang gagal digambar kalau yang diperiksa cuma labelnya.
          pre: ({ node, children, ...props }) => {
            const source = textOf(children);
            if (looksLikeSvg(source)) return <SvgBlock source={source} />;
            return <pre {...props}>{children}</pre>;
          },
          code: ({ node, className, children, ...props }) => {
            const source = String(children);
            // Blok kode selalu berada di dalam <pre>, jadi yang di atas sudah
            // menanganinya. Ini untuk SVG yang muncul sebagai kode sebaris.
            if (looksLikeSvg(source)) return <SvgBlock source={source} />;
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
