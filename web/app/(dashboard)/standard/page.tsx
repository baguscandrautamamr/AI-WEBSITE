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
      } catch {
        // Riwayat kosong bukan kegagalan yang perlu ditampilkan; halaman tetap
        // bisa dipakai untuk bertanya.
      }
    })();
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
      const body = await res.json();

      if (!res.ok) {
        setError(body.error ?? t("standard.failed"));
        return;
      }

      setMessages((prev) => [...prev, { role: "assistant", content: body.reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("standard.failed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="glass-panel max-w-2xl p-6 space-y-4 flex flex-col h-[70vh]">
      <div>
        <h1 className="text-lg font-medium">{t("standard.title")}</h1>
        <p className="text-sm text-text-secondary">{t("standard.subtitle")}</p>
      </div>

      <div className="flex-1 overflow-auto space-y-2">
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
        {loading && <p className="text-xs opacity-60">{t("common.loading")}</p>}
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
