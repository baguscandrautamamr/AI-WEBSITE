"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";

/**
 * ID elemen diketik di sini, elemennya langsung terlihat di layar Revit.
 *
 * Kotaknya berdiri sendiri dan tidak lewat deretan tombol perintah, karena yang
 * dijawabnya adalah pertanyaan yang muncul SAAT membaca hasil, bukan sebelum
 * memilih perintah: /inspect dan /query menjawab dengan angka dan nama, lalu
 * pertanyaan berikutnya selalu "yang mana yang di gambar?". Sampai kotak ini
 * ada, satu-satunya jawabannya adalah pindah ke PC Revit dan mengetik ID itu di
 * kotak pencarian Revit sendiri.
 *
 * Sengaja tanpa formulir dan tanpa langkah konfirmasi: perintahnya tidak
 * mengubah model, dan sebuah dialog "yakin?" untuk menggeser layar akan
 * dilewati orang tanpa dibaca dalam dua hari.
 *
 * Yang TIDAK dilakukan di sini: memvalidasi bentuk ID-nya. Itu ada di
 * `buildPayload` (lihat `normalizeElementIds`), satu tempat yang dilalui kotak
 * ini maupun pengirim mana pun lewat /api/commands — dan pesan galatnya datang
 * kembali dari sana, jadi tidak ada dua versi aturan yang bisa berbeda.
 */
export default function ShowElement({
  onShow,
  disabled,
}: {
  /** Mengantre /show_element; melempar Error yang pesannya sudah bisa dibaca. */
  onShow: (ids: string) => Promise<void>;
  disabled?: boolean;
}) {
  const { t } = useI18n();

  const [ids, setIds] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  async function submit() {
    const trimmed = ids.trim();
    if (!trimmed || busy) return;

    setBusy(true);
    setError(null);
    setSent(null);
    try {
      await onShow(trimmed);
      setSent(trimmed);
      // Kotaknya dikosongkan supaya ID berikutnya tidak menyambung ke yang tadi.
      setIds("");
    } catch (err) {
      setError((err as Error).message || t("command.sendFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass-input space-y-2">
      <label htmlFor="show-element-ids" className="block text-sm font-medium">
        {t("showElement.title")}
      </label>

      <div className="flex gap-2">
        <input
          id="show-element-ids"
          value={ids}
          onChange={(e) => {
            setIds(e.target.value);
            setError(null);
            setSent(null);
          }}
          // Enter mengirim: kotak berisi satu angka yang menuntut pindah tangan
          // ke tetikus untuk sebuah tombol di sebelahnya adalah kotak yang
          // dipakai sekali lalu ditinggalkan.
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          // inputMode numerik supaya papan tombol telepon membuka angka lebih
          // dulu — tapi tetap type="text", karena beberapa ID dipisah koma.
          inputMode="numeric"
          placeholder={t("showElement.placeholder")}
          disabled={disabled || busy}
          className="glass-input min-w-0 flex-1 text-sm"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={disabled || busy || !ids.trim()}
          className="btn-accent shrink-0 text-sm disabled:opacity-40"
        >
          {busy ? t("showElement.sending") : t("showElement.action")}
        </button>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Perintahnya terkirim, bukan selesai. Yang menentukan elemennya
          benar-benar tersorot adalah add-in di PC Revit, dan itu baru terjadi
          beberapa detik kemudian — jadi kalimat ini menyebut apa yang memang
          sudah pasti, dan menyebut ke mana harus melihat kalau tidak terjadi. */}
      {sent && (
        <p className="text-sm opacity-70">
          {t("showElement.sent").replace("{ids}", sent)}
        </p>
      )}

      <p className="text-xs opacity-55">{t("showElement.hint")}</p>
    </div>
  );
}
