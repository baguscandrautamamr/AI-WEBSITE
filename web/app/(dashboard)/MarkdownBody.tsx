"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
export default function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-chat">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
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
          // Blok ```svg digambar, bukan ditampilkan sebagai kode.
          //
          // Lewat sini, bukan lewat rehype-raw: rehype-raw akan membuka jalan
          // bagi SELURUH HTML yang ditulis model ke dalam halaman, sedangkan
          // yang dibutuhkan hanya satu jenis blok yang isinya disaring lebih
          // dulu. Blok kode dengan bahasa lain tetap tampil sebagai kode.
          code: ({ node, className, children, ...props }) => {
            if (/\blanguage-svg\b/.test(className ?? "")) {
              return <SvgBlock source={String(children)} />;
            }
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
