"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import ResultView from "../ResultView";
import TelegramLink from "./TelegramLink";

type QueueStatus = "pending" | "processing" | "completed" | "failed" | "cancelled";

interface HistoryRow {
  id: string;
  command_type: string;
  command_text: string | null;
  status: QueueStatus;
  result_json: unknown;
  error_message: string | null;
  queued_at: string;
  completed_at: string | null;
  execution_time_ms: number | null;
}

/**
 * Tautan file di dalam hasil command.
 *
 * Bentuk `result_json` berbeda-beda per handler add-in (export, print_pdf,
 * query, …), jadi yang dicari adalah polanya, bukan satu field tertentu: setiap
 * string berupa URL http(s) dianggap file yang bisa diunduh. Kalau add-in
 * berjalan tanpa `export_base_url`, yang tersimpan adalah path lokal di PC
 * Revit — itu bukan URL, jadi sengaja tidak ditampilkan sebagai tautan yang
 * mengecoh.
 */
function fileLinks(value: unknown, found: string[] = []): string[] {
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value) && !found.includes(value)) found.push(value);
    return found;
  }
  if (Array.isArray(value)) {
    for (const v of value) fileLinks(v, found);
    return found;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) fileLinks(v, found);
  }
  return found;
}

function fileName(url: string) {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() || url);
  } catch {
    return url;
  }
}

export default function HistoryPage() {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Riwayat perintah milik sendiri, terbaru dulu. Indeks
      // idx_commands_queue_user_recent (migrasi 0008) persis untuk query ini.
      //
      // `model_info` dikeluarkan: tidak ada satu orang pun yang menjalankannya.
      // Halaman perintah membacanya sendiri untuk tahu file .rvt mana yang
      // sedang terbuka — sekali saat dibuka, lalu berkala selama panelnya
      // terlihat — jadi ia akan mengisi lima puluh baris terakhir ini dalam
      // waktu kurang dari satu jam dan mendorong keluar setiap perintah yang
      // benar-benar dikirim orangnya. Riwayat yang isinya plumbing bukan
      // riwayat.
      //
      // Disaring di query, bukan sesudahnya: `limit(50)` berlaku di database,
      // jadi menyaringnya di sini berarti lima puluh baris yang diambil memang
      // lima puluh perintah, bukan lima puluh baris yang tersisa tiga.
      const { data, error } = await supabase
        .from("commands_queue")
        .select(
          "id, command_type, command_text, status, result_json, error_message, queued_at, completed_at, execution_time_ms"
        )
        .eq("user_id", user.id)
        .neq("command_type", "model_info")
        .order("queued_at", { ascending: false })
        .limit(50)
        .returns<HistoryRow[]>();

      if (cancelled) return;
      if (error) setError(error.message);
      else setRows(data ?? []);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <p className="opacity-60">{t("common.loading")}</p>;
  if (error) return <p className="text-sm text-red-500">{error}</p>;

  return (
    <div className="glass-panel max-w-3xl space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="text-lg font-medium">{t("history.title")}</h1>
        <p className="text-sm text-text-secondary">{t("history.subtitle")}</p>
      </div>

      {/* Di atas daftarnya, dan ditampilkan juga saat riwayatnya masih kosong —
          justru akun yang belum pernah mengirim apa pun yang paling untung
          menautkannya sekarang, sebelum perintah pertamanya berjalan. */}
      <TelegramLink />

      {rows.length === 0 && <p className="text-text-secondary">{t("history.empty")}</p>}

      {/* Lima puluh baris riwayat, masing-masing bisa punya rincian yang
          dibuka — digulir di dalam kotaknya sendiri, supaya judul halaman dan
          keterangannya tetap terlihat. */}
      <div className="max-h-[70vh] space-y-2 overflow-y-auto pr-1">
        {rows.map((r) => {
          const links = fileLinks(r.result_json);
          const failed = r.status === "failed" || r.status === "cancelled";
          const done = r.status === "completed";

          return (
            <div key={r.id} className="glass-input space-y-2">
              <div className="flex items-start justify-between gap-3">
                <code className="text-xs break-all">{r.command_text ?? `/${r.command_type}`}</code>
                <span
                  className={`whitespace-nowrap text-xs ${
                    failed ? "text-red-500" : done ? "text-emerald-600" : "opacity-60"
                  }`}
                >
                  {t(`command.status.${r.status}`)}
                  {r.execution_time_ms != null && ` · ${r.execution_time_ms} ms`}
                </span>
              </div>

              <p className="text-xs opacity-55">
                {new Date(r.queued_at).toLocaleString(locale === "id" ? "id-ID" : "en-GB")}
              </p>

              {r.error_message && <p className="text-xs text-red-500">{r.error_message}</p>}

              {links.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {links.map((url) => (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-accent underline"
                    >
                      ↓ {fileName(url)}
                    </a>
                  ))}
                </div>
              )}

              {/* Rinciannya dilipat: yang dicari orang di halaman ini biasanya
                  tautan unduhannya, dan 50 hasil yang terbuka semua membuat
                  daftar ini tidak bisa dibaca. */}
              {r.status === "completed" && r.result_json != null && (
                <details className="text-xs">
                  <summary className="cursor-pointer opacity-60 hover:opacity-100">
                    {t("history.details")}
                  </summary>
                  <div className="mt-2 max-h-72 overflow-auto">
                    <ResultView value={r.result_json} />
                  </div>
                </details>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-text-secondary">{t("history.fileNote")}</p>
    </div>
  );
}
