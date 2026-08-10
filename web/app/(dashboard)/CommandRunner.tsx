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

/** Satu perintah yang belum selesai di proyek ini, siapa pun pengirimnya. */
interface ActiveCommand {
  id: string;
  commandType: string;
  commandText: string;
  status: QueueStatus;
  queuedAt: string;
  /** Nama pengirimnya. Kosong untuk perintah yang datang dari bot Telegram. */
  who: string;
  mine: boolean;
}

/** Satu sheet di model, sebagaimana dikembalikan /list_sheets. */
interface SheetOption {
  number: string;
  name: string;
}

/** Jawaban /model_info: file yang sedang dibuka Revit dan setup di dalamnya. */
interface ModelInfo {
  title: string;
  path?: string | null;
  printSetups: string[];
  cadSetups: string[];
  /** Nama tipe family per kategori, mis. `lighting` → ["Downlight: LED 15W"]. */
  familyTypes: Record<string, string[]>;
  rooms: string[];
  /** Versi DLL add-in yang menjawab, dan bagaimana ia akan mengunggah file. */
  addinVersion: string;
  uploadMode: string;
}

/** Nilai penanda untuk pilihan "ketik nama lain" di dropdown tipe.
 *  String yang tidak mungkin jadi nama family Revit, supaya ia tidak
 *  pernah bertabrakan dengan pilihan yang sah. */
