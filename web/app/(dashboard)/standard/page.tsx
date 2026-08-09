"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";

interface Msg { role: "user" | "assistant"; content: string }

export default function StandardPage() {
  const { t } = useI18n();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  async function send() {
    if (!input.trim()) return;
    const next = [...messages, { role: "user" as const, content: input }];
    setMessages(next);
    setInput("");
    setLoading(true);

    // Mode Standard TIDAK PERNAH insert ke tabel `commands` —
    // ini murni chat ke LLM, tidak menyentuh Revit sama sekali.
    const res = await fetch("/api/ai/standard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: input }),
    });
    const { reply } = await res.json();
    setMessages([...next, { role: "assistant", content: reply }]);
    setLoading(false);
  }

  return (
    <div className="glass-panel max-w-2xl p-6 space-y-4 flex flex-col h-[70vh]">
      <div>
        <h1 className="text-lg font-medium">{t("standard.title")}</h1>
        <p className="text-sm text-text-secondary">{t("standard.subtitle")}</p>
      </div>

      <div className="flex-1 overflow-auto space-y-2">
        {messages.map((m, i) => (
          <div key={i} className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
            m.role === "user" ? "bg-accent text-white ml-auto" : "glass-input"
          }`}>
            {m.content}
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          className="glass-input flex-1"
          placeholder={t("standard.placeholder")}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button onClick={send} disabled={loading} className="btn-accent">{t("standard.send")}</button>
      </div>
    </div>
  );
}
