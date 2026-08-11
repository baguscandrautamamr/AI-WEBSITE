"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useProjects } from "@/lib/useProjects";
import { canRun, COMMANDS_BY_NAME } from "@/lib/commands";
import ResultView from "./ResultView";

type Phase = "idle" | "uploading" | "queued" | "done" | "failed";
type Target = "schedule" | "legend" | "schedule_view";

/**
 * Membawa spreadsheet apa adanya ke dalam model sebagai tabel.
 *
 * Berbeda dari Import Excel di sebelahnya, yang menulis nilai ke elemen yang
 * sudah ada lewat kolom Element Id atau Mark. Yang ini tidak menuntut apa pun
 * dari isi filenya: tabel dari supplier, daftar kabel, legenda simbol — apa pun
 * yang bentuknya tabel — digambar ulang di sebuah view, lengkap dengan lebar
 * kolom, tinggi baris, dan sel yang di-merge.
 *
 * Alurnya dua langkah karena memang dua hal: file diunggah lebih dulu, baru
 * URL-nya diantre sebagai perintah. Add-in tidak bisa membaca file dari
 * browser — ia hanya melihat antrean.
 */
export default function ImportTable() {
  const { t } = useI18n();
  const { projects } = useProjects();

  const [projectId, setProjectId] = useState("");
  const [target, setTarget] = useState<Target>("schedule");
  const [viewName, setViewName] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(null);

  const spec = COMMANDS_BY_NAME["import_table"];
  const allowed = projects.filter((p) => spec && canRun(spec, p.role));
  const active = projectId || allowed[0]?.projectId || "";

  if (allowed.length === 0) return null;

  async function run(file: File) {
    setPhase("uploading");
    setMessage(null);
    setResult(null);

    try {
      const form = new FormData();
      form.append("file", file);
      form.append("projectId", active);

      const uploaded = await fetch("/api/files/upload", { method: "POST", body: form });
      const uploadBody = await uploaded.json();
      if (!uploaded.ok) throw new Error(uploadBody.error ?? t("importTable.uploadFailed"));

      setPhase("queued");

      const queued = await fetch("/api/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: "import_table",
          projectId: active,
          values: {
            file_url: uploadBody.url,
            target,
            name: viewName.trim() || undefined,
          },
        }),
      });
      const queuedBody = await queued.json();
      if (!queued.ok) {
        throw new Error(
          queuedBody.issues?.join("; ") ?? queuedBody.error ?? t("importTable.queueFailed")
        );
      }

      // Menunggu add-in: yang berguna bagi orangnya bukan "terkirim", tapi nama
      // view yang jadi dan berapa baris yang masuk.
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const res = await fetch(`/api/commands?id=${encodeURIComponent(queuedBody.id)}`);
        if (!res.ok) continue;
        const cmd = await res.json();

        if (cmd.status === "completed") {
          setPhase("done");
          setResult(cmd.result_json);
          return;
        }
        if (cmd.status === "failed" || cmd.status === "cancelled") {
          setPhase("failed");
          setMessage(cmd.error_message ?? t("importTable.queueFailed"));
          return;
        }
      }

      setPhase("failed");
      setMessage(t("command.roomsTimeout"));
    } catch (err) {
      setPhase("failed");
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  const busy = phase === "uploading" || phase === "queued";

  return (
    <div className="glass-panel max-w-4xl space-y-4 p-4 sm:p-6">
      <div>
        <h2 className="font-medium">{t("importTable.title")}</h2>
        <p className="text-sm opacity-70">{t("importTable.subtitle")}</p>
      </div>

      {allowed.length > 1 && (
        <label className="flex items-center gap-2 text-sm">
          <span className="opacity-70">{t("command.project")}</span>
          <select
            className="glass-input"
            value={active}
            onChange={(e) => setProjectId(e.target.value)}
          >
            {allowed.map((p) => (
              <option key={p.projectId} value={p.projectId}>
                {p.name} · {p.role}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-sm">{t("importTable.target")}</span>
          <select
            className="glass-input w-full"
            value={target}
            disabled={busy}
            onChange={(e) => setTarget(e.target.value as Target)}
          >
            <option value="schedule">{t("importTable.targetSchedule")}</option>
            <option value="legend">{t("importTable.targetLegend")}</option>
            {/* Schedule yang sebenarnya — Schedules/Quantities di browser
                proyek, bukan gambar dari tabelnya. Dua yang di atas adalah view
                yang isinya digambar; yang ini view yang isinya DIBACA dari
                model, jadi ia bisa difilter, diurutkan, dan ikut berubah saat
                modelnya berubah. */}
            <option value="schedule_view">{t("importTable.targetScheduleView")}</option>
          </select>
          <span className="block text-xs opacity-55">
            {target === "schedule"
              ? t("importTable.targetScheduleHint")
              : target === "legend"
                ? t("importTable.targetLegendHint")
                : t("importTable.targetScheduleViewHint")}
          </span>
        </label>

        <label className="space-y-1">
          <span className="text-sm">{t("importTable.viewName")}</span>
          <input
            className="glass-input w-full"
            type="text"
            value={viewName}
            disabled={busy}
            placeholder={t("importTable.viewNamePlaceholder")}
            onChange={(e) => setViewName(e.target.value)}
          />
        </label>
      </div>

      <input
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Dikosongkan supaya memilih file yang sama dua kali tetap memicu onChange.
          e.target.value = "";
          if (!file) return;
          // Lihat catatan yang sama di ImportExcel: pesan merah dari percobaan
          // sebelumnya tidak boleh menempel di sebelah kotak file yang kosong.
          setPhase("idle");
          setMessage(null);
          setResult(null);
          run(file);
        }}
      />

      {busy && (
        <p className="text-sm opacity-70">
          {phase === "uploading" ? t("importTable.uploading") : t("importTable.waiting")}
        </p>
      )}

      {phase === "failed" && message && <p className="text-sm text-red-500">{message}</p>}

      {phase === "done" && (
        <div className="space-y-2">
          <p className="text-sm text-emerald-600">{t("importTable.done")}</p>
          <div className="glass-input max-h-64 overflow-auto text-xs">
            <ResultView value={result} />
          </div>
        </div>
      )}

      {/* Catatan penutupnya mengikuti target: yang berlaku untuk tabel yang
          DIGAMBAR — "hasilnya gambar, bukan schedule yang membaca model" —
          justru kebalikan dari yang benar untuk schedule sungguhan. */}
      <p className="text-xs text-text-secondary">
        {t(target === "schedule_view" ? "importTable.noteSchedule" : "importTable.note")}
      </p>
    </div>
  );
}