const MANUAL = "__ketik-sendiri__";

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

  /**
   * Yang sedang berjalan di proyek ini — perintah siapa pun, bukan hanya milik
   * sendiri.
   *
   * Satu Revit mengerjakan satu perintah pada satu waktu. Perintah cetak 40
   * sheet milik orang lain berarti perintah Anda menunggu belasan menit di
   * belakangnya, dan tanpa daftar ini yang terlihat cuma "Menunggu diambil
   * add-in" — bunyi yang sama persis dengan add-in yang mati.
   */
  const [active, setActive] = useState<ActiveCommand[]>([]);

  const [chatEntries, setChatEntries] = useState<ChatEntry[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const chatId = useRef(0);

  const [rooms, setRooms] = useState<string[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);

  const [sheets, setSheets] = useState<SheetOption[]>([]);
  const [sheetsLoading, setSheetsLoading] = useState(false);

  const [model, setModel] = useState<ModelInfo | null>(null);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelReachable, setModelReachable] = useState(true);

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

  // Semuanya milik satu model; berganti proyek berarti semuanya basi.
  useEffect(() => {
    setRooms([]);
    setSheets([]);
    setModel(null);
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

  /**
   * Perintah yang sudah berjalan di proyek ini dan bunyinya sama persis.
   *
   * Dua orang menekan Print PDF untuk sheet yang sama menghasilkan dua perintah
   * yang menulis ke nama berkas yang sama — nomor sheet plus nama sheet — dan
   * yang selesai kedua menimpa yang pertama. Tidak ada galat di mana pun; yang
   * pertama hanya kehilangan berkasnya tanpa pernah tahu.
   *
   * Dibandingkan lewat teks perintahnya, bukan lewat jenisnya: dua print_pdf
   * untuk sheet yang berbeda tidak bentrok, dan memperingatkan keduanya akan
   * melatih orang menutup peringatan tanpa membacanya.
   */
  function clashingWith(commandText: string) {
    return active.find((a) => !a.mine && a.commandText === commandText);
  }

  async function send() {
    if (!selected || !project) return;
    if (selected.confirm && !window.confirm(t("command.confirm"))) return;

    setSending(true);
    setIssues([]);

    try {
      const body = await enqueue(selected.name, values);

      // Diperiksa setelah perintahnya tersusun, karena yang dibandingkan adalah
      // teks akhirnya — dan teks itu baru ada setelah nilai formulir divalidasi
      // dan dirapikan server. Sudah masuk antrean pada titik ini, jadi yang
      // ditawarkan bukan membatalkan melainkan memberi tahu.
      const clash = clashingWith(body.commandText);
      if (clash) {
        setIssues([
          t("command.clash").replace("{who}", clash.who || t("command.clashSomeone")),
        ]);
      }

      setRuns((prev) => [{ id: body.id, commandText: body.commandText, status: "pending" }, ...prev]);
    } catch (err) {
      const withIssues = err as Error & { issues?: string[] };
      setIssues(withIssues.issues ?? [withIssues.message || t("command.sendFailed")]);
    } finally {
      setSending(false);
    }
  }

  /**
   * Mengirim penghapusan yang menyasar mark, bukan ruangan.
   *
   * delete_devices di add-in sudah menerima `marks` sejak awal — itulah yang
   * dipakai /undo di Telegram. Yang belum ada adalah jalan dari hasil sebuah
   * perintah ke sana, jadi satu-satunya pembatalan yang tersedia dari website
   * adalah Ctrl+Z di PC Revit: membatalkan apa pun yang terakhir terjadi di
   * dokumen itu, pekerjaan orang lain termasuk.
   *
   * what=all karena mark sudah menentukan elemennya secara tunggal; menyempitkan
   * kategori lagi hanya menambah cara baru untuk salah.
   */
  async function undoRun(room: string, marks: string[]) {
    setSending(true);
    setIssues([]);
    try {
      const body = await enqueue("delete_devices", {
        room,
        what: "all",
        marks: marks.join(","),
      });
      setRuns((prev) => [
        { id: body.id, commandText: body.commandText, status: "pending" },
        ...prev,
      ]);
    } catch (err) {
      const withIssues = err as Error & { issues?: string[] };
      setIssues(withIssues.issues ?? [withIssues.message || t("command.sendFailed")]);
    } finally {
      setSending(false);
    }
  }

  /**
   * Menumpuk perintah, lalu mengirim seluruhnya sekaligus.
   *
   * Antreannya sudah ada dan add-in sudah mengerjakannya berurutan; yang belum
   * ada adalah cara menyusun daftarnya. "Print 40 sheet, lalu export DWG-nya,
   * lalu kirim semuanya" sekarang berarti menunggu tiap perintah selesai
   * sebelum mengisi formulir berikutnya — dan itu pekerjaan malam yang menuntut
   * seseorang tetap duduk di depannya.
   *
   * Yang ditumpuk adalah SALINAN nilai formulirnya, bukan acuannya: formulir
   * yang sama dipakai untuk menyusun perintah berikutnya, dan tanpa salinan
   * seluruh tumpukan berubah setiap kali satu angka diketik.
   */
  const [staged, setStaged] = useState<{ name: string; values: Record<string, unknown> }[]>([]);

  function stage() {
    if (!selected) return;
    setStaged((prev) => [...prev, { name: selected.name, values: { ...values } }]);
    setIssues([]);
  }

  async function sendStaged() {
    if (!project || staged.length === 0) return;

    // Konfirmasi sekali untuk seluruh tumpukan, bukan sekali per perintah:
    // sepuluh dialog berturut-turut adalah sepuluh kali menekan OK tanpa
    // membaca, yang lebih buruk daripada satu dialog yang menyebut jumlahnya.
    const destructive = staged.some((s) => COMMANDS_BY_NAME[s.name]?.confirm);
    if (destructive && !window.confirm(t("command.confirm"))) return;

    setSending(true);
    setIssues([]);

    const failures: string[] = [];

    // Berurutan, bukan serentak. Urutan di daftar itulah maksudnya — export DWG
    // setelah print PDF, bukan bersamaan dengannya — dan Promise.all tidak
    // menjanjikan urutan apa pun soal kapan tiap baris masuk antrean.
    for (const item of staged) {
      try {
        const body = await enqueue(item.name, item.values);
        setRuns((prev) => [
          { id: body.id, commandText: body.commandText, status: "pending" },
          ...prev,
        ]);
      } catch (err) {
        const withIssues = err as Error & { issues?: string[] };
        // Yang gagal disebut namanya lalu dilewati. Menghentikan seluruh
        // tumpukan karena satu perintah yang salah berarti sembilan perintah
        // yang benar harus disusun ulang dari nol.
        failures.push(
          `${item.name}: ${withIssues.issues?.join(" ") ?? withIssues.message}`
        );
      }
    }

    setStaged(failures.length ? staged.filter((s) => failures.some((f) => f.startsWith(`${s.name}:`))) : []);
    setIssues(failures);
    setSending(false);
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

  /**
   * File .rvt yang sedang dibuka Revit, beserta setup yang tersimpan di
   * dalamnya.
   *
   * Proyek di website adalah baris di database; yang dikerjakan add-in adalah
   * file yang kebetulan terbuka di Revit. Keduanya biasanya sama, dan yang
   * mahal adalah saat keduanya tidak sama — perintah berangkat ke model yang
   * salah dan tidak ada apa pun di layar yang menunjukkannya.
   */
  const loadModel = useCallback(async () => {
    if (!project) return;
    setModelLoading(true);
    setModelReachable(true);
    try {
      const info = (await runAndWait("model_info", {})) as {
        title?: string;
        path?: string | null;
        print_setups?: string[];
        cad_setups?: string[];
        family_types?: Record<string, string[]>;
        rooms?: string[];
        addin_version?: string;
        upload_mode?: string;
      } | null;

      setModel({
        title: info?.title ?? "—",
        path: info?.path ?? null,
        printSetups: info?.print_setups ?? [],
        cadSetups: info?.cad_setups ?? [],
        familyTypes: info?.family_types ?? {},
        rooms: info?.rooms ?? [],
        addinVersion: info?.addin_version ?? "",
        uploadMode: info?.upload_mode ?? "",
      });

      // Nama ruangan datang bersama info model, jadi tombol "Ambil dari Revit"
      // di field ruangan tidak perlu ditekan lagi — daftarnya sudah ada
      // sebelum ada yang membuka formnya.
      if (info?.rooms?.length) setRooms(info.rooms);
    } catch {
      // Dijalankan sendiri saat halaman dibuka, jadi kegagalannya tidak boleh
      // muncul sebagai galat merah di atas form yang belum disentuh siapa pun.
      // Revit yang tertutup adalah keadaan yang wajar, bukan kesalahan — yang
      // ditampilkan cukup bahwa modelnya belum terbaca.
      setModel(null);
      setModelReachable(false);
    } finally {
      setModelLoading(false);
    }
  }, [project, runAndWait]);

  /**
   * Nama file Revit muncul sendiri, tanpa ada yang perlu menekan apa pun.
   *
   * Ini pertanyaan yang jawabannya selalu ingin diketahui dan tidak pernah
   * ingin ditanyakan: seluruh gunanya adalah melihat model mana yang akan
   * disentuh SEBELUM mengirim perintah, dan tombol yang harus ditekan lebih
   * dulu justru dilewati persis pada saat itu penting.
   *
   * Sekali per proyek terpilih. Setiap panggilan adalah satu baris di antrean
   * yang harus diambil add-in, jadi ini bukan sesuatu yang boleh diulang
   * berkala.
   */
  useEffect(() => {
    if (!project) return;
    loadModel();
    // loadModel sengaja tidak jadi dependensi: identitasnya berubah tiap render
    // dan efek ini hanya boleh berjalan saat proyeknya yang berganti.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.projectId]);

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
        body: JSON.stringify({
          message,
          projectId: project.projectId,
          history,
          // Nama yang benar-benar ada di model ikut dikirim.
          //
          // Tanpa ini asisten mengarang nama tipe yang masuk akal — "downlight"
          // alih-alih "ACT_E_Downlight: 18W" — dan perintahnya berangkat,
          // antre, lalu gagal di Revit karena family itu tidak ada. Yang
          // terlihat pengguna: perintah yang katanya terkirim, lampu yang tidak
          // pernah muncul di gambar, dan sebabnya di baris hasil yang harus
          // digulir untuk dibaca.
          //
          // Daftarnya sudah ada di halaman ini dari model_info; yang belum ada
          // adalah jalan dari sana ke prompt.
          context: model
            ? { familyTypes: model.familyTypes, rooms: model.rooms }
            : undefined,
        }),
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

      // Form tetap diisi, tapi ia bukan lagi gerbang yang harus dilewati: ia
      // jadi tempat memperbaiki satu angka lalu menjalankan ulang.
      const spec = COMMANDS_BY_NAME[body.command];
      if (spec) {
        setSelected(spec);
        setValues(body.values ?? {});
        setIssues([]);
      }

      const incomplete = Boolean(body.issues?.length);

      addChat({
        role: "proposal",
        text: body.note ?? "",
        commandText: body.commandText ?? `/${body.command}`,
        issues: body.issues,
      });

      // Langsung berangkat, seperti bot Telegram.
      //
      // Satu kalimat, satu perintah, hasilnya balik ke utas yang sama.
      // Sebelumnya usulannya berhenti di form dan orangnya masih harus menekan
      // kirim di sana — dua langkah untuk satu maksud, dan di telepon langkah
      // kedua itu berada di luar layar, jadi yang terasa adalah chat yang
      // mengerti permintaan lalu tidak melakukan apa-apa.
      //
      // Yang kurang lengkap tidak dikirim: daftar `issues` di gelembungnya
      // menyebutkan apa yang belum disebut, dan menebak sisanya berarti
      // menempatkan perangkat dengan angka yang tidak pernah diminta siapa pun.
      if (!spec || incomplete) return;

      // Satu pertanyaan untuk yang tidak bisa dibatalkan. Kecepatan tidak
      // sebanding dengan menghapus perangkat di model orang lain karena satu
      // kalimat yang salah tafsir.
      if (spec.confirm && !window.confirm(t("command.confirm"))) return;

      try {
        const queued = await enqueue(spec.name, body.values ?? {});
        setRuns((prev) => [
          { id: queued.id, commandText: queued.commandText, status: "pending" },
          ...prev,
        ]);
      } catch (err) {
        const withIssues = err as Error & { issues?: string[] };
        addChat({
          role: "assistant",
          text: withIssues.issues?.join(" ") ?? withIssues.message ?? t("command.sendFailed"),
        });
      }
    } catch (err) {
      addChat({ role: "assistant", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setChatBusy(false);
    }
  }

  /**
   * Antrean proyek dibaca terus-menerus, bukan hanya saat ada perintah sendiri
   * yang berjalan.
   *
   * Justru ketika tidak punya perintah berjalan-lah daftar ini paling berguna:
   * itu saat orang memutuskan apakah aman mengirim sesuatu sekarang. Polling
   * yang hanya jalan saat sibuk akan diam tepat di saat pertanyaannya muncul.
   */
  const refreshActive = useCallback(async () => {
    if (!project) return;
    try {
      const res = await fetch(
        `/api/commands/active?projectId=${encodeURIComponent(project.projectId)}`
      );
      if (!res.ok) return;
      const body = (await res.json()) as { commands: ActiveCommand[] };
      setActive(body.commands ?? []);
    } catch {
      // Jaringan yang sedang buruk bukan alasan menampilkan galat di panel ini:
      // isinya sudah kedaluwarsa beberapa detik dan itu memang wajar. Daftar
      // yang lama tetap lebih berguna daripada pesan kesalahan.
    }
  }, [project]);

  useEffect(() => {
    void refreshActive();
  }, [refreshActive]);

  usePolling(Boolean(project), refreshActive);

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

        {/* File yang sedang dibuka Revit. Proyek di atas adalah baris di
            database; ini yang benar-benar akan disentuh perintahnya. */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="opacity-60">{t("command.modelFile")}</span>
          {model ? (
            <>
              <span className="font-medium" title={model.path ?? undefined}>
                {model.title}
              </span>
              {/* Versi add-in dan cara unggahnya. Tanpa keduanya, "sudah
                  terpasang atau belum" dan "setelan saya terbaca atau tidak"
                  hanya bisa ditebak — dan menebaknya sudah memakan berhari-hari. */}
              {model.addinVersion && (
                <span className="opacity-55">add-in {model.addinVersion}</span>
              )}
              {model.uploadMode && (
                <span className="opacity-55">· unggah: {model.uploadMode}</span>
              )}
            </>
          ) : (
            <span className="opacity-55">
              {modelLoading
                ? t("command.modelLoading")
                : modelReachable
                  ? t("command.modelUnknown")
                  : t("command.modelOffline")}
            </span>
          )}
          {/* Tombolnya hanya muncul kalau pembacaan otomatisnya gagal — untuk
              mencoba lagi setelah Revit dibuka, bukan sebagai langkah biasa. */}
          {!model && !modelLoading && (
            <button
              type="button"
              onClick={loadModel}
              className="text-accent underline"
            >
              {t("command.modelRetry")}
            </button>
          )}
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
                model={model}
                modelLoading={modelLoading}
                onLoadModel={loadModel}
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
                model={model}
                modelLoading={modelLoading}
                onLoadModel={loadModel}
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

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={send} disabled={sending} className="btn-accent">
              {sending ? t("command.sending") : t("command.send")}
            </button>
            {/* Menumpuk, bukan mengirim. Ada di samping tombol kirim karena
                keputusannya diambil pada saat yang sama — setelah formulirnya
                diisi, sebelum apa pun berangkat. */}
            <button
              type="button"
              onClick={stage}
              disabled={sending}
              className="glass-input px-3 py-1.5 text-sm disabled:opacity-40"
            >
              {t("command.stageAdd")}
            </button>
          </div>

          {staged.length > 0 && (
            <div className="space-y-2 rounded-xl border border-black/5 p-3 dark:border-white/10">
              <p className="text-xs opacity-70">
                {t("command.stageTitle").replace("{n}", String(staged.length))}
              </p>
              <ol className="list-decimal space-y-0.5 pl-5 text-xs">
                {staged.map((item, index) => (
                  <li key={index} className="flex items-center justify-between gap-2">
                    <code className="break-all">/{item.name}</code>
                    <button
                      type="button"
                      onClick={() => setStaged((prev) => prev.filter((_, i) => i !== index))}
                      className="shrink-0 text-red-500 underline"
                    >
                      {t("command.stageRemove")}
                    </button>
                  </li>
                ))}
              </ol>
              <div className="flex flex-wrap gap-2">
                <button onClick={sendStaged} disabled={sending} className="btn-accent">
                  {sending
                    ? t("command.sending")
                    : t("command.stageSend").replace("{n}", String(staged.length))}
                </button>
                <button
                  type="button"
                  onClick={() => setStaged([])}
                  disabled={sending}
                  className="glass-input px-3 py-1.5 text-sm disabled:opacity-40"
                >
                  {t("command.stageClear")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Antrean proyek: siapa sedang menjalankan apa.
          Di bawah formulir, di atas hasil — tempat orang melihatnya saat
          memutuskan apakah aman mengirim sesuatu sekarang. */}
      {active.length > 0 && (
        <div className="glass-panel space-y-2 p-6">
          <h2 className="font-medium">{t("command.activeTitle")}</h2>
          <p className="text-xs opacity-60">{t("command.activeNote")}</p>
          <ul className="space-y-1 text-xs">
            {active.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2">
                <span
                  className={
                    a.status === "processing" ? "text-accent" : "opacity-60"
                  }
                >
                  {t(`command.status.${a.status}`)}
                </span>
                <span className="font-medium">
                  {a.mine ? t("command.activeMine") : a.who || t("command.clashSomeone")}
                </span>
                <code className="break-all opacity-80">{a.commandText}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      {runs.length > 0 && (
        <div className="glass-panel space-y-3 p-6">
          <h2 className="font-medium">{t("command.results")}</h2>
          {/* Digulir di dalam kotaknya. Satu sesi kerja menumpuk puluhan
              perintah, dan daftar yang tumbuh tanpa batas mendorong segalanya
              ke bawah sampai form perintahnya sendiri hilang dari layar. */}
          <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
            {runs.map((r) => (
              <RunRow key={r.id} run={r} onUndo={undoRun} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RunRow({
  run,
  onUndo,
}: {
  run: RunEntry;
  /** Absen kalau perintah ini tidak bisa dibatalkan. */
  onUndo?: (room: string, marks: string[]) => void;
}) {
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

      {onUndo && <UndoButton result={run.result} onUndo={onUndo} />}
    </div>
  );
}

/**
 * Membatalkan tepat apa yang perintah INI tambahkan.
 *
 * Bukan Ctrl+Z. Ctrl+Z di Revit membatalkan apa pun yang terakhir terjadi di
 * dokumen itu — termasuk pekerjaan orang lain yang menyimpan sesudahnya, dan
 * termasuk di PC yang mungkin bukan PC pengirim perintahnya.
 *
 * Yang dipakai adalah mark yang dilaporkan penempatannya sendiri, jadi yang
 * terhapus persis enam armatur yang barusan dipasang — bukan seluruh kategori
 * di ruangan itu, dan bukan armatur yang ditambahkan rekan setelahnya.
 *
 * Hanya muncul untuk hasil yang punya mark DAN ruangan. Penghapusan tidak bisa
 * dibatalkan dengan cara ini: mark yang sudah tidak ada di model tidak bisa
 * dipasang kembali oleh perintah hapus.
 */
function UndoButton({
  result,
  onUndo,
}: {
  result: unknown;
  onUndo: (room: string, marks: string[]) => void;
}) {
  const { t } = useI18n();

  if (typeof result !== "object" || result === null) return null;
  const data = result as { room?: unknown; device_ids?: unknown; dry_run?: unknown };

  // Uji coba tidak menambah apa pun, jadi tidak ada yang bisa dibatalkan.
  if (data.dry_run === true) return null;

  const room = typeof data.room === "string" ? data.room : "";
  const marks = Array.isArray(data.device_ids)
    ? data.device_ids.filter((m): m is string => typeof m === "string" && m.length > 0)
    : [];

  if (!room || marks.length === 0) return null;

  return (
    <button
      type="button"
      onClick={() => {
        if (window.confirm(t("command.undoConfirm").replace("{n}", String(marks.length)))) {
          onUndo(room, marks);
        }
      }}
      className="text-xs text-red-500 underline"
    >
      {t("command.undo").replace("{n}", String(marks.length))}
    </button>
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
  model,
  modelLoading,
  onLoadModel,
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
  model: ModelInfo | null;
  modelLoading: boolean;
  onLoadModel: () => void;
  onChange: (v: unknown) => void;
}) {
  const { t } = useI18n();
  const isRoom = field.name === "room";
  const isSheets = field.name === "sheets";

  // Field tipe perangkat diisi dari family yang benar-benar ada di model.
  // Nama family diketik dari ingatan adalah cara paling mudah sebuah perintah
  // gagal — dan gagalnya baru ketahuan setelah menunggu Revit menjawab.
  const typeOptions = field.name.endsWith("_type")
    ? (model?.familyTypes?.[field.name.replace(/_type$/, "")] ?? [])
    : [];

  // Sudah memilih untuk mengetik sendiri, karena family yang dibutuhkan belum
  // ada di daftar yang terakhir dibaca dari model.
  const [typedByHand, setTypedByHand] = useState(false);

  // Pilihan yang hanya diketahui model yang sedang terbuka.
  if (field.optionsFrom) {
    const fromModel =
      field.optionsFrom === "print_setups" ? model?.printSetups : model?.cadSetups;

    return (
      <label className="space-y-1">
        <span className="flex items-center justify-between gap-2">
          <span className="text-sm">{field.label[locale]}</span>
          <button
            type="button"
            onClick={onLoadModel}
            disabled={modelLoading}
            className="text-xs text-accent underline disabled:opacity-40"
          >
            {modelLoading ? t("command.modelLoading") : t("command.modelRetry")}
          </button>
        </span>

        {fromModel && fromModel.length > 0 ? (
          <select
            className="glass-input w-full"
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
          >
            {/* Kosong adalah pilihan yang sah dan berarti "pakai bawaan Revit". */}
            <option value="">{t("command.setupDefault")}</option>
            {fromModel.map((name: string) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        ) : (
          <>
            <input
              className="glass-input w-full"
              type="text"
              value={String(value ?? "")}
              onChange={(e) => onChange(e.target.value)}
            />
            <span className="block text-xs opacity-55">
              {fromModel ? t("command.setupNone") : t("command.setupAsk")}
            </span>
          </>
        )}

        {field.hint && <span className="block text-xs opacity-55">{field.hint[locale]}</span>}
      </label>
    );
  }

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
      ) : typeOptions.length > 0 && !typedByHand ? (
        /* Dropdown, bukan kolom teks dengan saran.
         *
         * Nama family Revit tidak bisa ditebak dan tidak bisa dipendekkan:
         * "ACT_E_DOWNLIGHT 22WATT" yang ditulis "downlight" bukan nama yang
         * mirip, ia nama yang tidak ada — dan perintahnya baru gagal setelah
         * antre dan dijalankan Revit, dengan gambar yang tetap kosong. Sebuah
         * datalist masih mengizinkan itu diketik; dropdown tidak.
         *
         * Daftarnya per kategori: kolom "Tipe armatur" hanya menawarkan
         * Lighting Fixtures, bukan seluruh family di model. */
        <>
          <select
            className="glass-input w-full"
            value={String(value ?? "")}
            onChange={(e) => {
              if (e.target.value === MANUAL) {
                setTypedByHand(true);
                onChange("");
                return;
              }
              onChange(e.target.value);
            }}
          >
            <option value="">{t("command.typePick")}</option>
            {typeOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
            {/* Jalan keluar, bukan jalan utama: daftar ini hanya sebaik model
                yang terakhir dibaca, dan family yang baru dimuat setelah itu
                tidak boleh membuat form ini mustahil diisi. */}
            <option value={MANUAL}>{t("command.typeManual")}</option>
          </select>
          <span className="block text-xs opacity-55">
            {t("command.typeCount").replace("{n}", String(typeOptions.length))}
          </span>
        </>
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
          {/* Ruangan tetap datalist: namanya diketik orang di Revit, jadi yang
              baru dibuat setelah daftar ini dibaca masih harus bisa disebut. */}
          {isRoom && rooms.length > 0 && (
            <datalist id="revit-rooms">
              {rooms.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          )}
          {typeOptions.length > 0 && typedByHand && (
            <button
              type="button"
              onClick={() => {
                setTypedByHand(false);
                onChange("");
              }}
              className="text-xs text-accent underline"
            >
              {t("command.typeBackToList")}
            </button>
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
