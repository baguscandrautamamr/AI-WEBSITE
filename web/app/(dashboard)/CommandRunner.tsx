"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useProjects, type ProjectAccess } from "@/lib/useProjects";
import { COMMANDS, COMMANDS_BY_NAME, canRun, type CommandField, type CommandSpec } from "@/lib/commands";
import CommandChat, { type ChatBody, type ChatEntry } from "./CommandChat";

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
  chat = false,
}: {
  groups: CommandSpec["group"][];
  title: string;
  /** Panel percakapan bahasa manusia di atas tombol command. */
  chat?: boolean;
}) {
  const { t, locale } = useI18n();
  const { projects, loading: projectsLoading } = useProjects();

  const [project, setProject] = useState<ProjectAccess | null>(null);
  const [selected, setSelected] = useState<CommandSpec | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [issues, setIssues] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [runs, setRuns] = useState<RunEntry[]>([]);

  const [chatEntries, setChatEntries] = useState<ChatEntry[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const chatId = useRef(0);

  const [rooms, setRooms] = useState<string[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);

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

  // Daftar ruangan milik satu model; berganti proyek berarti daftarnya basi.
  useEffect(() => {
    setRooms([]);
  }, [project?.projectId]);

  function addChat(entry: ChatBody) {
    setChatEntries((prev) => [...prev, { ...entry, id: ++chatId.current }]);
  }

  function pick(spec: CommandSpec) {
    setSelected(spec);
    setIssues([]);
    // Default dari katalog dipakai sebagai nilai awal, jadi apa yang terlihat
    // di form sama dengan apa yang akan dijalankan add-in.
    const init: Record<string, unknown> = {};
    for (const f of spec.fields) if (f.default !== undefined) init[f.name] = f.default;
    setValues(init);
  }

  /** Mengantre satu command; dipakai tombol kirim dan pemuat daftar ruangan. */
  const enqueue = useCallback(
    async (commandName: string, vals: Record<string, unknown>) => {
      if (!project) throw new Error("no project");
      const res = await fetch("/api/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: commandName, projectId: project.projectId, values: vals }),
      });
      const body = await res.json();
      if (!res.ok) throw Object.assign(new Error(body.error ?? "gagal"), { issues: body.issues });
      return body as { id: string; commandText: string };
    },
    [project]
  );

  async function send() {
    if (!selected || !project) return;
    if (selected.confirm && !window.confirm(t("command.confirm"))) return;

    setSending(true);
    setIssues([]);

    try {
      const body = await enqueue(selected.name, values);
      setRuns((prev) => [{ id: body.id, commandText: body.commandText, status: "pending" }, ...prev]);
    } catch (err) {
      const withIssues = err as Error & { issues?: string[] };
      setIssues(withIssues.issues ?? [withIssues.message || t("command.sendFailed")]);
    } finally {
      setSending(false);
    }
  }

  /**
   * Menanyakan daftar ruangan ke model yang sedang terbuka.
   *
   * Jawabannya datang lewat antrean yang sama seperti perintah lain, jadi ini
   * hanya berhasil kalau Revit terbuka dan add-in berjalan — dan itu memang
   * satu-satunya sumber yang tahu ruangan apa saja yang ada di model.
   */
  async function loadRooms() {
    if (!project || roomsLoading) return;
    setRoomsLoading(true);
    try {
      const { id } = await enqueue("query", { what: "room", detail: "list", limit: 500 });

      // Menunggu add-in menjawab; dibatasi supaya Revit yang tertutup tidak
      // membuat tombolnya berputar selamanya.
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const res = await fetch(`/api/commands?id=${encodeURIComponent(id)}`);
        if (!res.ok) continue;
        const cmd = (await res.json()) as QueuedCommand;
        if (!TERMINAL.includes(cmd.status)) continue;

        if (cmd.status !== "completed") {
          setIssues([cmd.error_message ?? t("command.roomsFailed")]);
          return;
        }

        const items = (cmd.result_json as { items?: { id?: string; label?: string }[] })?.items ?? [];
        const names = items
          .map((it) => it.label ?? it.id ?? "")
          .filter((n): n is string => Boolean(n));
        setRooms(names);
        if (names.length === 0) setIssues([t("command.roomsEmpty")]);
        return;
      }
      setIssues([t("command.roomsTimeout")]);
    } catch (err) {
      setIssues([err instanceof Error ? err.message : String(err)]);
    } finally {
      setRoomsLoading(false);
    }
  }

  /** Satu giliran percakapan: kalimat masuk, usulan perintah keluar. */
  async function sendChat(message: string) {
    if (!project) return;
    addChat({ role: "user", text: message });
    setChatBusy(true);

    try {
      const history = chatEntries
        .filter((e) => e.role === "user" || e.role === "assistant")
        .map((e) => ({ role: e.role as "user" | "assistant", content: e.text }));

      const res = await fetch("/api/ai/electrical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, projectId: project.projectId, history }),
      });
      const body = await res.json();

      if (!res.ok) {
        addChat({ role: "assistant", text: body.error ?? t("chat.failed") });
        return;
      }

      if (body.kind === "reply") {
        addChat({ role: "assistant", text: body.text });
        return;
      }

      // Usulan mengisi form, bukan langsung berangkat. Yang terlihat di form
      // itulah yang akan dikirim, jadi tidak ada selisih antara yang disetujui
      // dan yang dijalankan.
      const spec = COMMANDS_BY_NAME[body.command];
      if (spec) {
        setSelected(spec);
        setValues(body.values ?? {});
        setIssues([]);
      }

      addChat({
        role: "proposal",
        text: body.note ?? "",
        commandText: body.commandText ?? `/${body.command}`,
        issues: body.issues,
      });
    } catch (err) {
      addChat({ role: "assistant", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setChatBusy(false);
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

  // Hasil dari Revit dilaporkan balik ke percakapan, supaya satu utas memuat
  // permintaan, perintah, dan akibatnya — bukan chat di satu tempat dan hasil
  // di tempat lain.
  const reported = useRef(new Set<string>());
  useEffect(() => {
    if (!chat) return;
    for (const run of runs) {
      if (!TERMINAL.includes(run.status) || reported.current.has(run.id)) continue;
      reported.current.add(run.id);

      const outcome =
        run.status === "completed"
          ? t("chat.done")
          : `${t("chat.failedRun")}${run.error ? ` — ${run.error}` : ""}`;
      addChat({ role: "assistant", text: `\`${run.commandText}\` — ${outcome}` });
    }
  }, [runs, chat, t]);

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

      {chat && (
        <CommandChat
          entries={chatEntries}
          busy={chatBusy}
          disabled={!project}
          onSend={sendChat}
        />
      )}

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
                rooms={rooms}
                roomsLoading={roomsLoading}
                onLoadRooms={loadRooms}
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
                rooms={rooms}
                roomsLoading={roomsLoading}
                onLoadRooms={loadRooms}
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
  rooms,
  roomsLoading,
  onLoadRooms,
  onChange,
}: {
  field: CommandField;
  value: unknown;
  locale: "id" | "en";
  rooms: string[];
  roomsLoading: boolean;
  onLoadRooms: () => void;
  onChange: (v: unknown) => void;
}) {
  const { t } = useI18n();
  const isRoom = field.name === "room";

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
      <span className="flex items-center justify-between gap-2">
        {label}
        {/* Nama ruangan harus persis seperti di model. Mengetiknya ulang dari
            ingatan adalah cara paling sering sebuah perintah gagal, jadi
            daftarnya diambil dari Revit dan dipakai sebagai saran. */}
        {isRoom && (
          <button
            type="button"
            onClick={onLoadRooms}
            disabled={roomsLoading}
            className="text-xs text-accent underline disabled:opacity-40"
          >
            {roomsLoading ? t("command.roomsLoading") : t("command.roomsLoad")}
          </button>
        )}
      </span>

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
        <>
          <input
            className="glass-input w-full"
            type={field.type === "number" || field.type === "integer" ? "number" : "text"}
            value={String(value ?? "")}
            placeholder={field.default !== undefined ? String(field.default) : ""}
            min={field.min}
            max={field.max}
            list={isRoom && rooms.length ? "revit-rooms" : undefined}
            onChange={(e) => onChange(e.target.value)}
          />
          {/* datalist, bukan select: nama yang tidak ada di daftar tetap boleh
              diketik, karena daftar ini hanya sebaik model yang terakhir dibaca. */}
          {isRoom && rooms.length > 0 && (
            <datalist id="revit-rooms">
              {rooms.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          )}
        </>
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
