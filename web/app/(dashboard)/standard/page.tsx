"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { splitDiagrams } from "@/lib/diagrams";
import { matchesQuery, searchTerms } from "@/lib/search";
import { splitHighlights } from "@/lib/highlight";
import { useTypewriter } from "@/lib/useTypewriter";
import ChatInput from "../ChatInput";
import {
  AttachButton,
  AttachmentStrip,
  imagesFromClipboard,
  useImageIntake,
  type Attachment,
} from "./ImagePicker";
import { MAX_IMAGES } from "@/lib/imageInput";
import Markdown from "../Markdown";
import SvgBlock from "../SvgBlock";

interface Msg {
  role: "user" | "assistant";
  content: string;
  /**
   * Gambar yang dikirim bersama pertanyaan ini, sebagai data URL.
   *
   * Hidup selama halaman terbuka saja. Riwayat di server hanya menyimpan
   * keterangan bahwa ada gambar (lihat `attachmentNote`), jadi setelah dimuat
   * ulang yang tersisa adalah pertanyaan dan jawabannya — bukan fotonya. Itu
   * disengaja: satu foto di dalam kolom JSON dibaca ulang setiap kali halaman
   * dibuka dan setiap kali giliran berikutnya dikirim.
   */
  images?: string[];
  /**
   * Kenapa jawaban ini ditulis ulang, kalau memang ditulis ulang.
   *
   * Ada karena tanpa ini yang terlihat adalah jawaban selesai ditulis, hilang,
   * lalu ditulis lagi hampir sama — dan pengguna tidak punya cara menebak apa
   * yang terjadi. Satu baris keterangan mengubah "aplikasinya rusak" menjadi
   * "ada yang diperbaiki".
   */
  notice?: string;
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
  /** Gambar yang sudah dipilih tapi belum terkirim. */
  const [attachments, setAttachments] = useState<Attachment[]>([]);
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

  /**
   * Kecocokan sebagai TITIK di dalam teks, bukan sebagai gelembung.
   *
   * "1 cocok" dulu berarti satu gelembung yang memuat kata itu — dan sebuah
   * gelembung jawaban standar bisa setinggi beberapa layar. Jadi angkanya benar
   * sementara yang dicari tetap berada di luar layar, dan orangnya tetap harus
   * menggulir mencarinya sendiri. Yang dihitung sekarang adalah setiap <mark>
   * yang benar-benar tergambar, dan yang sedang dituju dibawa ke tengah layar.
   *
   * Diambil dari DOM, bukan dihitung ulang dari teksnya: penandanya dipasang
   * dua perender berbeda (Markdown untuk jawaban, Marked untuk pertanyaan), dan
   * hitungan kedua yang meleset satu saja menunjuk ke tempat yang salah.
   */
  const marks = useRef<HTMLElement[]>([]);
  const [hitCount, setHitCount] = useState(0);
  const [hitIndex, setHitIndex] = useState(0);

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

  /**
   * Mengumpulkan penanda yang tergambar untuk kata kunci saat ini.
   *
   * useLayoutEffect: DOM-nya sudah jadi tapi layar belum digambar, jadi
   * kecocokan pertama tidak sempat terlihat "meloncat" dari posisi lama.
   */
  useLayoutEffect(() => {
    // `find` dibaca langsung, bukan lewat `searching` di bawah: sebuah const
    // yang dipakai di daftar dependensi sebelum barisnya dijalankan adalah
    // ReferenceError, dan halaman ini tidak akan tergambar sama sekali.
    const found =
      find.trim().length > 0
        ? Array.from(list.current?.querySelectorAll<HTMLElement>("mark") ?? [])
        : [];
    marks.current = found;
    setHitCount(found.length);
    setHitIndex(0);
  }, [find, messages]);

