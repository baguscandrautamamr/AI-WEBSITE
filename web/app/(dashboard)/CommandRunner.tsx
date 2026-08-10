"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useProjects, type ProjectAccess } from "@/lib/useProjects";
import { COMMANDS, COMMANDS_BY_NAME, canRun, type CommandField, type CommandSpec } from "@/lib/commands";
import CommandChat, { type ChatBody, type ChatEntry } from "./CommandChat";
import ResultView from "./ResultView";

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

/** Satu sheet di model, sebagaimana dikembalikan /list_sheets. */
interface SheetOption {
  number: string;
  name: string;
}

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

  const [sheets, setSheets] = useState<SheetOption[]>([]);
  const [sheetsLoading, setSheetsLoading] = useState(false);

  // Proyek pertama dipilih otomatis supaya halaman langsung bisa dipakai.
  useEffect(() => {
    if (!project && projects.length) setProject(projects[0]);
  }, [projects, project]);

  const available = useMemo(() => {
    if (!project) return [];
    return COMMANDS.filter(
      (c) => groups.includes(c.group) && !c.hidden && canRun(c, project.role)
    );
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

  // Daftar ruangan dan sheet milik satu model; berganti proyek berarti keduanya basi.
  useEffect(() => {
    setRooms([]);
    setSheets([]);
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
   * Menjalankan satu perintah baca lalu menunggu jawabannya.
   *
   * Jawabannya datang lewat antrean yang sama seperti perintah lain, jadi ini
   * hanya berhasil kalau Revit terbuka dan add-in berjalan — dan itu memang
   * satu-satunya sumber yang tahu isi model. Dibatasi 30 kali supaya Revit yang
   * tertutup tidak membuat tombolnya berputar selamanya.
   */
  const runAndWait = useCallback(
    async (commandName: string, vals: Record<string, unknown>) => {
      const { id } = await enqueue(commandName, vals);

      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const res = await fetch(`/api/commands?id=${encodeURIComponent(id)}`);
        if (!res.ok) continue;

        const cmd = (await res.json()) as QueuedCommand;
        if (!TERMINAL.includes(cmd.status)) continue;
        if (cmd.status !== "completed") {
          throw new Error(cmd.error_message ?? t("command.roomsFailed"));
        }
        return cmd.result_json;
      }

      throw new Error(t("command.roomsTimeout"));
    },
    [enqueue, t]
  );

  /** Daftar `{ id, label }` yang dikembalikan query dan list_sheets. */
  function itemsOf(result: unknown) {
    return (result as { items?: { id?: string; label?: string }[] })?.items ?? [];
  }

  /** Nama ruangan di model yang sedang terbuka. */
  async function loadRooms() {
    if (!project || roomsLoading) return;
    setRoomsLoading(true);
    try {
      const items = itemsOf(await runAndWait("query", { what: "room", detail: "list", limit: 500 }));
      const names = items.map((it) => it.label ?? it.id ?? "").filter(Boolean);
      setRooms(names);
      if (names.length === 0) setIssues([t("command.roomsEmpty")]);
    } catch (err) {
      setIssues([err instanceof Error ? err.message : String(err)]);
    } finally {
      setRoomsLoading(false);
    }
  }

  /**
   * Sheet di model, untuk dicentang satu per satu.
   *
   * Nomor sheet adalah satu-satunya hal yang dibaca print_pdf, dan mengetiknya
   * ulang dari ingatan untuk selusin gambar adalah cara paling mudah mencetak
   * sheet yang salah — atau melewatkan satu tanpa sadar.
   */
  async function loadSheets() {
    if (!project || sheetsLoading) return;
    setSheetsLoading(true);
    try {
      const items = itemsOf(await runAndWait("list_sheets", {}));
      const list = items
        .filter((it) => it.id)
        .map((it) => ({ number: it.id as string, name: it.label ?? "" }));
      setSheets(list);
      if (list.length === 0) setIssues([t("command.sheetsEmpty")]);
    } catch (err) {
      setIssues([err instanceof Error ? err.message : String(err)]);
    } finally {
      setSheetsLoading(false);
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
                sheets={sheets}
                sheetsLoading={sheetsLoading}
                onLoadSheets={loadSheets}
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
                sheets={sheets}
                sheetsLoading={sheetsLoading}
                onLoadSheets={loadSheets}
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
        <div className="max-h-72 overflow-auto text-xs">
          <ResultView value={run.result} />
        </div>
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
  sheets,
  sheetsLoading,
  onLoadSheets,
  onChange,
}: {
  field: CommandField;
  value: unknown;
  locale: "id" | "en";
  rooms: string[];
  roomsLoading: boolean;
  onLoadRooms: () => void;
  sheets: SheetOption[];
  sheetsLoading: boolean;
  onLoadSheets: () => void;
  onChange: (v: unknown) => void;
}) {
  const { t } = useI18n();
  const isRoom = field.name === "room";
  const isSheets = field.name === "sheets";

  if (isSheets) {
    return (
      <SheetPicker
        field={field}
        value={value}
        locale={locale}
        sheets={sheets}
        loading={sheetsLoading}
        onLoad={onLoadSheets}
        onChange={onChange}
      />
    );
  }

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
 * Memilih sheet dengan mencentangnya.
 *
 * print_pdf menerima daftar nomor sheet dipisah koma, dan itu tetap bentuk yang
 * dikirim — kotak centang di sini hanya cara menyusunnya. Kolom teksnya tetap
 * ada dan tetap bisa diketik: pola seperti `E-1*` dan kata `all` masih dimengerti
 * add-in, dan keduanya lebih cepat daripada mencentang tiga puluh kotak.
 */
function SheetPicker({
  field,
  value,
  locale,
  sheets,
  loading,
  onLoad,
  onChange,
}: {
  field: CommandField;
  value: unknown;
  locale: "id" | "en";
  sheets: SheetOption[];
  loading: boolean;
  onLoad: () => void;
  onChange: (v: unknown) => void;
}) {
  const { t } = useI18n();

  const typed = String(value ?? "");
  const chosen = new Set(
    typed
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
  );

  const toggle = (number: string) => {
    const next = new Set(chosen);
    if (next.has(number)) next.delete(number);
    else next.add(number);

    // Urutan mengikuti daftar sheet, bukan urutan mencentang: yang dikirim ke
    // Revit lalu terbaca sebagai set gambar, bukan sebagai jejak klik.
    onChange(
      sheets
        .map((s) => s.number)
        .filter((number) => next.has(number))
        .concat([...next].filter((n) => !sheets.some((s) => s.number === n)))
        .join(",")
    );
  };

  const allChosen = sheets.length > 0 && sheets.every((s) => chosen.has(s.number));

  return (
    <label className="space-y-1 sm:col-span-2">
      <span className="flex items-center justify-between gap-2">
        <span className="text-sm">
          {field.label[locale]}
          {field.required && <span className="text-red-500"> *</span>}
        </span>
        <button
          type="button"
          onClick={onLoad}
          disabled={loading}
          className="text-xs text-accent underline disabled:opacity-40"
        >
          {loading ? t("command.sheetsLoading") : t("command.sheetsLoad")}
        </button>
      </span>

      <input
        className="glass-input w-full"
        type="text"
        value={typed}
        placeholder={field.default !== undefined ? String(field.default) : ""}
        onChange={(e) => onChange(e.target.value)}
      />

      {sheets.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <button
              type="button"
              className="text-accent underline"
              onClick={() =>
                onChange(allChosen ? "" : sheets.map((s) => s.number).join(","))
              }
            >
              {allChosen ? t("command.sheetsNone") : t("command.sheetsAll")}
            </button>
            <span className="opacity-55">
              {chosen.size}/{sheets.length}
            </span>
          </div>

          <div className="max-h-56 space-y-0.5 overflow-auto rounded-lg border border-black/5 p-2 dark:border-white/10">
            {sheets.map((sheet) => (
              <label key={sheet.number} className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={chosen.has(sheet.number)}
                  onChange={() => toggle(sheet.number)}
                />
                <span>
                  <code>{sheet.number}</code>
                  {sheet.name && <span className="opacity-60"> · {sheet.name}</span>}
                </span>
              </label>
            ))}
          </div>
        </div>
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

  // Ditulis di dalam efek, bukan saat render: menulis ref saat render tidak
  // aman di render konkuren — React boleh menjalankan badan komponen lalu
  // membuangnya, dan tulisan itu ikut terjadi untuk render yang dibatalkan.
  useEffect(() => {
    saved.current = fn;
  });

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => void saved.current(), 2000);
    return () => clearInterval(id);
  }, [active]);
}
