"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
