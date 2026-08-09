"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useProjects, type ProjectAccess } from "@/lib/useProjects";
import { COMMANDS, canRun, type CommandField, type CommandSpec } from "@/lib/commands";

type QueueStatus = "pending" | "processing" | "completed" | "failed" | "cancelled";

interface QueuedCommand {
  id: string;
  command_type: string;
  command_text: string | null;
  status: QueueStatus;
  result_json: unknown;
  error_message: string | null;
  execution_time_ms: number | null;
}

/** Sebuah command yang sedang/sudah dijalankan, ditampilkan di daftar hasil. */
interface RunEntry {
  id: string;
  commandText: string;
  status: QueueStatus;
  result?: unknown;
  error?: string | null;
  ms?: number | null;
}

const TERMINAL: QueueStatus[] = ["completed", "failed", "cancelled"];

export default function CommandRunner({
  groups,
  title,
}: {
  groups: CommandSpec["group"][];
  title: string;
}) {
  const { t, locale } = useI18n();
  const { projects, loading: projectsLoading } = useProjects();

  const [project, setProject] = useState<ProjectAccess | null>(null);
  const [selected, setSelected] = useState<CommandSpec | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [issues, setIssues] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [runs, setRuns] = useState<RunEntry[]>([]);

  // Proyek pertama dipilih otomatis supaya halaman langsung bisa dipakai.
  useEffect(() => {
    if (!project && projects.length) setProject(projects[0]);
  }, [projects, project]);

  const available = useMemo(() => {
    if (!project) return [];
    return COMMANDS.filter((c) => groups.includes(c.group) && canRun(c, project.role));
  }, [project, groups]);

  // Command yang terpilih ikut disaring ulang saat proyek berganti: peran di
  // proyek baru bisa lebih rendah, dan form yang tertinggal akan selalu ditolak
  // server. Lebih baik dikosongkan di sini.
  useEffect(() => {
    if (selected && !available.some((c) => c.name === selected.name)) {
      setSelected(null);
      setValues({});
    }
  }, [available, selected]);

  function pick(spec: CommandSpec) {
    setSelected(spec);
    setIssues([]);
    // Default dari katalog dipakai sebagai nilai awal, jadi apa yang terlihat
    // di form sama dengan apa yang akan dijalankan add-in.
    const init: Record<string, unknown> = {};
    for (const f of spec.fields) if (f.default !== undefined) init[f.name] = f.default;
    setValues(init);
  }

  async function send() {
    if (!selected || !project) return;
    if (selected.confirm && !window.confirm(t("command.confirm"))) return;

    setSending(true);
    setIssues([]);

    try {
      const res = await fetch("/api/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: selected.name, projectId: project.projectId, values }),
      });
      const body = await res.json();

      if (!res.ok) {
        setIssues(body.issues ?? [body.error ?? t("command.sendFailed")]);
        return;
      }

      setRuns((prev) => [
        { id: body.id, commandText: body.commandText, status: "pending" },
        ...prev,
      ]);
    } catch (err) {
      setIssues([err instanceof Error ? err.message : String(err)]);
    } finally {
      setSending(false);
    }
  }

  const pending = runs.some((r) => !TERMINAL.includes(r.status));
  usePolling(pending, async () => {
    const open = runs.filter((r) => !TERMINAL.includes(r.status));
    if (!open.length) return;

    const updates = await Promise.all(
      open.map(async (r) => {
        const res = await fetch(`/api/commands?id=${encodeURIComponent(r.id)}`);
        if (!res.ok) return null;
        return (await res.json()) as QueuedCommand;
      })
    );

    setRuns((prev) =>
      prev.map((r) => {
        const u = updates.find((x) => x && x.id === r.id);
        if (!u) return r;
        return {
          ...r,
          status: u.status,
          result: u.result_json,
          error: u.error_message,
          ms: u.execution_time_ms,
        };
      })
    );
  });

  if (projectsLoading) return <p className="opacity-60">{t("common.loading")}</p>;

  if (!projects.length) {
    return (
      <div className="glass-panel max-w-2xl p-6 space-y-2">
        <h1 className="text-lg font-medium">{title}</h1>
        <p className="opacity-70 text-sm">{t("command.noProject")}</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-4">
      <div className="glass-panel p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-lg font-medium">{title}</h1>
          <label className="flex items-center gap-2 text-sm">
            <span className="opacity-70">{t("command.project")}</span>
            <select
              className="glass-input"
              value={project?.projectId ?? ""}
              onChange={(e) =>
                setProject(projects.find((p) => p.projectId === e.target.value) ?? null)
              }
            >
              {projects.map((p) => (
                <option key={p.projectId} value={p.projectId}>
                  {p.name} · {p.role}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Tombol per command — inilah yang menembak ke add-in Revit. */}
        <div className="flex flex-wrap gap-2">
          {available.map((c) => (
            <button
              key={c.name}
              onClick={() => pick(c)}
              className={`glass-input text-sm transition ${
                selected?.name === c.name ? "ring-2 ring-[var(--accent)]" : "hover:opacity-80"
              }`}
            >
              {c.label[locale]}
            </button>
          ))}
        </div>

        {available.length === 0 && (
          <p className="text-sm opacity-70">{t("command.roleTooLow")}</p>
        )}
      </div>

      {selected && (
        <div className="glass-panel p-6 space-y-4">
          <div>
            <h2 className="font-medium">{selected.label[locale]}</h2>
            <p className="text-sm opacity-70 mt-1">{selected.description[locale]}</p>
            <code className="mt-2 block text-xs opacity-50">{selected.example}</code>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {selected.positional && (
              <Field
                field={selected.positional}
                value={values[selected.positional.name]}
                locale={locale}
                onChange={(v) =>
                  setValues((s) => ({ ...s, [selected.positional!.name]: v }))
                }
              />
            )}
            {selected.fields.map((f) => (
              <Field
                key={f.name}
                field={f}
                value={values[f.name]}
                locale={locale}
                onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))}
              />
            ))}
          </div>

          {issues.length > 0 && (
            <ul className="text-sm text-red-500 list-disc pl-5 space-y-1">
              {issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          )}

          <button onClick={send} disabled={sending} className="btn-accent">
            {sending ? t("command.sending") : t("command.send")}
          </button>
        </div>
      )}

      {runs.length > 0 && (
        <div className="glass-panel p-6 space-y-3">
          <h2 className="font-medium">{t("command.results")}</h2>
          {runs.map((r) => (
            <RunRow key={r.id} run={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function RunRow({ run }: { run: RunEntry }) {
  const { t } = useI18n();
  const done = TERMINAL.includes(run.status);
  const failed = run.status === "failed" || run.status === "cancelled";

  return (
    <div className="glass-input space-y-2">
      <div className="flex items-center justify-between gap-3">
        <code className="text-xs break-all">{run.commandText}</code>
        <span
          className={`text-xs whitespace-nowrap ${
            failed ? "text-red-500" : done ? "text-emerald-600" : "opacity-60"
          }`}
        >
          {t(`command.status.${run.status}`)}
          {run.ms != null && ` · ${run.ms} ms`}
        </span>
      </div>

      {!done && (
        // Baris masih menunggu add-in mengambilnya. Kalau Revit tertutup,
        // status akan bertahan di "pending" — itu informasi, bukan kegagalan.
        <p className="text-xs opacity-60">{t("command.waitingAddin")}</p>
      )}

      {run.error && <p className="text-xs text-red-500">{run.error}</p>}

      {done && !failed && run.result != null && (
        <pre className="text-xs overflow-auto max-h-56 opacity-80">
          {JSON.stringify(run.result, null, 2)}
        </pre>
      )}
    </div>
  );
}

function Field({
  field,
  value,
  locale,
  onChange,
}: {
  field: CommandField;
  value: unknown;
  locale: "id" | "en";
  onChange: (v: unknown) => void;
}) {
  const label = (
    <span className="text-sm">
      {field.label[locale]}
      {field.required && <span className="text-red-500"> *</span>}
    </span>
  );

  if (field.type === "boolean") {
    return (
      <label className="flex items-center gap-2 sm:col-span-2">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
        {label}
      </label>
    );
  }

  return (
    <label className="space-y-1">
      {label}
      {field.type === "select" ? (
        <select
          className="glass-input w-full"
          value={String(value ?? field.default ?? "")}
          onChange={(e) => onChange(e.target.value)}
        >
          {field.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="glass-input w-full"
          type={field.type === "number" || field.type === "integer" ? "number" : "text"}
          value={String(value ?? "")}
          placeholder={field.default !== undefined ? String(field.default) : ""}
          min={field.min}
          max={field.max}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {field.hint && <span className="block text-xs opacity-55">{field.hint[locale]}</span>}
    </label>
  );
}

/**
 * Polling 2 detik selama masih ada command yang belum selesai, dan berhenti
 * total begitu semuanya terminal — supaya tab yang dibiarkan terbuka tidak
 * memukuli API selamanya.
 */
function usePolling(active: boolean, fn: () => void | Promise<void>) {
  const saved = useRef(fn);
  saved.current = fn;

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => void saved.current(), 2000);
    return () => clearInterval(id);
  }, [active]);
}