  /** Yang sedang dituju: ditandai lain dari yang lain, lalu dibawa ke layar. */
  useLayoutEffect(() => {
    const found = marks.current;
    found.forEach((el, i) => el.classList.toggle("mark-active", i === hitIndex));

    const target = found[hitIndex];
    if (!target) return;

    // Selama mencari, guliran tidak boleh ditarik balik ke dasar oleh efek
    // "ikuti jawaban terbaru" — yang dilihat orangnya ada di tengah utas.
    following.current = false;
    setAtBottom(false);
    target.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [hitIndex, hitCount]);

  /** Kecocokan berikutnya (atau sebelumnya), berputar di ujungnya. */
  function stepHit(delta: number) {
    if (hitCount === 0) return;
    setHitIndex((prev) => (prev + delta + hitCount) % hitCount);
  }

  /**
   * Menempel gambar langsung dari papan klip — Snipping Tool, Print Screen,
   * "salin gambar" dari peramban.
   *
   * Penyimaknya di seluruh dokumen, bukan hanya di kolom tulis. Alurnya memang
   * begitu: orang menekan Win+Shift+S, memilih area, lalu Ctrl+V — dan di
   * antara keduanya tidak ada yang menyuruhnya mengklik kolom tulis lebih dulu.
   * Kalau penyimaknya menempel di kolom itu saja, tempelannya tidak terjadi dan
   * tidak ada satu pun keterangan kenapa.
   *
   * Tempelan TEKS tidak pernah disentuh: `imagesFromClipboard` mengembalikan
   * daftar kosong untuk teks, dan tanpa gambar fungsi ini langsung keluar —
   * jadi menempel kata kunci ke kolom cari tetap bekerja seperti biasa.
   */
  const intake = useImageIntake(setError);

  useEffect(() => {
    async function onPaste(event: ClipboardEvent) {
      const pasted = imagesFromClipboard(event.clipboardData);
      if (pasted.length === 0) return;

      // Sedang menunggu jawaban: tombol lampirkan pun mati saat itu, dan
      // gambar yang diterima diam-diam sementara tombolnya mati adalah dua
      // aturan berbeda untuk satu hal yang sama.
      if (loading) return;

      // Hanya kalau ada gambarnya. Dipanggil lebih awal, ia membatalkan
      // tempelan teks di kolom mana pun di halaman ini.
      event.preventDefault();

      const accepted = await intake(pasted, MAX_IMAGES - attachments.length);
      if (accepted.length > 0) setAttachments((prev) => [...prev, ...accepted]);
    }

    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [intake, attachments.length, loading]);

  /**
   * Berhenti mencari, dan kembali ke tempat percakapan ditinggalkan.
   *
   * Mengosongkan kotak cari saja meninggalkan guliran di tengah utas lama,
   * padahal yang dimaksud orangnya dengan "kosongkan" adalah kembali ke
   * percakapannya — bukan tetap di baris yang tadi ia periksa.
   */
  function clearFind() {
    setFind("");
    following.current = true;
    setAtBottom(true);
    requestAnimationFrame(() => bottom.current?.scrollIntoView({ block: "end" }));
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
    // Gambar tanpa satu kata pun tetap pertanyaan yang sah — "ini apa?" memang
    // tidak perlu diketik kalau fotonya sudah ada. Yang ditolak cuma yang
    // benar-benar kosong.
    if ((!question && attachments.length === 0) || loading) return;

    // Mengirim pertanyaan berarti minta melihat jawabannya. Kalau gulirnya
    // ditinggal di tempat pembacanya berhenti membaca tadi, pertanyaan yang
    // baru dikirim muncul di luar layar dan halamannya tampak tidak menanggapi.
    following.current = true;
    setAtBottom(true);

    // Saringan pencarian dibuka, dan itu bukan kerapian.
    //
    // Daftar yang tampil disaring oleh kata kunci: selama masih ada isinya,
    // pertanyaan yang baru dikirim dan jawaban yang sedang ditulis hanya
    // tergambar kalau kebetulan memuat kata itu. Yang terlihat orangnya adalah
    // Enter yang tidak menghasilkan apa-apa — bukan pencarian yang menyembunyikan
    // jawabannya.
    if (find) setFind("");

    const sending = attachments;
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: question,
        images: sending.length > 0 ? sending.map((a) => a.preview) : undefined,
      },
    ]);
    setInput("");
    setAttachments([]);
    setLoading(true);
    setError(null);

