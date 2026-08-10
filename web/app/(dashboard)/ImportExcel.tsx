"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useProjects } from "@/lib/useProjects";
import { canRun, COMMANDS_BY_NAME } from "@/lib/commands";

type Phase = "idle" | "uploading" | "queued" | "done" | "failed";

/**
 * Mengirim satu spreadsheet kembali ke model.
 *
 * Alurnya dua langkah karena memang dua hal: file diunggah ke Cloudinary lebih
 * dulu, baru URL-nya dikirim sebagai perintah. Add-in tidak bisa membaca file
 * dari browser — ia hanya melihat antrean, jadi yang bisa diantre adalah
 * tautannya, bukan isinya.
 *
 * Tidak memakai form command generik seperti perintah lain: satu-satunya
 * argumen wajibnya adalah URL yang belum ada sampai unggahannya selesai, dan
 * meminta orang menempelkannya sendiri adalah pekerjaan yang tidak perlu ada.
 */
export default function ImportExcel() {
  const { t } = useI18n();
  const { projects } = useProjects();

  const [projectId, setProjectId] = useState("");
  const [dryRun, setDryRun] = useState(true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(null);

  const spec = COMMANDS_BY_NAME["import_excel"];
  const allowed = projects.filter((p) => spec && canRun(spec, p.role));
  const active = projectId || allowed[0]?.projectId || "";

  // Peran viewer tidak boleh mengubah model, jadi bagian ini tidak ditampilkan
  // sama sekali — bukan ditampilkan lalu ditolak setelah file terlanjur naik.
  if (allowed.length === 0) return null;

  async function run(file: File) {
    setPhase("uploading");
    setMessage(null);
    setResult(null);

    try {
      const form = new FormData();
      form.append("file", file);
      // Proyeknya ikut dikirim: route unggah memeriksa peran di proyek ini
      // sebelum menerima apa pun, jadi file yang tidak boleh diimpor ditolak
      // sebelum naik, bukan setelah.
      form.append("projectId", active);

      const uploaded = await fetch("/api/files/upload", { method: "POST", body: form });
      const uploadBody = await uploaded.json();
      if (!uploaded.ok) throw new Error(uploadBody.error ?? t("importExcel.uploadFailed"));

      setPhase("queued");

      const queued = await fetch("/api/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: "import_excel",
          projectId: active,
          values: { file_url: uploadBody.url, dry_run: dryRun },
        }),
      });
      const queuedBody = await queued.json();
      if (!queued.ok) {
        throw new Error(queuedBody.issues?.join("; ") ?? queuedBody.error ?? t("importExcel.queueFailed"));
      }

      // Menunggu add-in: import menulis ke model, jadi "terkirim" bukan kabar
      // yang berguna — yang ditunggu orang adalah berapa yang berubah.
      for (let i = 0; i < 60; i++) {
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
          setMessage(cmd.error_message ?? t("importExcel.queueFailed"));
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
    <div className="glass-panel max-w-4xl space-y-4 p-6">
      <div>
        <h2 className="font-medium">{t("importExcel.title")}</h2>
        <p className="text-sm opacity-70">{t("importExcel.subtitle")}</p>
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

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
        <span>{t("importExcel.dryRun")}</span>
      </label>

      <input
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Nilainya dikosongkan supaya memilih file yang sama dua kali tetap
          // memicu onChange.
          e.target.value = "";
          if (file) run(file);
        }}
      />

      {busy && (
        <p className="text-sm opacity-70">
          {phase === "uploading" ? t("importExcel.uploading") : t("importExcel.waiting")}
        </p>
      )}

      {phase === "failed" && message && <p className="text-sm text-red-500">{message}</p>}

      {phase === "done" && (
        <div className="space-y-2">
          <p className="text-sm text-emerald-600">
            {dryRun ? t("importExcel.doneDry") : t("importExcel.done")}
          </p>
          <pre className="glass-input max-h-64 overflow-auto text-xs">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}

      <p className="text-xs text-text-secondary">{t("importExcel.note")}</p>
    </div>
  );
}
