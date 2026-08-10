"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import Markdown from "../Markdown";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

export default function StandardPage() {
  const { t } = useI18n();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

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

  // Tanpa "smooth": efek ini kini berjalan tiap potongan teks datang, dan
  // animasi gulir yang dimulai ulang puluhan kali per jawaban terlihat gemetar.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages]);

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

      <div className="flex-1 space-y-2 overflow-auto">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`rounded-2xl px-3 py-2 text-sm ${
              m.role === "user"
                ? "bg-accent text-white ml-auto max-w-[80%] whitespace-pre-wrap"
                : "glass-input max-w-[92%]"
            }`}
          >
            {m.role === "user" ? m.content : <Markdown>{m.content}</Markdown>}
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
