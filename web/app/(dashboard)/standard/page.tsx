"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { splitDiagrams } from "@/lib/diagrams";
import { matchesQuery, searchTerms } from "@/lib/search";
import { splitHighlights } from "@/lib/highlight";
import { useTypewriter } from "@/lib/useTypewriter";
import Markdown from "../Markdown";
import SvgBlock from "../SvgBlock";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

/**
 * Satu jawaban model: teksnya sebagai markdown, gambarnya sebagai gambar.
 *
 * Pemisahannya di sini, bukan di dalam Markdown, karena sebuah gambar tidak
 * selalu datang sebagai blok kode — kadang ia datang sebagai markup mentah, atau
 * di dalam pembungkus tool-call yang tidak pernah kami minta. Markdown tidak
 * bisa mengenali bentuk-bentuk itu; ia hanya melihat teks, dan teks itulah yang
 * ia tampilkan.
 */
function Answer({
  text,
  typing,
  highlight,
}: {
  text: string;
  typing: boolean;
  /** Kata yang sedang dicari, untuk ditandai di dalam jawabannya. */
  highlight: string[];
}) {
  // Ditampilkan rata, bukan bergelombang. Potongan dari API besarnya tidak
  // beraturan; apa adanya, yang terlihat bukan orang mengetik melainkan teks
  // yang menyentak — dan itu terasa seperti aplikasi yang tersendat.
  const shown = useTypewriter(text, typing);
  const segments = splitDiagrams(shown);

  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === "svg" ? (
          // Gambar tidak "diketik" huruf demi huruf; ia digambar bertahap oleh
          // SvgBlock, yang tahu bagian mana dari markup yang sudah aman tampil.
          <SvgBlock key={index} source={segment.value} />
        ) : (
          <Markdown key={index} highlight={highlight}>
            {segment.value}
          </Markdown>
        ),
      )}

      {/* Tanda bahwa jawabannya masih ditulis.
       *
       * Dulu ini sebuah kursor "|" di ujung teks, dan bentuk itu punya dua
       * masalah yang keduanya terlihat di layar. Ia hanya tampil selama
       * `shown.length < text.length` — dan syarat itu berganti benar-salah
       * berkali-kali per detik, karena pengetiknya rutin menyusul aliran lalu
       * menunggu potongan berikutnya. Jadi kursornya muncul-hilang puluhan kali,
       * dan karena ia elemen sebaris di ujung kalimat, tiap kemunculannya
       * mengubah lebar baris terakhir — sesekali cukup untuk melipat baris dan
       * mengubah tinggi seluruh gelembung. Yang terlihat: chat yang bergetar.
       *
       * Sekarang ia tanda tunggu sungguhan, dan letaknya pada barisnya sendiri:
       * muncul sekali saat jawabannya mulai, hilang sekali saat selesai, dan
       * tidak pernah menyentuh susunan teks di atasnya. */}
      {typing && (
        <span className="mt-1 flex gap-1" aria-hidden>
          <i className="dot" />
          <i className="dot" style={{ animationDelay: "0.15s" }} />
          <i className="dot" style={{ animationDelay: "0.3s" }} />
        </span>
      )}
    </>
  );
}

/**
 * Teks polos dengan bagian yang dicari ditandai.
 *
 * Untuk gelembung pertanyaan, yang isinya bukan markdown melainkan apa yang
 * diketik orangnya — termasuk baris barunya, yang dijaga `whitespace-pre-wrap`
 * di gelembungnya.
 */
function Marked({ text, terms }: { text: string; terms: string[] }) {
  if (terms.length === 0) return <>{text}</>;

  return (
    <>
      {splitHighlights(text, terms).map((piece, index) =>
        piece.hit ? <mark key={index}>{piece.text}</mark> : <span key={index}>{piece.text}</span>
      )}
    </>
  );
}