    // Mode Standard TIDAK PERNAH menulis ke commands_queue —
    // ini murni chat ke LLM, tidak menyentuh Revit sama sekali.
    try {
      const res = await fetch("/api/ai/standard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: question,
          images: sending.map(({ media_type, data }) => ({ media_type, data })),
        }),
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
        let chunk: {
          t?: string;
          e?: string;
          reset?: boolean;
          why?: string;
          fix?: [string, string][];
        };
        try {
          chunk = JSON.parse(line);
        } catch {
          return; // Baris terpotong yang tidak pernah selesai; abaikan.
        }

        if (chunk.e) {
          setError(chunk.e);
          return;
        }

        // Percobaan pertama gagal menggambar dan sedang diulang.
        //
        // Yang sudah tampil dihapus, bukan ditambahi: tanpa ini, jawaban kedua
        // tersambung di belakang jawaban pertama yang gagal, dan pengguna
        // membaca judul yang sama dua kali dengan penanda kosong di tengahnya.
        if (chunk.reset) {
          setMessages((prev) =>
            prev.map((m, i) => (i === index ? { ...m, content: "", notice: chunk.why } : m))
          );
          return;
        }

        /**
         * Satu-dua kata diganti di tempatnya, tanpa menghapus jawabannya.
         *
         * Ini yang menggantikan tulis-ulang untuk kasus kata beraksara asing.
         * Sisa jawabannya tidak salah, jadi tidak ada alasan membuangnya — dan
         * jawaban yang selesai lalu hilang lalu kembali hampir sama adalah hal
         * yang dua kali dilaporkan sebagai bug.
         */
        if (chunk.fix) {
          const fixes = chunk.fix;
          const why = chunk.why;
          setMessages((prev) =>
            prev.map((m, i) =>
              i === index
                ? {
                    ...m,
                    content: fixes.reduce(
                      (text, [from, to]) => text.split(from).join(to),
                      m.content
                    ),
                    notice: why,
                  }
                : m
            )
          );
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
    /**
     * Gelembung jawaban yang masih kosong tidak digambar.
     *
     * Ia dibuat begitu server membalas, lalu berdiri kosong sampai potongan
     * pertama datang — dan selama itu isinya cuma tiga titik yang berkedip.
     * Bersama gelembung "Menyusun jawaban…" di bawahnya, yang terlihat adalah
     * DUA penanda menunggu bertumpuk, seolah ada dua hal yang sedang terjadi.
     * Satu penantian, satu penanda.
     */
    .filter(({ m }) => !(m.role === "assistant" && m.content === ""))
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
            // Enter di kotak CARI tidak mengirim apa pun ke model — ia pindah ke
            // kecocokan berikutnya, kebiasaan yang sama dengan Ctrl+F di mana
            // pun. Esc berhenti mencari.
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                stepHit(e.shiftKey ? -1 : 1);
              }
              if (e.key === "Escape") clearFind();
            }}
          />
          {searching && (
            <span className="text-xs text-text-secondary">
              {hitCount > 0
                ? t("standard.findPosition")
                    .replace("{i}", String(hitIndex + 1))
                    .replace("{n}", String(hitCount))
                : t("standard.findNone")}
            </span>
          )}
          {/* Maju-mundur antar kecocokan. Ada karena satu gelembung jawaban bisa
              memuat kata yang sama belasan kali, dan "yang mana" cuma bisa
              dijawab dengan melihatnya satu per satu. */}
          {searching && hitCount > 1 && (
            <span className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => stepHit(-1)}
                aria-label={t("standard.findPrev")}
                title={t("standard.findPrev")}
                className="glass-input px-2 py-0.5 text-xs"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => stepHit(1)}
                aria-label={t("standard.findNext")}
                title={t("standard.findNext")}
                className="glass-input px-2 py-0.5 text-xs"
              >
                ↓
              </button>
            </span>
          )}
          {searching && (
            <button
              type="button"
              onClick={clearFind}
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
              <>
                {/* Gambar di atas pertanyaannya, urutan yang sama dengan yang
                    dikirim ke model. Ukurannya dibatasi: sebuah foto setinggi
                    layar mendorong pertanyaannya sendiri keluar dari pandangan. */}
                {m.images && m.images.length > 0 && (
                  <div className="mb-1.5 flex flex-wrap gap-1.5">
                    {m.images.map((src, n) => (
                      // data URL dari berkas pengguna; next/image butuh URL yang
                      // bisa diambil server, dan tidak ada yang bisa diambil.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={n}
                        src={src}
                        alt=""
                        className="max-h-40 rounded-xl object-contain"
                      />
                    ))}
                  </div>
                )}
                {/* Pertanyaan bukan markdown — ia teks apa adanya — jadi
                    penandaannya di sini, bukan lewat perender markdown. */}
                <Marked text={m.content} terms={terms} />
              </>
            ) : (
              /* Hanya gelembung TERAKHIR yang diketik, dan hanya selagi mengalir.
                 Jawaban lama sudah selesai; mengetiknya ulang setiap render
                 akan membuat percakapan kemarin bergerak sendiri. */
              <>
                {/* Kenapa gelembung ini ditulis dua kali. Tanpa baris ini, yang
                    terlihat adalah jawaban selesai lalu hilang lalu kembali
                    hampir sama — dan itu terbaca sebagai aplikasi yang rusak,
                    bukan sebagai sesuatu yang baru saja diperbaiki. */}
                {m.notice && (
                  <p className="mb-2 border-l-2 border-amber-400 pl-2 text-xs opacity-60">
                    {m.notice}
                  </p>
                )}
                <Answer
                  text={m.content}
                  typing={loading && i === messages.length - 1}
                  highlight={terms}
                />
              </>
            )}
            </div>
          ))}
          {/* Gelembung menunggu, sampai huruf pertama datang. Sesudah itu teks
              yang tumbuh sendiri sudah menunjukkan jawabannya sedang ditulis, dan
              indikator kedua di bawahnya hanya menambah kesibukan di layar.
              Bentuknya sengaja sama dengan gelembung jawaban supaya jelas di situ
              jawabannya akan muncul.

              Syaratnya dulu "gelembung terakhir masih kosong" — dan gelembung
              kosong itu baru dibuat SESUDAH server menjawab. Jadi justru selama
              penantian terpanjang, sejak Enter ditekan sampai potongan pertama
              datang lewat gateway, tidak ada satu pun tanda bahwa ada yang
              sedang terjadi. Sekarang ia muncul sejak pertanyaannya terkirim. */}
          {loading && (messages[messages.length - 1]?.role === "user" ||
            messages[messages.length - 1]?.content === "") && (
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

      {/* Yang sudah dipilih, di atas kolom tulis — bukan di dalamnya. Sebuah
          gambar di dalam kolom akan mengubah tingginya setiap kali dilampirkan,
          dan kolom yang melompat saat sedang diketik itu tidak bisa diabaikan. */}
      <AttachmentStrip
        items={attachments}
        onRemove={(id) => setAttachments((prev) => prev.filter((a) => a.id !== id))}
      />

      <ChatInput
        value={input}
        onChange={setInput}
        onSubmit={send}
        placeholder={t("standard.placeholder")}
      >
        <AttachButton
          disabled={loading}
          count={attachments.length}
          onAdd={(items) => setAttachments((prev) => [...prev, ...items])}
          onError={setError}
        />
        <button onClick={send} disabled={loading} className="btn-accent shrink-0">
          {loading ? t("standard.sending") : t("standard.send")}
        </button>
      </ChatInput>
    </div>
  );
}
