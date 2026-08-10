"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import Markdown from "./Markdown";

/**
 * Isi satu gelembung percakapan, tanpa identitasnya.
 *
 * Dipisah dari `id` karena `Omit` pada union tipe hanya menyisakan kunci yang
 * dimiliki SEMUA anggotanya — `commandText` akan ikut hilang, dan usulan
 * perintah tidak bisa lagi dibedakan dari balasan biasa.
 */
export type ChatBody =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string }
  | { role: "proposal"; text: string; commandText: string; issues?: string[] };

export type ChatEntry = ChatBody & { id: number };

/**
 * Sisi percakapan dari mode Electrical.
 *
 * Perintah yang tersusun langsung berangkat ke Revit, seperti pada bot
 * Telegram: satu kalimat, satu perintah, hasilnya balik ke utas yang sama.
 * Sebelumnya usulannya hanya mengisi form di bawah dan orangnya masih harus
 * menekan kirim di sana — dua langkah untuk satu maksud, dan pada telepon
 * langkah kedua itu berada di luar layar.
 *
 * Yang tetap ditahan hanyalah perintah yang mengubah model tanpa bisa
 * dibatalkan; untuk itu satu pertanyaan muncul dulu. Form di bawah tetap terisi
 * — ia sekarang jadi tempat memperbaiki satu angka lalu menjalankan ulang, bukan
 * gerbang yang harus dilewati.
 */
export default function CommandChat({
  entries,
  busy,
  disabled,
  onSend,
}: {
  entries: ChatEntry[];
  busy: boolean;
  disabled: boolean;
  onSend: (message: string) => void;
}) {
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [entries, busy]);

  function submit() {
    const text = input.trim();
    if (!text || busy || disabled) return;
    setInput("");
    onSend(text);
  }

  return (
    <div className="glass-panel p-6 space-y-3">
      {entries.length > 0 && (
        <div className="max-h-80 space-y-2 overflow-auto pr-1">
          {entries.map((e) => {
            if (e.role === "user") {
              return (
                <div
                  key={e.id}
                  className="ml-auto max-w-[80%] whitespace-pre-wrap rounded-2xl bg-accent px-3 py-2 text-sm text-white"
                >
                  {e.text}
                </div>
              );
            }

            if (e.role === "assistant") {
              return (
                <div key={e.id} className="glass-input max-w-[92%] rounded-2xl text-sm">
                  <Markdown>{e.text}</Markdown>
                </div>
              );
            }

            return (
              <div key={e.id} className="glass-input max-w-[92%] space-y-2 rounded-2xl text-sm">
                {e.text && <Markdown>{e.text}</Markdown>}
                <code className="block break-all text-xs opacity-80">{e.commandText}</code>
                {/* Ada yang kurang berarti perintahnya TIDAK berangkat, dan
                    daftar ini yang menjelaskan apa yang perlu disebutkan. Kalau
                    tidak ada, ia sudah dikirim — hasilnya menyusul di gelembung
                    berikutnya, jadi di sini cukup dikatakan ia sudah jalan. */}
                {e.issues?.length ? (
                  <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-600 dark:text-amber-400">
                    {e.issues.map((i) => (
                      <li key={i}>{i}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs opacity-60">{t("chat.sentToRevit")}</p>
                )}
              </div>
            );
          })}
          {busy && <p className="text-xs opacity-60">{t("chat.thinking")}</p>}
          <div ref={bottom} />
        </div>
      )}

      <div className="flex gap-2">
        <input
          className="glass-input flex-1"
          placeholder={t("chat.placeholder")}
          value={input}
          disabled={disabled}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <button onClick={submit} disabled={busy || disabled} className="btn-accent">
          {busy ? t("chat.sending") : t("chat.send")}
        </button>
      </div>
    </div>
  );
}