export default function StandardPage() {
  const { t } = useI18n();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  /**
   * Apa yang sedang dicari di dalam utas ini.
   *
   * Terpisah dari kotak pertanyaan di bawah, dan sengaja: yang satu mengirim
   * sesuatu ke model, yang satu lagi tidak mengirim apa-apa. Digabung jadi satu
   * kotak — "ketik untuk bertanya atau mencari" — keduanya jadi menakutkan untuk
   * ditekan Enter.
   */
  const [find, setFind] = useState("");
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);

  /**
   * Apakah gulirnya masih mengikuti jawaban yang sedang ditulis.
   *
   * Ada karena jawaban yang mengalir membuat efek gulir berjalan puluhan kali,
   * dan tiap kali ia menarik layar kembali ke bawah. Akibatnya, justru selama
   * menunggu — satu-satunya waktu orang punya jeda untuk membaca lagi
   * percakapan sebelumnya — layar tidak bisa digulir ke atas sama sekali:
   * potongan teks berikutnya menariknya turun lagi dalam sepersekian detik.
   *
   * Sebuah ref, bukan state: nilainya dibaca di dalam efek gulir dan tidak
   * boleh memicu render ulang setiap kali jari bergerak.
   */
  const following = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  // Utas tersimpan di standards_threads, jadi percakapan kemarin masih ada
  // saat halaman dibuka lagi — termasuk yang dimulai dari Telegram.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/ai/standard");
        if (!res.ok) return;
        const { turns } = (await res.json()) as {
          turns: { role: "user" | "assistant"; text: string }[];
        };
        setMessages(turns.map((x) => ({ role: x.role, content: x.text })));
        // Utas lama dibuka di bagian paling bawah, bukan di paling atas: yang
        // dicari orang saat membuka lagi adalah lanjutan percakapannya, dan
        // menggulir sendiri melewati jawaban kemarin adalah pekerjaan yang
        // tidak perlu ada. Tanpa jeda, gulirnya terjadi sebelum gelembungnya
        // punya tinggi.
        requestAnimationFrame(() => bottom.current?.scrollIntoView({ block: "end" }));
      } catch {
        // Riwayat kosong bukan kegagalan yang perlu ditampilkan; halaman tetap
        // bisa dipakai untuk bertanya.
      }
    })();
  }, []);

  // Tanpa "smooth": efek ini berjalan tiap potongan teks datang, dan animasi
  // gulir yang dimulai ulang puluhan kali per jawaban terlihat gemetar.
  //
  // Hanya kalau pembacanya memang sedang berada di bawah. Menggulir ke atas
  // adalah cara orang mengatakan "saya sedang membaca yang lain"; menariknya
  // turun setelah itu bukan membantu, itu mengambil kembali kendali yang baru
  // saja ia pakai.
  useEffect(() => {
    if (following.current) bottom.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  /**
   * Menandai posisi guliran setiap kali daftarnya digulir.
   *
   * Ambangnya 80 piksel, bukan nol: "di bawah" bagi pembaca tidak sama dengan
   * di bawah bagi browser — satu baris teks baru yang datang saat ia persis di
   * dasar sudah cukup membuat jaraknya tidak lagi nol, dan tanpa ambang itu
   * gulirnya berhenti mengikuti tepat ketika seharusnya paling mengikuti.
   */
  function onListScroll() {
    const element = list.current;
    if (!element) return;

    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    following.current = distance < 80;
    setAtBottom(following.current);
  }

  /** Kembali mengikuti, dan turun ke jawaban terbaru. */
  function jumpToLatest() {
    following.current = true;
    setAtBottom(true);
    bottom.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }

  /**
   * Mengosongkan utas, di layar dan di server sekaligus.
   *
   * Utas ini dipakai bersama bot Telegram dan menjadi konteks pertanyaan
   * berikutnya, jadi mengosongkannya hanya di layar akan membuat jawaban
   * berikutnya tetap merujuk percakapan yang sudah tidak terlihat.
   */
  async function clearChat() {
    if (clearing || loading) return;
    if (!window.confirm(t("standard.clearConfirm"))) return;

    setClearing(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/standard", { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? t("standard.clearFailed"));
        return;
      }
      setMessages([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("standard.clearFailed"));
    } finally {
      setClearing(false);
    }
  }

  async function send() {
    const question = input.trim();
    if (!question || loading) return;

    // Mengirim pertanyaan berarti minta melihat jawabannya. Kalau gulirnya
    // ditinggal di tempat pembacanya berhenti membaca tadi, pertanyaan yang
    // baru dikirim muncul di luar layar dan halamannya tampak tidak menanggapi.
    following.current = true;
    setAtBottom(true);

    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setInput("");
    setLoading(true);
    setError(null);

    // Mode Standard TIDAK PERNAH menulis ke commands_queue —
    // ini murni chat ke LLM, tidak menyentuh Revit sama sekali.
    try {
      const res = await fetch("/api/ai/standard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: question }),
      });

      // Kegagalan sebelum aliran dimulai masih berupa JSON biasa.
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? t("standard.failed"));
        return;
      }

      // Gelembung jawaban dibuat kosong lebih dulu lalu diisi sambil jalan,
      // supaya kalimat pertama sudah bisa dibaca saat sisanya masih ditulis.
      let index = -1;
      setMessages((prev) => {
        index = prev.length;
        return [...prev, { role: "assistant", content: "" }];
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const consume = (line: string) => {
        if (!line.trim()) return;
        let chunk: { t?: string; e?: string };
        try {
          chunk = JSON.parse(line);
        } catch {
          return; // Baris terpotong yang tidak pernah selesai; abaikan.
        }

        if (chunk.e) {
          setError(chunk.e);
          return;
        }
        if (!chunk.t) return;

        setMessages((prev) =>
          prev.map((m, i) => (i === index ? { ...m, content: m.content + chunk.t } : m))
        );
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Satu objek JSON per baris; yang terakhir bisa belum utuh, jadi
        // disimpan sampai potongan berikutnya datang.
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        lines.forEach(consume);
      }
      consume(buffer);

      // Jawaban yang berakhir kosong berarti tidak ada yang datang sama sekali;
      // gelembung kosong lebih membingungkan daripada tidak ada gelembung.
      setMessages((prev) => prev.filter((m, i) => i !== index || m.content.length > 0));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("standard.failed"));
    } finally {
      setLoading(false);
    }
  }

  // Yang tampil saat sedang mencari. Nomor aslinya dibawa serta supaya kunci
  // React tetap menunjuk giliran yang sama — tanpa itu, mengetik satu huruf
  // membuat React memakai ulang gelembung untuk isi yang berbeda.
  const shown = messages
    .map((m, index) => ({ m, index }))
    .filter(({ m }) => matchesQuery(m.content, find));

  const searching = find.trim().length > 0;
  const terms = searchTerms(find);

  return (
    // Selebar dan setinggi area yang tersedia. Jawaban standar sering memuat
    // tabel dan daftar bertingkat, dan kolom sempit membuat tiap barisnya
    // terlipat sampai tabelnya tidak terbaca lagi.
    // Tinggi layar dikurangi tempat yang dipakai menu: di HP menu ada di atas
    // dan ikut memakan tinggi, di layar lebar ia di samping dan tidak.
    <div
      className="glass-panel flex h-[calc(100vh-9rem)] w-full flex-col space-y-4 p-4
                 md:h-[calc(100vh-3rem)] md:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-medium">{t("standard.title")}</h1>
          <p className="text-sm text-text-secondary">{t("standard.subtitle")}</p>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={clearChat}
            disabled={clearing || loading}
            className="text-xs text-red-500 underline disabled:opacity-40"
          >
            {clearing ? t("standard.clearing") : t("standard.clear")}
          </button>
        )}
      </div>

      {/* Pencarian di dalam utas.
          Hanya muncul kalau memang ada yang bisa dicari — sebuah kolom cari di
          atas percakapan kosong cuma menambah satu hal untuk diabaikan. */}
      {messages.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            className="glass-input min-w-[12rem] flex-1"
            placeholder={t("standard.findPlaceholder")}
            value={find}
            onChange={(e) => setFind(e.target.value)}
          />
          {searching && (
            <span className="text-xs text-text-secondary">
              {shown.length > 0
                ? t("standard.findCount").replace("{n}", String(shown.length))
                : t("standard.findNone")}
            </span>
          )}
          {searching && (
            <button
              type="button"
              onClick={() => setFind("")}
              className="text-xs text-accent underline"
            >
              {t("standard.findClear")}
            </button>
          )}
        </div>
      )}

      {/* relative: tombol "turun ke terbaru" mengapung di atas daftar ini, dan
          harus ikut daftarnya — bukan halamannya. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={list} onScroll={onListScroll} className="flex-1 space-y-2 overflow-auto">
          {shown.map(({ m, index: i }) => (
            <div
              key={i}
              className={`rounded-2xl px-3 py-2 text-sm ${
                m.role === "user"
                  ? // `w-fit`, bukan hanya `ml-auto`.
                    //
                    // Sebuah div itu block: lebarnya `auto` berarti mengisi
                    // penuh, dan `margin-left: auto` pada kotak yang sudah
                    // selebar induknya dihitung jadi nol. Jadi "HELLO" tampil
                    // sebagai pita biru selebar layar yang isinya satu kata di
                    // ujung kiri — rata kanannya pun tidak terjadi.
                    //
                    // `max-w-[80%]` tetap: yang panjang melipat di 80%, bukan
                    // memanjang jadi satu baris sampai ke tepi.
                    "bg-accent text-white ml-auto w-fit max-w-[80%] whitespace-pre-wrap"
                  : "glass-input max-w-[92%]"
              }`}
            >
              {m.role === "user" ? (
              // Pertanyaan bukan markdown — ia teks apa adanya — jadi
              // penandaannya di sini, bukan lewat perender markdown.
              <Marked text={m.content} terms={terms} />
            ) : (
              /* Hanya gelembung TERAKHIR yang diketik, dan hanya selagi mengalir.
                 Jawaban lama sudah selesai; mengetiknya ulang setiap render
                 akan membuat percakapan kemarin bergerak sendiri. */
              <Answer
                text={m.content}
                typing={loading && i === messages.length - 1}
                highlight={terms}
              />
            )}
            </div>
          ))}
          {/* Gelembung menunggu, sampai huruf pertama datang. Sesudah itu teks
              yang tumbuh sendiri sudah menunjukkan jawabannya sedang ditulis, dan
              indikator kedua di bawahnya hanya menambah kesibukan di layar.
              Bentuknya sengaja sama dengan gelembung jawaban supaya jelas di situ
              jawabannya akan muncul. */}
          {loading && messages[messages.length - 1]?.content === "" && (
            <div className="glass-input flex max-w-[92%] items-center gap-2 rounded-2xl text-sm">
              <span className="flex gap-1" aria-hidden>
                <i className="dot" />
                <i className="dot" style={{ animationDelay: "0.15s" }} />
                <i className="dot" style={{ animationDelay: "0.3s" }} />
              </span>
              <span className="text-xs opacity-60">{t("standard.thinking")}</span>
            </div>
          )}
          <div ref={bottom} />
        </div>

        {/* Kalau pembacanya sedang di atas, jawaban yang datang di bawah tidak
            terlihat sama sekali. Tombol ini yang menyebutkan bahwa ada sesuatu
            di bawah sana, dan sekaligus jalan kembali ke sana — mencari dasar
            halaman dengan jari sambil teksnya masih memanjang itu tidak mudah. */}
        {!atBottom && messages.length > 0 && (
          <button
            type="button"
            onClick={jumpToLatest}
            className="glass-input absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-xs shadow-lg"
          >
            {loading ? t("standard.jumpWriting") : t("standard.jumpLatest")}
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex gap-2">
        <input
          className="glass-input flex-1"
          placeholder={t("standard.placeholder")}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button onClick={send} disabled={loading} className="btn-accent">
          {t("standard.send")}
        </button>
      </div>
    </div>
  );
}
