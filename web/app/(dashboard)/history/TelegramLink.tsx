"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";

/**
 * Menautkan akun ini ke sebuah chat Telegram, supaya perintah yang dikirim dari
 * website mengabari hasilnya ke ponsel.
 *
 * Tempatnya di halaman Riwayat dan bukan menu tersendiri: yang dijawabnya
 * persis pertanyaan yang membawa orang ke halaman ini — "perintah saya tadi
 * sudah jalan belum?". Menu ketujuh untuk satu kolom isian akan membuat sidebar
 * lebih sibuk daripada masalah yang diselesaikannya.
 *
 * Dilipat secara bawaan: sekali ditautkan, ini tidak perlu dilihat lagi, dan
 * riwayat perintahnya yang harus terlihat lebih dulu.
 */
export default function TelegramLink() {
  const { t } = useI18n();

  const [chatId, setChatId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justLinked, setJustLinked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/notify/telegram");
        const data = await res.json();
        if (!cancelled && res.ok) setChatId(data.chatId ?? null);
      } catch {
        // Panel ini tambahan; halaman riwayatnya sendiri tetap berguna tanpanya.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Galat dari route bisa berupa kunci i18n (`notify.…`, untuk sebab yang punya
   * tindakan jelas) atau kalimat apa adanya (untuk kegagalan yang tak terduga).
   */
  const show = (message: string) => (message.startsWith("notify.") ? t(message) : message);

  async function link() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/notify/telegram", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chatId: draft }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(show(data.error ?? "notify.failed"));
        return;
      }
      setChatId(data.chatId);
      setDraft("");
      setJustLinked(true);
    } catch {
      setError(t("notify.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/notify/telegram", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(show(data.error ?? "notify.failed"));
        return;
      }
      setChatId(null);
      setJustLinked(false);
    } catch {
      setError(t("notify.failed"));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return null;

  return (
    <details className="glass-input" open={!chatId}>
      <summary className="cursor-pointer text-sm">
        {t("notify.title")}
        <span className="ml-2 text-xs opacity-60">
          {chatId ? t("notify.on") : t("notify.off")}
        </span>
      </summary>

      <div className="mt-3 space-y-2">
        <p className="text-xs text-text-secondary">{t("notify.what")}</p>

        {chatId ? (
          <div className="flex flex-wrap items-center gap-3">
            <code className="text-xs">{chatId}</code>
            <button
              type="button"
              onClick={unlink}
              disabled={busy}
              className="text-xs text-red-500 underline disabled:opacity-50"
            >
              {t("notify.unlink")}
            </button>
            {justLinked && (
              <span className="text-xs text-emerald-600">{t("notify.linked")}</span>
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t("notify.placeholder")}
                inputMode="numeric"
                className="glass-input flex-1 text-sm"
              />
              <button
                type="button"
                onClick={link}
                disabled={busy || draft.trim() === ""}
                className="btn-accent text-sm"
              >
                {busy ? t("notify.linking") : t("notify.link")}
              </button>
            </div>
            <p className="text-xs text-text-secondary">{t("notify.howToFind")}</p>
          </>
        )}

        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    </details>
  );
}
