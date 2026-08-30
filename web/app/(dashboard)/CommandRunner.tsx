"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useProjects, type ProjectAccess } from "@/lib/useProjects";
import {
  COMMANDS,
  COMMANDS_BY_NAME,
  canRun,
  familyCategoryOf,
  fieldApplies,
  modifyCategoryFor,
  modifyValuesFrom,
  type CommandField,
  type CommandSpec,
} from "@/lib/commands";
import { familiesFor, matchFamily, type RevitFamily } from "@/lib/families";
import { autoGrid, awkwardCount, flip, formatGrid, friendlierCounts, gridCount, parseGrid } from "@/lib/grid";
import { turnsFromChat, type ChatBubble } from "@/lib/chatHistory";
import { summarizeResult } from "@/lib/resultSummary";
import { digestResult } from "@/lib/resultDigest";
import { elementIdsIn } from "@/lib/elementIds";
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

/**
 * Berapa pembacaan yang boleh dijalankan sendiri untuk satu pertanyaan.
 *
 * HARUS sama dengan MAX_AUTO_STEPS di app/api/ai/electrical/route.ts. Yang di
 * sana yang menegakkannya — sebuah langkah kelima ditolak dengan 400 — dan yang
 * di sini yang berhenti dengan sopan sebelum sampai ke situ. Kalau keduanya
 * berbeda, yang terlihat pengguna adalah galat di langkah terakhir, bukan
 * kalimat yang menjelaskan bahwa pembacaannya sudah cukup banyak.
 */
const MAX_AUTO_STEPS = 4;

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

/** Apa yang sudah terpasang di satu ruangan untuk satu kategori, menurut Revit. */
interface RoomContents {
  count: number;
  marks: string[];
}

/**
 * Jawaban atas "ruangan ini sudah berisi".
 *
 * `skip` dan `cancel` hanya berbeda saat perintahnya bagian dari satu
 * pengiriman ke banyak ruangan: yang pertama melewati ruangan ini, yang kedua
 * menghentikan sisanya.
 */
type CrossroadChoice = "modify" | "add" | "skip" | "cancel";

/**
 * Pilihan yang harus diambil orangnya sebelum perintahnya berangkat: ruangannya
 * ternyata sudah berisi.
 */
interface Crossroads {
  room: string;
  category: string;
  found: RoomContents;
  /**
   * Kenapa "tata ulang" tidak bisa ditawarkan, kalau memang tidak bisa.
   *
   * `count` — belum ada jumlah maupun grid baru, jadi tidak ada yang bisa
   * ditata ulang menjadi apa.
   *
   * `dryRun` — "Uji coba saja" dicentang. /modify_devices tidak punya kolom itu,
   * jadi berpindah ke sana berarti centangnya hilang tanpa suara dan modelnya
   * benar-benar berubah — kebalikan persis dari yang diminta orangnya.
   */
  modifyBlocked: null | "count" | "dryRun";
  /** Bagian dari satu pengiriman ke banyak ruangan. */
  batch?: boolean;
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

/**
 * Jarak terpendek antara dua pembacaan `model_info`.
 *
 * Panel ini hidup sebagai dockable pane di dalam Revit, dan berpindah antara
 * jendela Revit dan panelnya memicu `focus` berkali-kali dalam beberapa detik.
 * Tanpa jarak minimum, satu kali menyeret jendela berarti selusin baris antrean
 * yang harus diambil add-in satu per satu.
 */
const MODEL_MIN_GAP_MS = 15_000;

/**
 * Selang pembacaan berkala selama panelnya terlihat.
 *
 * Ini ongkos yang dibayar dengan sadar. Dulu `model_info` dibaca SEKALI per
 * proyek terpilih, dengan alasan yang benar — setiap pembacaan adalah satu baris
 * antrean — dan akibatnya persis yang dilaporkan: orang membuka file .rvt lain
 * di Revit, panelnya tetap menyebut nama file yang lama, dan perintah berikutnya
 * berangkat ke dokumen yang tidak sedang dilihat siapa pun. Nama file yang salah
 * di layar lebih mahal daripada satu baris antrean per menit, dan hanya salah
 * satu dari keduanya yang bisa dilihat orangnya sebelum terlambat.
 *
 * Berhenti sendiri saat tab-nya tidak terlihat: yang tidak ada di layar tidak
 * bisa menyesatkan siapa pun.
 */
const MODEL_POLL_MS = 60_000;

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

  /** Kapan add-in terakhir menyelesaikan sesuatu di proyek ini, dan apakah ia sedang sibuk. */
  const [addin, setAddin] = useState<{ busy: boolean; lastSeen: string | null }>({
    busy: false,
    lastSeen: null,
  });

  const [chatEntries, setChatEntries] = useState<ChatEntry[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const chatId = useRef(0);

  /**
   * Pembacaan keberapa yang sedang berjalan dalam pertanyaan ini; 0 = tidak ada
   * rantai yang berjalan.
   *
   * Ditampilkan karena satu pertanyaan sekarang bisa berarti empat perjalanan ke
   * Revit, dan tanpa angka ini yang terlihat cuma "Menyusun perintah…" yang tidak
   * berubah selama beberapa menit — bunyi yang sama persis dengan halaman yang
   * menggantung.
   */
  const [chatStep, setChatStep] = useState(0);

  /**
   * Ditekan orangnya untuk memotong rantai baca yang berjalan terlalu lama.
   *
   * Sebuah ref, bukan state: yang membacanya adalah loop di dalam `sendChat`,
   * yang berjalan melewati beberapa await dan karena itu memegang nilai state
   * dari render saat ia dipanggil. Sebuah state di sini akan selalu terbaca
   * `false` di dalam loop — tombolnya menyala, dan tidak menghentikan apa pun.
   */
  const chatStopped = useRef(false);

  /**
   * Gelembung mana yang menunggu jawaban perintah mana: id antrean → id gelembung.
   *
   * Jawaban Revit datang lewat polling, terlepas dari percakapan, dan tanpa peta
   * ini ia tidak bisa menemukan jalan kembali ke gelembung yang menanyakannya.
   */
  const runBubble = useRef(new Map<string, number>());

  /**
   * Isi ruangan yang sudah dibaca dari Revit, per ruangan dan kategori.
   *
   * Disimpan karena setiap pembacaan adalah satu baris antrean yang harus diambil
   * add-in — bukan sesuatu yang boleh diulang setiap kali tombol kirim ditekan.
   * Dikosongkan begitu ada perintah yang mengubah model, karena sejak itu ia tidak
   * lagi benar.
   */
  const [roomContents, setRoomContents] = useState<Record<string, RoomContents>>({});
  const [checkingRoom, setCheckingRoom] = useState(false);

  /** Menunggu orangnya memilih: tata ulang, tambah di atasnya, lewati, atau batal. */
  const [crossroads, setCrossroads] = useState<Crossroads | null>(null);
  const crossroadsChoice = useRef<((choice: CrossroadChoice) => void) | null>(null);

  /**
   * Jawaban yang dipakai untuk sisa ruangan dalam satu pengiriman berkelompok.
   *
   * Lima ruangan yang tiga di antaranya sudah berisi berarti tiga pertanyaan
   * yang sama berturut-turut, dan tiga pertanyaan identik adalah tiga kali
   * menekan tombol tanpa membacanya. Dijawab sekali, berlaku untuk sisanya.
   */
  const batchAnswer = useRef<CrossroadChoice | null>(null);
  const batchStopped = useRef(false);

  /** Kotak formulir, untuk dibawa ke depan mata saat sebuah command dipilih. */
  const formBox = useRef<HTMLDivElement>(null);

  const [rooms, setRooms] = useState<string[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);

  const [sheets, setSheets] = useState<SheetOption[]>([]);
  const [sheetsLoading, setSheetsLoading] = useState(false);

  const [model, setModel] = useState<ModelInfo | null>(null);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelReachable, setModelReachable] = useState(true);

  /**
   * Pemeriksaan terakhir tidak dijawab, sementara nama file yang lama masih
   * tampil.
   *
   * Dibedakan dari `modelReachable` dengan sengaja. Revit yang sedang menghitung
   * sesuatu tidak mengambil baris antrean tepat waktu, dan menghapus nama file
   * yang sudah benar karena itu berarti menukar keterangan dengan ketiadaan
   * keterangan. Yang ditampilkan tetap nama yang terakhir dijawab — ditandai
   * bahwa ia belum dipastikan lagi.
   */
  const [modelStale, setModelStale] = useState(false);

  /**
   * Nama file yang tampil sebelum Revit menyebut nama lain.
   *
   * Berganti dokumen di tengah jalan adalah kejadian yang harus DIKATAKAN,
   * bukan sekadar diperbaiki diam-diam: daftar ruangan, daftar sheet, dan isi
   * ruangan yang sudah dibaca semuanya milik dokumen yang lama, dan nama ruangan
   * yang sedang setengah diketik di formulir bisa saja tidak ada di dokumen yang
   * baru. Yang menutupnya adalah orangnya sendiri — atau pergantian berikutnya,
   * yang menggantinya dengan nama yang baru saja ditinggalkan.
   */
  const [switchedFrom, setSwitchedFrom] = useState<string | null>(null);

  /** Judul dokumen yang sedang tampil, untuk dibandingkan di luar render. */
  const modelTitle = useRef<string | null>(null);
  /** Satu pembacaan `model_info` pada satu waktu. */
  const modelBusy = useRef(false);
  /** Kapan pembacaan terakhir DIMULAI — dasar jarak minimum di atas. */
  const lastModelRead = useRef(0);

  /**
   * Baris `model_info` yang sudah diantre tapi belum dijawab.
   *
   * Antrean Revit satu jalur: satu perintah pada satu waktu. Sebuah print 40
   * sheet berarti `model_info` kita duduk di belakangnya belasan menit, dan
   * pembacaannya menyerah menunggu jauh sebelum itu. Barisnya sendiri TIDAK
   * hilang karena kita berhenti menunggu — ia tetap di antrean dan tetap akan
   * dijalankan. Jadi pembacaan berikutnya menyambung menunggu baris yang sama,
   * bukan mengantre yang kedua: tanpa ini, satu print panjang meninggalkan
   * belasan baris model_info yang dijalankan beruntun sesudahnya, semuanya
   * dengan jawaban yang sama persis, semuanya menahan perintah berikutnya yang
   * benar-benar diminta orangnya.
   */
  const pendingModelRead = useRef<string | null>(null);

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
    setRoomContents({});
    // Bukan pergantian dokumen di Revit, jadi tidak ada yang perlu dikatakan —
    // orangnya sendiri yang baru saja mengganti proyeknya.
    modelTitle.current = null;
    setSwitchedFrom(null);
    setModelStale(false);
    // Barisnya milik proyek yang tadi; menunggunya di proyek ini akan
    // menjawab tentang model yang salah.
    pendingModelRead.current = null;
  }, [project?.projectId]);

  /** Menambah satu gelembung dan mengembalikan id-nya, supaya ia bisa dikoreksi nanti. */
  function addChat(entry: ChatBody): number {
    const id = ++chatId.current;
    setChatEntries((prev) => [...prev, { ...entry, id }]);
    return id;
  }

  /** Mengoreksi gelembung yang sudah tampil — dipakai saat hasil pengirimannya diketahui. */
  function patchChat(id: number, patch: Partial<ChatEntry>) {
    setChatEntries((prev) =>
      prev.map((e) => (e.id === id ? ({ ...e, ...patch } as ChatEntry) : e))
    );
  }

  /** Menutup formulir tanpa menyentuh apa pun yang sudah dikirim. */
  function closeForm() {
    setSelected(null);
    setValues({});
    setIssues([]);
  }

  function pick(spec: CommandSpec, initial?: Record<string, unknown>) {
    setSelected(spec);
    setIssues([]);
    // Default dari katalog dipakai sebagai nilai awal, jadi apa yang terlihat
    // di form sama dengan apa yang akan dijalankan add-in.
    const init: Record<string, unknown> = {};
    for (const f of spec.fields) if (f.default !== undefined) init[f.name] = f.default;
    setValues({ ...init, ...initial });

    // Formulirnya dibawa ke depan mata.
    //
    // Di telepon, formulir ini berada di bawah panel percakapan dan di bawah
    // deretan tombol — jadi menekan sebuah tombol perintah tidak mengubah apa pun
    // yang terlihat di layar. Yang tampak: tombol yang tidak bekerja. Yang
    // sebenarnya terjadi: formulirnya terbuka, satu layar penuh di bawah sana.
    requestAnimationFrame(() => {
      formBox.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
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

  /**
   * Menjalankan satu perintah baca lalu menunggu jawabannya.
   *
   * Jawabannya datang lewat antrean yang sama seperti perintah lain, jadi ini
   * hanya berhasil kalau Revit terbuka dan add-in berjalan — dan itu memang
   * satu-satunya sumber yang tahu isi model. Dibatasi jumlah percobaan supaya
   * Revit yang tertutup tidak membuat tombolnya berputar selamanya.
   */
  const runAndWait = useCallback(
    async (commandName: string, vals: Record<string, unknown>, tries = 30) => {
      const { id } = await enqueue(commandName, vals);

      for (let i = 0; i < tries; i++) {
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

  /**
   * Menunggu perintah yang SUDAH diantre sampai Revit menjawabnya.
   *
   * Berbeda dari `runAndWait` di atas, dan bedanya perlu: yang ini tidak
   * mengantre apa pun. Barisnya sudah dibuat `dispatch`, gelembungnya sudah
   * menampilkan kemajuannya lewat polling yang memang sudah ada, dan yang belum
   * ada cuma satu hal — sebuah janji yang selesai ketika hasilnya sampai,
   * supaya rantai baca bisa melanjutkan ke langkah berikutnya.
   *
   * Ya, ini berarti dua pihak menanyakan perintah yang sama setiap dua detik:
   * yang ini untuk mengendalikan rantainya, dan polling gelembung untuk
   * menampilkan hasilnya. Dibiarkan begitu dengan sengaja — menggabungkannya
   * berarti loop ini harus mengamati perubahan state React dari dalam sebuah
   * fungsi async, dan cara-cara melakukan itu semuanya lebih mudah salah
   * daripada satu permintaan GET tambahan pada JSON sebesar beberapa ratus byte.
   *
   * 45 × 2 detik: satu `inspect` pada model besar bisa lama, dan yang lebih
   * buruk daripada menunggu sembilan puluh detik adalah rantai yang menyerah
   * tepat sebelum Revit menjawab. Tombol Berhenti yang membuat angka itu boleh
   * sebesar ini.
   */
  const waitForRun = useCallback(async (id: string, tries = 45) => {
    for (let i = 0; i < tries; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      if (chatStopped.current) return null;

      const res = await fetch(`/api/commands?id=${encodeURIComponent(id)}`);
      if (!res.ok) continue;

      const cmd = (await res.json()) as QueuedCommand;
      if (TERMINAL.includes(cmd.status)) return cmd;
    }
    return null;
  }, []);

  /** Daftar `{ id, label }` yang dikembalikan query dan list_sheets. */
  function itemsOf(result: unknown) {
    return (result as { items?: { id?: string; label?: string }[] })?.items ?? [];
  }

  function contentsKey(room: string, category: string) {
    return `${category}|${room.trim().toLowerCase()}`;
  }

  /**
   * Apa yang sudah terpasang di sebuah ruangan, dibaca dari Revit.
   *
   * Dipakai untuk menjawab satu pertanyaan yang sebelumnya tidak pernah
   * ditanyakan sebelum perintah berangkat: apakah ruangan ini sudah berisi?
   * "Pasang 10 lampu" di ruangan yang sudah punya 9 armatur bukan permintaan
   * untuk 19 armatur bertumpuk di satu plafon — dua grid dengan jarak berbeda,
   * sirkuit ganda, dan schedule yang menghitung dua kali. Maksudnya "jadikan
   * 10", dan itu perintah yang berbeda.
   *
   * Batas percobaannya lebih pendek daripada pembacaan lain: ini berdiri tepat di
   * depan tombol kirim, dan menahan pengiriman satu menit karena Revit tertutup
   * lebih buruk daripada tidak memeriksa sama sekali.
   */
  const readRoom = useCallback(
    async (room: string, category: string, force = false): Promise<RoomContents | null> => {
      const key = contentsKey(room, category);
      if (!force && roomContents[key]) return roomContents[key];

      setCheckingRoom(true);
      try {
        const result = await runAndWait(
          "query",
          { room, what: category, detail: "list", limit: 500 },
          8
        );
        const items = itemsOf(result);
        const reported = (result as { count?: unknown })?.count;
        const found: RoomContents = {
          count: typeof reported === "number" ? reported : items.length,
          marks: items.map((it) => it.id ?? it.label ?? "").filter(Boolean),
        };
        setRoomContents((prev) => ({ ...prev, [key]: found }));
        return found;
      } catch {
        // Revit tertutup, atau ruangannya tidak ada. Keduanya bukan alasan
        // menahan perintahnya: yang hilang cuma pemeriksaan tambahan ini, dan
        // add-in tetap punya kata terakhir soal ruangan yang tidak ditemukan.
        return null;
      } finally {
        setCheckingRoom(false);
      }
    },
    [runAndWait, roomContents]
  );

  /** Menunggu orangnya memutuskan apa yang harus terjadi pada ruangan yang sudah berisi. */
  function askCrossroads(info: Crossroads): Promise<CrossroadChoice> {
    // Sudah dijawab untuk seluruh sisa pengiriman berkelompok.
    if (info.batch && batchAnswer.current) return Promise.resolve(batchAnswer.current);

    return new Promise((resolve) => {
      crossroadsChoice.current = resolve;
      setCrossroads(info);
      requestAnimationFrame(() => {
        formBox.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  function answerCrossroads(choice: CrossroadChoice, applyToRest = false) {
    if (applyToRest && choice !== "cancel") batchAnswer.current = choice;
    if (choice === "cancel") batchStopped.current = true;

    const resolve = crossroadsChoice.current;
    crossroadsChoice.current = null;
    setCrossroads(null);
    resolve?.(choice);
  }


  /**
   * Mengirim satu perintah, dengan satu pertanyaan yang perlu ditanyakan lebih
   * dulu: kalau ruangannya sudah berisi kategori itu, yang dimaksud hampir selalu
   * menata ulang — bukan menumpuk satu set lagi di atasnya.
   *
   * Satu jalan untuk formulir DAN untuk percakapan. Pemeriksaan yang hanya ada di
   * salah satunya adalah pemeriksaan yang bisa dilewati dengan mengetik kalimat.
   */
  const dispatch = useCallback(
    async (spec: CommandSpec, vals: Record<string, unknown>, batch = false) => {
      let name = spec.name;
      let payload = vals;

      const category = modifyCategoryFor(spec.name);
      const room = String(vals[spec.positional?.name ?? "room"] ?? "").trim();

      // Hanya kalau modelnya memang bisa ditanya. Tanpa Revit yang menjawab,
      // pemeriksaan ini cuma jeda enam belas detik sebelum perintahnya tetap
      // berangkat seperti apa adanya.
      if (category && room && model) {
        const found = await readRoom(room, category);
        if (found && found.count > 0) {
          const modifyValues = modifyValuesFrom(spec, category, vals);
          const dryRun = vals.dry_run === true || vals.dry_run === "true";
          const modifyBlocked = dryRun
            ? ("dryRun" as const)
            : modifyValues.count === undefined && modifyValues.grid === undefined
              ? ("count" as const)
              : null;

          const choice = await askCrossroads({ room, category, found, modifyBlocked, batch });

          if (choice === "cancel" || choice === "skip") return null;
          if (choice === "modify") {
            name = "modify_devices";
            payload = modifyValues;
          }
        }
      }

      // MODIFIKASI BERANGKAT APA ADANYA — tidak dibaca dulu, tidak ditukar.
      //
      // Di sini dulu ada pembacaan kedua: /modify_devices ditahan, isi ruangannya
      // ditanyakan ke Revit, dan kalau jawabannya nol perintahnya DITUKAR jadi
      // place_*. Maksudnya baik — menata ulang ruangan kosong dianggap perintah
      // yang tidak bisa berhasil — dan ketiga bagiannya ternyata salah.
      //
      // Ia tidak perlu. `ModifyDevicesHandler` di add-in menjalankan
      // delete_devices lalu place_*; delete pada ruangan kosong mengembalikan
      // "0 dihapus" dan bukan galat, jadi modify di ruangan kosong SUDAH sama
      // persis hasilnya dengan place. Tidak ada yang perlu ditolong.
      //
      // Ia berbahaya. "Ganti" dan "tambah" adalah dua perintah yang berbeda, dan
      // yang membedakannya cuma satu pembacaan yang bisa salah — /query yang
      // melaporkan nol untuk ruangan yang sebenarnya berisi menukar "ganti enam
      // lampu" jadi "tambah enam lampu", dan yang terlihat di Revit adalah dua
      // belas armatur di plafon yang sama. Persis keluhannya: lampunya tidak
      // berganti.
      //
      // Ia lambat. Satu pembacaan adalah satu baris antrean yang harus diambil
      // add-in, ditunggu sampai enam belas detik, SEBELUM perintah yang diminta
      // orangnya berangkat — pada perintah yang paling sering diminta berulang
      // kali justru karena hasilnya belum terlihat.
      //
      // Dan ia melihat masa lalu untuk menjawab pertanyaan tentang sekarang.
      // Yang tahu keadaan model sekarang adalah orang yang sedang menatap layar
      // Revit. Ia sudah melihatnya, dan ia sudah mengetik apa yang ia mau.

      const body = await enqueue(name, payload);

      // Modelnya berubah sesudah ini, jadi yang kita ketahui tentang isi ruangan
      // sudah tidak benar lagi.
      setRoomContents({});

      setRuns((prev) => [
        { id: body.id, commandText: body.commandText, status: "pending" },
        ...prev,
      ]);
      return body;
    },
    [enqueue, model, readRoom]
  );

  async function send() {
    if (!selected || !project) return;
    if (selected.confirm && !window.confirm(t("command.confirm"))) return;

    setSending(true);
    setIssues([]);

    try {
      const body = await dispatch(selected, values);
      if (!body) return;

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
      setRoomContents({});
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
   * Menunjukkan elemen ber-ID tertentu di layar Revit.
   *
   * Berangkat lewat `runProposal`, sama seperti perintah yang disusun model —
   * bukan lewat jalur tersendiri. Itu yang membuat gelembungnya ikut punya
   * status, id antrean, dan hasil yang datang belakangan: add-in yang tidak
   * berjalan membuat perintah ini menggantung `pending` selamanya, dan tanpa
   * gelembung yang mengikutinya, yang tampak adalah kolom tulis yang menerima
   * ketikan lalu tidak melakukan apa-apa.
   */
  async function showElement(ids: string) {
    const bubble = addChat({
      role: "proposal",
      text: t("chat.showElement").replace("{ids}", ids.replace(/,/g, ", ")),
      commandText: `/show_element ${ids}`,
      command: "show_element",
      values: { ids },
      state: "sending",
    });

    await runProposal(bubble, COMMANDS_BY_NAME.show_element, { ids });
  }

  /**
   * Membatalkan perintah sendiri yang masih menunggu diambil add-in.
   *
   * Sebuah baris `pending` yang tidak pernah diambil — Revit tertutup, add-in
   * belum dipasang, atau perintahnya memang salah kirim — sebelumnya tidak punya
   * jalan keluar dari sini sama sekali. Ia tetap paling depan di antrean, dan
   * begitu Revit dibuka ia langsung berjalan: perintah dari sejam lalu, ke model
   * yang sudah berubah, tanpa ada yang memintanya lagi.
   */
  async function cancelRun(id: string) {
    try {
      const res = await fetch(`/api/commands?id=${encodeURIComponent(id)}`, { method: "PATCH" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setIssues([body.error ?? t("command.cancelFailed")]);
        return;
      }
      setRuns((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status: "cancelled" as QueueStatus } : r))
      );
      void refreshActive();
    } catch {
      setIssues([t("command.cancelFailed")]);
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
        const spec = COMMANDS_BY_NAME[item.name];
        if (!spec) throw new Error(`command tidak dikenal: ${item.name}`);
        // Lewat dispatch, bukan enqueue: pemeriksaan "ruangan ini sudah berisi"
        // harus berlaku juga untuk perintah yang ditumpuk, kalau tidak ia bisa
        // dilewati hanya dengan menekan "Tambah ke antrean" lebih dulu.
        await dispatch(spec, item.values);
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
   * Satu pembacaan `model_info`, yang menyambung baris yang sudah diantre.
   *
   * Sengaja bukan `runAndWait`. Bedanya cuma satu hal, dan hanya berarti untuk
   * perintah yang dijalankan halaman ini sendiri berulang kali: kalau
   * menunggunya menyerah, id barisnya DISIMPAN, dan panggilan berikutnya
   * melanjutkan menunggu baris itu alih-alih membuat baris kedua yang menanyakan
   * hal yang sama. Untuk perintah yang dikirim orangnya, menyerah menunggu
   * memang berarti selesai — jawabannya menyusul lewat polling gelembung — jadi
   * `runAndWait` tetap yang dipakai di sana.
   */
  const readModelInfo = useCallback(
    async (tries: number) => {
      const id = pendingModelRead.current ?? (await enqueue("model_info", {})).id;
      pendingModelRead.current = id;

      for (let i = 0; i < tries; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const res = await fetch(`/api/commands?id=${encodeURIComponent(id)}`);
        if (!res.ok) continue;

        const cmd = (await res.json()) as QueuedCommand;
        if (!TERMINAL.includes(cmd.status)) continue;

        pendingModelRead.current = null;
        if (cmd.status !== "completed") {
          throw new Error(cmd.error_message ?? t("command.roomsFailed"));
        }
        return cmd.result_json;
      }

      // Barisnya dibiarkan di antrean, dan id-nya dibiarkan di ref.
      throw new Error(t("command.roomsTimeout"));
    },
    [enqueue, t]
  );

  /**
   * File .rvt yang sedang dibuka Revit, beserta setup yang tersimpan di
   * dalamnya.
   *
   * Proyek di website adalah baris di database; yang dikerjakan add-in adalah
   * file yang kebetulan terbuka di Revit. Keduanya biasanya sama, dan yang
   * mahal adalah saat keduanya tidak sama — perintah berangkat ke model yang
   * salah dan tidak ada apa pun di layar yang menunjukkannya.
   */
  const loadModel = useCallback(
    async (opts?: { background?: boolean }) => {
      if (!project) return;
      if (modelBusy.current) return;

      const background = opts?.background === true;
      modelBusy.current = true;
      lastModelRead.current = Date.now();
      setModelLoading(true);
      if (!background) setModelReachable(true);

      try {
        // Pembacaan latar menunggu lebih pendek. Ia berulang sendiri semenit
        // lagi, jadi menunggu satu menit penuh untuk jawaban yang tidak datang
        // hanya menahan giliran pembacaan berikutnya.
        const info = (await readModelInfo(background ? 8 : 30)) as {
          title?: string;
          path?: string | null;
          print_setups?: string[];
          cad_setups?: string[];
          family_types?: Record<string, string[]>;
          rooms?: string[];
          addin_version?: string;
          upload_mode?: string;
        } | null;

        const title = info?.title ?? "—";
        const previous = modelTitle.current;
        modelTitle.current = title;

        setModel({
          title,
          path: info?.path ?? null,
          printSetups: info?.print_setups ?? [],
          cadSetups: info?.cad_setups ?? [],
          familyTypes: info?.family_types ?? {},
          rooms: info?.rooms ?? [],
          addinVersion: info?.addin_version ?? "",
          uploadMode: info?.upload_mode ?? "",
        });
        setModelStale(false);
        setModelReachable(true);

        // Dokumen yang berganti membuat SEMUA yang dibaca dari dokumen
        // sebelumnya salah sekaligus — daftar ruangan, daftar sheet, dan isi
        // ruangan yang sudah dihitung. Dibiarkan hidup, ketiganya jadi jawaban
        // percaya diri tentang file yang sudah tidak terbuka: "LOUNGE 5" tetap
        // ada di dropdown, perintahnya berangkat, dan add-in menolaknya dengan
        // nama ruangan yang tidak ada di dokumen yang sekarang.
        if (previous !== null && previous !== title) {
          setSwitchedFrom(previous);
          setSheets([]);
          setRoomContents({});
          setRooms([]);
        }

        // Nama ruangan datang bersama info model, jadi tombol "Ambil dari Revit"
        // di field ruangan tidak perlu ditekan lagi — daftarnya sudah ada
        // sebelum ada yang membuka formnya.
        if (info?.rooms?.length) setRooms(info.rooms);
      } catch {
        if (background) {
          // Yang gagal cuma satu pemeriksaan berkala. Menghapus nama file yang
          // sudah benar karena Revit sedang sibuk berarti menukar keterangan
          // dengan ketiadaan keterangan; yang benar adalah menahannya sambil
          // mengatakan bahwa ia belum dipastikan lagi.
          setModelStale(true);
        } else {
          // Dijalankan sendiri saat halaman dibuka, jadi kegagalannya tidak boleh
          // muncul sebagai galat merah di atas form yang belum disentuh siapa pun.
          // Revit yang tertutup adalah keadaan yang wajar, bukan kesalahan — yang
          // ditampilkan cukup bahwa modelnya belum terbaca.
          setModel(null);
          modelTitle.current = null;
          setModelReachable(false);
        }
      } finally {
        modelBusy.current = false;
        setModelLoading(false);
      }
    },
    [project, readModelInfo]
  );

  /**
   * Nama file Revit muncul sendiri, tanpa ada yang perlu menekan apa pun.
   *
   * Ini pertanyaan yang jawabannya selalu ingin diketahui dan tidak pernah
   * ingin ditanyakan: seluruh gunanya adalah melihat model mana yang akan
   * disentuh SEBELUM mengirim perintah, dan tombol yang harus ditekan lebih
   * dulu justru dilewati persis pada saat itu penting.
   *
   * Sekali saat proyeknya terpilih; sesudah itu diperbarui oleh efek di
   * bawahnya, karena file yang dibuka Revit bisa berganti kapan saja tanpa
   * website menyentuh apa pun.
   */
  useEffect(() => {
    if (!project) return;
    loadModel();
    // loadModel sengaja tidak jadi dependensi: identitasnya berubah tiap render
    // dan efek ini hanya boleh berjalan saat proyeknya yang berganti.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.projectId]);

  /**
   * Nama file itu diperiksa lagi, karena yang membuatnya salah terjadi di luar
   * website.
   *
   * Ini yang dilaporkan rusak: orang membuka file .rvt yang lain di Revit, dan
   * panelnya tetap menyebut nama file sebelumnya sampai halamannya dimuat ulang.
   * Tidak ada satu pun kejadian di sisi website yang menandai pergantian itu —
   * tidak ada klik, tidak ada perintah, tidak ada jawaban yang berubah bunyinya
   * — jadi satu-satunya cara mengetahuinya adalah bertanya lagi.
   *
   * Tiga pemicunya, dari yang paling murah:
   *
   * 1. **Panelnya kembali terlihat atau dapat fokus.** Berganti dokumen di Revit
   *    berarti bekerja di jendela sebelah dulu, jadi inilah saat yang hampir
   *    selalu tepat — dan yang menjadikannya murah adalah jarak minimumnya.
   * 2. **Berkala selama terlihat.** Panel yang didok di samping jendela Revit
   *    tidak pernah kehilangan fokus saat dokumennya diganti lewat tab di dalam
   *    Revit sendiri. Tanpa yang satu ini, kasus itu tidak tertangkap sama
   *    sekali.
   * 3. **Hasil perintah yang menyebut dokumen lain** — lihat efek berikutnya.
   *
   * Berhenti begitu tab-nya tidak terlihat, dan tidak pernah lebih rapat dari
   * `MODEL_MIN_GAP_MS` walau ketiganya menyala bersamaan.
   */
  useEffect(() => {
    if (!project) return;

    const refresh = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (Date.now() - lastModelRead.current < MODEL_MIN_GAP_MS) return;
      loadModel({ background: true });
    };

    const timer = setInterval(refresh, MODEL_POLL_MS);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.projectId]);

  /**
   * Jawaban yang datang dari dokumen lain memicu pembacaan ulang seketika.
   *
   * Ini pemicu yang paling tepat waktunya dan paling murah — nol baris antrean
   * tambahan — karena yang dibacanya sudah ada di tangan: hasil perintah yang
   * baru saja selesai. Add-in menyebutkan dokumen yang benar-benar dikerjakannya
   * di setiap hasil (lihat `docs/addin-dokumen-aktif-dan-batas-ruangan.md`), dan
   * begitu nama itu tidak sama dengan yang tampil, yang tampil sudah pasti
   * salah — bukan mungkin salah, dan bukan salah semenit lagi.
   *
   * Add-in versi lama tidak mengirimkan medan itu sama sekali. Maka efek ini
   * tidak melakukan apa-apa di sana, dan kedua pemicu di atas yang bekerja.
   */
  const documentChecked = useRef(new Set<string>());
  useEffect(() => {
    if (!project) return;

    for (const run of runs) {
      if (run.status !== "completed" || documentChecked.current.has(run.id)) continue;
      // Diperiksa SEKALI per perintah. Baris hasil tidak pernah dibuang dari
      // daftar `runs`, jadi tanpa penanda ini sebuah hasil lama yang menyebut
      // dokumen lama akan memicu pembacaan ulang pada setiap render — terus
      // menerus, karena nama di dalamnya memang tidak akan pernah cocok lagi.
      documentChecked.current.add(run.id);

      const result = run.result as { document?: unknown } | null | undefined;
      const named = typeof result?.document === "string" ? result.document.trim() : "";
      if (!named) continue;

      if (modelTitle.current !== null && named !== modelTitle.current) {
        loadModel({ background: true });
        return;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs, project?.projectId]);

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

  /**
   * Mengirim sebuah usulan dari percakapan, lalu mengoreksi gelembungnya dengan
   * apa yang benar-benar terjadi.
   *
   * Dipakai dua kali: oleh usulan yang langsung berangkat, dan oleh jawaban atas
   * pertanyaan "family mana". Keduanya harus melewati konfirmasi yang sama dan
   * persimpangan "ruangan ini sudah berisi" yang sama.
   */
  /**
   * Menjalankan satu usulan perintah, dan mengembalikan baris antreannya.
   *
   * Kembaliannya ada karena rantai baca: langkah berikutnya baru boleh disusun
   * setelah hasil langkah ini sampai, dan yang menghubungkan keduanya adalah id
   * antrean ini. `null` berarti tidak ada yang berangkat — ditahan, dibatalkan,
   * atau gagal ditulis — dan gelembungnya sudah mengatakan yang mana.
   */
  async function runProposal(
    bubble: number,
    spec: CommandSpec,
    vals: Record<string, unknown>
  ): Promise<{ id: string; commandText: string } | null> {
    // Satu pertanyaan untuk yang tidak bisa dibatalkan. Kecepatan tidak
    // sebanding dengan menghapus perangkat di model orang lain karena satu
    // kalimat yang salah tafsir.
    if (spec.confirm && !window.confirm(t("command.confirm"))) {
      patchChat(bubble, { state: "held" });
      return null;
    }

    try {
      const queued = await dispatch(spec, vals);
      // null = orangnya membatalkan di persimpangan "ruangan ini sudah berisi".
      if (!queued) {
        patchChat(bubble, { state: "held" });
        return null;
      }
      // Teks perintahnya diperbarui: yang berangkat bisa berbeda dari yang
      // diusulkan — modifikasi alih-alih penambahan, dan grid yang dihitung
      // dari jumlahnya. Gelembung ini harus menyebut yang benar-benar dikirim.
      //
      // Id antreannya dicatat di sini: itu satu-satunya tali antara gelembung ini
      // dan jawaban yang datang dari Revit beberapa detik kemudian, dan tanpanya
      // jawabannya cuma bisa ditempel sebagai gelembung baru yang tidak tahu
      // pertanyaan mana yang ia jawab.
      runBubble.current.set(queued.id, bubble);
      patchChat(bubble, { state: "queued", commandText: queued.commandText, runId: queued.id });
      return queued;
    } catch (err) {
      const withIssues = err as Error & { issues?: string[] };
      patchChat(bubble, {
        state: "failed",
        error: withIssues.issues?.join(" ") ?? withIssues.message ?? t("command.sendFailed"),
      });
      return null;
    }
  }

  /**
   * Mengirim satu perintah per ruangan, berurutan.
   *
   * Berurutan, bukan serentak: tiap ruangan yang sudah berisi memunculkan
   * pertanyaannya sendiri, dan lima pertanyaan yang datang bersamaan tidak bisa
   * dijawab satu-satu. Yang gagal disebut namanya lalu dilewati — empat ruangan
   * yang benar tidak boleh batal karena satu ruangan yang namanya salah eja.
   */
  async function runBatch(
    spec: CommandSpec,
    items: { room: string; values: Record<string, unknown> }[],
    note: string
  ) {
    batchAnswer.current = null;
    batchStopped.current = false;

    const bubble = addChat({
      role: "batch",
      text: note,
      command: spec.name,
      rooms: items.map((i) => i.room),
      sent: 0,
      skipped: 0,
      failures: [],
      done: false,
    });

    if (spec.confirm && !window.confirm(t("command.confirm"))) {
      patchChat(bubble, { done: true });
      return;
    }

    let sent = 0;
    let skipped = 0;
    const failures: string[] = [];

    for (const item of items) {
      if (batchStopped.current) break;

      try {
        const queued = await dispatch(spec, item.values, true);
        if (queued) sent++;
        else skipped++;
      } catch (err) {
        const withIssues = err as Error & { issues?: string[] };
        failures.push(`${item.room}: ${withIssues.issues?.join(" ") ?? withIssues.message}`);
      }

      patchChat(bubble, { sent, skipped, failures: [...failures] });
    }

    patchChat(bubble, { sent, skipped, failures, done: true });
    batchAnswer.current = null;
  }

  /**
   * Jawaban atas "family mana yang dipakai".
   *
   * `null` berarti biarkan add-in yang memilih — pilihan yang sah, dan sekarang
   * dinyatakan alih-alih terjadi karena tidak ada yang menjawab.
   */
  async function chooseFamily(entry: ChatEntry & { role: "choice" }, familyName: string | null) {
    patchChat(entry.id, { answered: familyName ?? "" });

    const spec = COMMANDS_BY_NAME[entry.command];
    if (!spec) return;

    const vals = { ...entry.values };
    if (familyName) vals[entry.field] = familyName;
    else delete vals[entry.field];

    const bubble = addChat({
      role: "proposal",
      text: "",
      commandText: `/${spec.name}`,
      command: spec.name,
      values: vals,
      state: "sending",
    });

    setChatBusy(true);
    try {
      await runProposal(bubble, spec, vals);
    } finally {
      setChatBusy(false);
    }
  }

  /** Satu giliran percakapan: kalimat masuk, usulan perintah keluar. */
  /**
   * Satu pertanyaan, sebanyak pembacaan yang diperlukan untuk menjawabnya.
   *
   * Dulu satu pertanyaan = satu pemanggilan model = paling banyak satu perintah,
   * dan hasil perintah itu TIDAK pernah kembali ke model. Akibatnya urutan yang
   * diwajibkan prompt sendiri — `what=categories` untuk tahu kategori apa yang
   * ada, lalu `what=parameters` untuk tahu nama parameternya persis, baru
   * `what=elements` — harus dikerjakan orangnya: tiga kali mengetik, tiga kali
   * menunggu Revit, untuk satu pertanyaan yang ia ajukan sekali. Dan di antara
   * ketiganya ia sendiri yang harus menyalin nama parameter dari layar ke
   * kalimat berikutnya.
   *
   * Sekarang yang menjalankan urutan itu sistem. Perintah BACA dijalankan,
   * ditunggu, dan hasilnya dikembalikan kepada model sebagai catatan sistem
   * beserta isinya (lihat digestResult) — sampai ia bisa menjawab, atau sampai
   * batas empat pembacaan.
   *
   * YANG TIDAK BERUBAH, dan ini pagarnya: perintah yang MENGUBAH model tidak
   * pernah masuk rantai ini. Ia diusulkan sekali, berhenti di situ, dan
   * hasilnya tidak dikembalikan kepada model untuk dilanjutkan. Yang memutuskan
   * perintah mana yang boleh berjalan sendiri adalah server, dari katalog
   * (`canAutoRun`) — bukan halaman ini menyimpulkannya dari nama perintah.
   */
  async function sendChat(message: string) {
    if (!project) return;

    /**
     * ID elemen yang diketik langsung ditunjukkan, tanpa lewat model bahasa.
     *
     * Sebelumnya ini kotak isian tersendiri di atas percakapan, dan itu salah:
     * halaman ini jadi punya dua kolom yang menerima ketikan, bersebelahan, dan
     * yang mana yang dipakai harus diputuskan orangnya sebelum ia mengetik.
     * Bentuk ketikannya sendiri sudah menjawab itu — sebuah angka telanjang
     * bukan pertanyaan yang punya jawaban.
     *
     * Ditaruh SEBELUM gelembung user ditambahkan, supaya showElement yang
     * menyusun seluruh percakapannya sendiri: satu gelembung perintah yang
     * mengikuti hasilnya, bukan pertanyaan yang menggantung tanpa jawaban.
     *
     * Yang dikenali sengaja sempit (lihat elementIdsIn). Sebuah pertanyaan yang
     * salah dikenali sebagai ID tidak pernah sampai ke model, dan yang terlihat
     * orangnya adalah pertanyaan yang dijawab dengan memindahkan layar Revit.
     */
    const ids = elementIdsIn(message);
    if (ids && canRun(COMMANDS_BY_NAME.show_element, project.role)) {
      addChat({ role: "user", text: message });
      await showElement(ids);
      return;
    }

    addChat({ role: "user", text: message });
    setChatBusy(true);
    setChatStep(0);
    chatStopped.current = false;

    /**
     * Riwayat percakapan, ditumbuhkan LOKAL — tidak dibaca ulang dari state.
     *
     * Ini bukan gaya, ini syarat supaya rantainya berjalan. `chatEntries` yang
     * terbaca di dalam fungsi ini adalah nilainya pada render saat ia dipanggil,
     * dan ia tidak akan pernah memuat gelembung yang ditambahkan beberapa await
     * kemudian. Membacanya ulang di langkah kedua berarti mengirim riwayat yang
     * TIDAK memuat hasil langkah pertama — dan model yang tidak melihat hasil
     * pembacaannya akan meminta pembacaan yang sama lagi. Setiap langkah, sampai
     * batasnya habis, tanpa satu pun galat muncul di mana pun.
     */
    const bubbles: ChatBubble[] = [...chatEntries, { role: "user", text: message }];

    try {
      // `reads` = pembacaan yang SUDAH dijalankan dalam pertanyaan ini, dan
      // sekaligus nomor langkah yang dikirim ke server.
      let reads = 0;

      for (;;) {
        if (chatStopped.current) {
          addChat({ role: "assistant", text: t("chat.stopped") });
          return;
        }

        const res = await fetch("/api/ai/electrical", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            // Giliran lanjutan tidak membawa pesan: kalimatnya disusun server
            // (lihat CONTINUATION di route-nya) supaya ia sama di setiap
            // langkah dan tidak bisa bergeser dari satu pemanggil ke pemanggil
            // berikutnya.
            ...(reads === 0 ? { message } : { continuation: true, step: reads }),
            projectId: project.projectId,
            /**
             * Riwayat yang dikirim TIDAK memuat pertanyaan yang sedang berjalan
             * pada langkah pertama.
             *
             * Pada langkah itu pertanyaannya dikirim sebagai `message`, dan
             * server yang menempelkannya di ujung riwayat. Mengirim keduanya
             * berarti pesan user yang sama berdiri dua kali berurutan — dan
             * `buildMessages` menggabungkan giliran yang perannya sama, jadi yang
             * dibaca model adalah satu pesan yang mengulang pertanyaan yang sama
             * dua kali.
             *
             * Bentuk itu sudah pernah mahal di repo ini (lihat chatHistory.ts):
             * bacaan wajar model atas permintaan yang terulang adalah "dia
             * menanyakannya lagi, berarti sudah saya kerjakan" — lalu ia menjawab
             * bahwa perintahnya sudah dijalankan, tanpa memanggil tool apa pun.
             *
             * Pada langkah lanjutan pertanyaannya justru HARUS ada di riwayat:
             * `message` sudah dipakai CONTINUATION, dan tanpa pertanyaannya model
             * tidak tahu hasil pembacaan ini sedang menjawab apa.
             */
            history: turnsFromChat(reads === 0 ? bubbles.slice(0, -1) : bubbles),
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
          addChat({ role: "assistant", text: body.text, nothingSent: Boolean(body.nothingSent) });
          return;
        }

        // Family yang ditebak model tidak cocok dengan satu pun family di model.
        // Perintahnya ditahan dan daftarnya ditawarkan sebagai tombol — dijawab
        // satu ketukan, tanpa membuka formulir dan mengisi ulang.
        if (body.kind === "choose") {
          addChat({
            role: "choice",
            text: body.note ?? "",
            command: body.command,
            values: body.values ?? {},
            field: body.field,
            category: body.category,
            guessed: body.guessed ?? "",
            choices: body.choices ?? [],
          });
          return;
        }

        const spec = COMMANDS_BY_NAME[body.command];

        // Satu permintaan, satu perintah per ruangan.
        if (body.kind === "batch" && spec) {
          await runBatch(spec, body.items ?? [], body.note ?? "");
          return;
        }

        const incomplete = Boolean(body.issues?.length);

        const bubble = addChat({
          role: "proposal",
          text: body.note ?? "",
          commandText: body.commandText ?? `/${body.command}`,
          command: body.command,
          values: body.values ?? {},
          issues: body.issues,
          // Belum "terkirim". Baris antreannya baru ada beberapa ratus milidetik
          // dari sekarang, dan penulisannya masih bisa gagal.
          state: incomplete ? undefined : "sending",
        });

        // Perintah di luar katalog: model menyebut nama yang tidak ada, jadi tidak
        // ada apa pun yang bisa dikirim. Dulu gelembungnya tetap berbunyi "sudah
        // dikirim ke Revit" — kalimat yang tidak pernah benar.
        if (!spec) {
          patchChat(bubble, {
            state: "failed",
            error: `perintah "${body.command}" tidak ada di katalog`,
          });
          return;
        }

        // Yang kurang lengkap tidak dikirim: daftar `issues` di gelembungnya
        // menyebutkan apa yang belum disebut, dan menebak sisanya berarti
        // menempatkan perangkat dengan angka yang tidak pernah diminta siapa pun.
        if (incomplete) return;

        // Perintah yang mengubah model. Dijalankan seperti sebelumnya, dan
        // rantainya berhenti di sini — hasilnya tidak dikembalikan ke model,
        // karena "sudah terpasang, sekarang lanjutkan sendiri" bukan sesuatu
        // yang boleh diputuskan tanpa seorang manusia melihatnya lebih dulu.
        if (!body.autoRun) {
          await runProposal(bubble, spec, body.values ?? {});
          return;
        }

        // --- satu langkah baca: dijalankan, ditunggu, hasilnya dibawa balik ---

        // Berhenti yang ditekan selama model menyusun jawabannya. Tanpa
        // pemeriksaan di sini, pembacaan yang sudah disiapkan tetap berangkat ke
        // antrean Revit sesudah orangnya menekan Berhenti — dan yang ia lihat
        // adalah tombol yang tidak bekerja.
        if (chatStopped.current) {
          patchChat(bubble, { state: "held" });
          addChat({ role: "assistant", text: t("chat.stopped") });
          return;
        }

        reads++;
        setChatStep(reads);

        const queued = await runProposal(bubble, spec, body.values ?? {});
        // Tidak ada yang berangkat. Gelembungnya sudah mengatakan sebabnya, dan
        // rantai yang melanjutkan tanpa hasil hanya akan menebak.
        if (!queued) return;

        const done = await waitForRun(queued.id);

        if (chatStopped.current) {
          addChat({ role: "assistant", text: t("chat.stopped") });
          return;
        }

        // Revit tidak menjawab dalam waktu yang wajar. Perintahnya tetap di
        // antrean dan gelembungnya akan berubah sendiri kalau jawabannya datang
        // nanti; yang berhenti hanya rantainya.
        if (!done) {
          addChat({ role: "assistant", text: t("chat.readTimeout") });
          return;
        }

        // Gagal atau dibatalkan: gelembungnya sudah menampilkan sebabnya lewat
        // polling. Rantai TIDAK melanjutkan dan TIDAK mengirim ulang dengan
        // argumen yang ditebak — perintah baca yang gagal berulang kali secara
        // otomatis adalah cara membakar antrean Revit tanpa ada yang meminta.
        if (done.status !== "completed") return;

        // Hasilnya masuk riwayat langkah berikutnya: ringkasannya untuk dibaca,
        // ISINYA untuk dipakai. Tanpa isinya, langkah berikutnya cuma tahu "12
        // parameter" dan harus menebak namanya — dan nama yang salah
        // mengembalikan nol baris tanpa satu pun galat.
        bubbles.push({
          role: "proposal",
          text: body.note ?? "",
          command: spec.name,
          commandText: queued.commandText,
          runStatus: "completed",
          summary: summarizeResult(done.result_json, t),
          // Kalau Revit menjawab dengan hasil yang kosong atau bentuknya tidak
          // dikenali, keduanya bisa jadi string kosong sekaligus — dan catatan
          // tanpa keduanya jatuh ke cabang "hasilnya belum tentu ada di giliran
          // ini". Model yang membaca itu menyimpulkan pembacaannya belum
          // terjadi, lalu mengirim perintah yang sama lagi. Satu kalimat di sini
          // menutup jalan itu.
          resultDigest:
            digestResult(done.result_json) || "(Revit menjawab, tapi hasilnya kosong)",
        });

        if (reads >= MAX_AUTO_STEPS) {
          addChat({
            role: "assistant",
            text: t("chat.stepLimit").replace("{n}", String(reads)),
          });
          return;
        }
      }
    } catch (err) {
      addChat({ role: "assistant", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setChatBusy(false);
      setChatStep(0);
      chatStopped.current = false;
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
      const body = (await res.json()) as {
        commands: ActiveCommand[];
        addin?: { busy?: boolean; lastSeen?: string | null };
      };
      setActive(body.commands ?? []);
      setAddin({
        busy: Boolean(body.addin?.busy),
        lastSeen: body.addin?.lastSeen ?? null,
      });
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

  /**
   * Jawaban Revit dibawa ke gelembung yang menanyakannya.
   *
   * Sebelumnya ia jadi gelembung asisten tersendiri berisi baris perintah plus
   * "selesai dijalankan di Revit." Untuk satu pertanyaan sesederhana "ada berapa
   * cable tray?" yang terbaca adalah tiga hal berturut-turut: perintahnya,
   * laporan bahwa perintah itu selesai, dan angkanya — di panel Hasil, di bawah
   * halaman, di luar layar telepon. Tidak satu pun dari ketiganya adalah jawaban.
   *
   * Sekarang gelembungnya sendiri yang berubah jadi jawaban, dan ringkasannya
   * ikut masuk riwayat: pertanyaan lanjutan dijawab dari angka yang sudah ada,
   * bukan dengan menjalankan perintahnya lagi.
   *
   * Perintah yang dikirim dari formulir tidak punya gelembung. Untuk itu jalan
   * lama tetap dipakai — kalimat pendek, karena angkanya sudah tampil utuh di
   * panel Hasil tepat di sebelah tombol yang baru ditekan orangnya.
   */
  const reported = useRef(new Set<string>());
  useEffect(() => {
    if (!chat) return;
    for (const run of runs) {
      if (!TERMINAL.includes(run.status) || reported.current.has(run.id)) continue;
      reported.current.add(run.id);

      const bubble = runBubble.current.get(run.id);
      if (bubble !== undefined) {
        runBubble.current.delete(run.id);
        patchChat(bubble, {
          runStatus: run.status as "completed" | "failed" | "cancelled",
          result: run.result,
          summary: run.status === "completed" ? summarizeResult(run.result, t) : undefined,
          runError: run.error ?? undefined,
        });
        continue;
      }

      const outcome =
        run.status === "completed"
          ? t("chat.done")
          : `${t("chat.failedRun")}${run.error ? ` — ${run.error}` : ""}`;
      addChat({ role: "assistant", text: `\`${run.commandText}\` — ${outcome}` });
    }
  }, [runs, chat, t]);

  /**
   * Kategori yang sedang jadi pokok formulir ini, untuk menampilkan isi ruangan.
   *
   * Untuk /modify_devices dan /delete_devices ia dipilih di kolom "Kategori";
   * untuk perintah `place_*` ia melekat pada perintahnya sendiri.
   */
  const focusCategory = useMemo(() => {
    if (!selected) return "";
    if (selected.name === "modify_devices" || selected.name === "delete_devices") {
      const what = String(values.what ?? "");
      return what === "all" ? "" : what;
    }
    return modifyCategoryFor(selected.name) ?? "";
  }, [selected, values.what]);

  const roomValue = String(values[selected?.positional?.name ?? "room"] ?? "").trim();

  /** Isi ruangan yang sudah pernah dibaca — kalau ada. */
  const knownContents =
    roomValue && focusCategory ? (roomContents[contentsKey(roomValue, focusCategory)] ?? null) : null;

  if (projectsLoading) return <p className="opacity-60">{t("common.loading")}</p>;

  if (!projects.length) {
    return (
      <div className="glass-panel max-w-2xl space-y-2 p-4 sm:p-6">
        <h1 className="text-lg font-medium">{title}</h1>
        <p className="opacity-70 text-sm">{t("command.noProject")}</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-3 sm:space-y-4">
      <div className="glass-panel space-y-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-base font-medium sm:text-lg">{title}</h1>
          <label className="flex min-w-0 items-center gap-2 text-sm">
            <span className="shrink-0 opacity-70">{t("command.project")}</span>
            <select
              className="glass-input min-w-0 max-w-[60vw] truncate py-1.5 text-sm"
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
              {/* Nama yang tampil adalah nama yang TERAKHIR dijawab, dan sekali
                  pemeriksaannya tidak dijawab ia berhenti berarti "yang sedang
                  terbuka". Bedanya disebutkan, bukan disembunyikan. */}
              {modelStale && !modelLoading && (
                <span className="text-amber-600 dark:text-amber-400">
                  · {t("command.modelUnconfirmed")}
                </span>
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
          {(!model || modelStale) && !modelLoading && (
            <button
              type="button"
              onClick={() => loadModel()}
              className="text-accent underline"
            >
              {t("command.modelRetry")}
            </button>
          )}
        </div>

        {/* Pergantian dokumen dikatakan, karena yang ikut hilang bersamanya
            tidak terlihat: daftar ruangan, daftar sheet, dan isi ruangan yang
            sudah dibaca semuanya dikosongkan di saat yang sama. Tanpa kalimat
            ini yang terlihat cuma dropdown ruangan yang tiba-tiba kosong. */}
        {switchedFrom && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-400/50 bg-amber-400/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            <span>{t("command.modelSwitched").replace("{from}", switchedFrom)}</span>
            <button
              type="button"
              onClick={() => setSwitchedFrom(null)}
              className="underline"
            >
              {t("command.modelSwitchedOk")}
            </button>
          </div>
        )}

        {/* Tombol per command — inilah yang menembak ke add-in Revit.
            Satu baris yang bisa digeser di telepon: dibungkus jadi lima baris,
            deretan ini mendorong formulirnya sejauh satu layar penuh ke bawah. */}
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible">
          {available.map((c) => (
            <button
              key={c.name}
              // Tombol yang sama menutup kembali formulirnya. Sebuah formulir
              // yang hanya bisa dibuka adalah formulir yang menetap di layar
              // sampai perintah lain dipilih — dan di telepon itu berarti
              // menggulir melewatinya untuk sampai ke apa pun di bawahnya.
              aria-pressed={selected?.name === c.name}
              onClick={() => (selected?.name === c.name ? closeForm() : pick(c))}
              className={`glass-input shrink-0 whitespace-nowrap py-1.5 text-sm transition ${
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
          step={chatStep}
          maxSteps={MAX_AUTO_STEPS}
          onStop={() => {
            chatStopped.current = true;
          }}
          disabled={!project}
          onSend={sendChat}
          onChoose={chooseFamily}
          onOpenForm={(command, values) => {
            const spec = COMMANDS_BY_NAME[command];
            if (spec) pick(spec, values);
          }}
        />
      )}

      {selected && (
        <div ref={formBox} className="glass-panel space-y-4 p-4 sm:p-6">
          <div>
            <h2 className="font-medium">{selected.label[locale]}</h2>
            <p className="text-sm opacity-70 mt-1">{selected.description[locale]}</p>
            <code className="mt-2 block text-xs opacity-50">{selected.example}</code>
          </div>

          {/* Isi ruangan sekarang, sebelum apa pun dikirim.
              Ini yang membedakan "pasang 10 lampu" dari "jadikan 10 lampu", dan
              sebelumnya tidak ada di mana pun di layar: perintah pemasangan di
              ruangan yang sudah berisi menambahkan satu set lagi di atas set yang
              ada, dan itu baru terlihat di gambar. */}
          {focusCategory && roomValue && (
            <RoomContentsNote
              room={roomValue}
              category={focusCategory}
              contents={knownContents}
              loading={checkingRoom}
              placing={Boolean(modifyCategoryFor(selected.name))}
              reachable={Boolean(model)}
              onRead={() => void readRoom(roomValue, focusCategory, true)}
              onSwitchToModify={() =>
                pick(COMMANDS_BY_NAME.modify_devices, {
                  ...modifyValuesFrom(selected, focusCategory, values),
                })
              }
            />
          )}

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
                familyOptions={familyOptionsFor(selected.positional, values, model)}
                familyCategory={familyCategoryOf(selected.positional, values)}
                onChange={(v) =>
                  setValues((s) => ({ ...s, [selected.positional!.name]: v }))
                }
              />
            )}
            {selected.fields.filter((f) => fieldApplies(f, values)).map((f) => (
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
                familyOptions={familyOptionsFor(f, values, model)}
                familyCategory={familyCategoryOf(f, values)}
                extra={
                  f.name === "grid" ? (
                    <GridNote
                      count={values.count}
                      grid={values.grid}
                      onUse={(text) => setValues((s) => ({ ...s, grid: text }))}
                    />
                  ) : undefined
                }
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
            <button
              onClick={send}
              disabled={sending || Boolean(crossroads)}
              className="btn-accent"
            >
              {sending
                ? checkingRoom
                  ? t("command.checkingRoom")
                  : t("command.sending")
                : t("command.send")}
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

      {/* Persimpangan "ruangan ini sudah berisi", di panelnya sendiri.
          Di luar kotak formulir, bukan di dalamnya: formulir itu bisa hilang di
          tengah-tengah — proyeknya diganti, dan perintah yang terpilih tidak
          tersedia di proyek yang baru. Kalau panel ini ikut hilang, janji yang
          ditunggu `dispatch` tidak pernah dijawab: tombol kirim tinggal
          "Mengirim…" selamanya, dan tidak ada tombol tersisa yang bisa
          membebaskannya. */}
      {crossroads && (
        <div className="glass-panel p-4 sm:p-6">
          <Crossroad info={crossroads} onAnswer={answerCrossroads} />
        </div>
      )}

      {/* Antrean proyek: siapa sedang menjalankan apa.
          Di bawah formulir, di atas hasil — tempat orang melihatnya saat
          memutuskan apakah aman mengirim sesuatu sekarang. */}
      {active.length > 0 && (
        <div className="glass-panel space-y-2 p-4 sm:p-6">
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
        <div className="glass-panel space-y-3 p-4 sm:p-6">
          <h2 className="font-medium">{t("command.results")}</h2>
          {/* Digulir di dalam kotaknya. Satu sesi kerja menumpuk puluhan
              perintah, dan daftar yang tumbuh tanpa batas mendorong segalanya
              ke bawah sampai form perintahnya sendiri hilang dari layar. */}
          <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
            {runs.map((r) => (
              <RunRow
                key={r.id}
                run={r}
                onUndo={undoRun}
                addin={addin}
                onCancel={cancelRun}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Family Revit yang boleh dipilih untuk sebuah kolom, dari model yang terbuka. */
function familyOptionsFor(
  field: CommandField,
  values: Record<string, unknown>,
  model: ModelInfo | null
): RevitFamily[] {
  return familiesFor(model?.familyTypes, familyCategoryOf(field, values));
}

/**
 * Apa yang sudah ada di ruangan itu — dan apa artinya untuk perintah ini.
 *
 * Perintah pemasangan di ruangan yang sudah berisi tidak menggantikan apa pun;
 * ia menambahkan satu set lagi di atas yang ada. Dua grid dengan jarak berbeda
 * di satu plafon, sirkuit ganda, schedule yang menghitung dua kali — dan
 * satu-satunya tempat itu terlihat adalah gambarnya, setelah semuanya terpasang.
 */
function RoomContentsNote({
  room,
  category,
  contents,
  loading,
  placing,
  reachable,
  onRead,
  onSwitchToModify,
}: {
  room: string;
  category: string;
  contents: RoomContents | null;
  loading: boolean;
  /** Perintah yang terpilih adalah pemasangan, jadi isi yang ada akan ditumpuki. */
  placing: boolean;
  /** Model bisa ditanya. Kalau tidak, tidak ada gunanya menawarkan tombol baca. */
  reachable: boolean;
  onRead: () => void;
  onSwitchToModify: () => void;
}) {
  const { t } = useI18n();
  const occupied = Boolean(contents && contents.count > 0);

  return (
    <div
      className={`space-y-1 rounded-xl border p-3 text-xs ${
        placing && occupied
          ? "border-amber-400/50 bg-amber-400/10"
          : "border-black/5 dark:border-white/10"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="opacity-60">{t("command.roomHas")}</span>
        <code className="break-all">{room}</code>
        <span className="opacity-60">·</span>
        <code>{category}</code>
        <span className="font-medium">
          {loading
            ? t("command.checkingRoom")
            : contents
              ? t("command.roomHasCount").replace("{n}", String(contents.count))
              : t("command.roomUnknown")}
        </span>
        {reachable && !loading && (
          <button type="button" onClick={onRead} className="text-accent underline">
            {contents ? t("command.roomReread") : t("command.roomRead")}
          </button>
        )}
      </div>

      {placing && occupied && (
        <>
          <p className="text-amber-700 dark:text-amber-300">{t("command.roomOccupied")}</p>
          <button
            type="button"
            onClick={onSwitchToModify}
            className="text-accent underline"
          >
            {t("command.roomSwitchToModify")}
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Persimpangan tepat sebelum perintahnya berangkat: ruangannya sudah berisi.
 *
 * Bukan `window.confirm`. Pilihannya ada tiga — tata ulang, tambah di atasnya,
 * batal — dan sebuah dialog "OK/Batal" hanya bisa menyodorkan dua, sehingga yang
 * ketiga harus diterka dari mana. Ini juga tempat menyebutkan jumlah yang
 * ditemukan, dan jumlah itulah yang biasanya menjawab pertanyaannya.
 */
function Crossroad({
  info,
  onAnswer,
}: {
  info: Crossroads;
  onAnswer: (choice: CrossroadChoice, applyToRest?: boolean) => void;
}) {
  const { t } = useI18n();

  // Berlaku untuk ruangan berikutnya juga. Lima ruangan yang tiga di antaranya
  // sudah berisi berarti tiga pertanyaan identik berturut-turut — dan tiga
  // pertanyaan identik adalah tiga kali menekan tombol tanpa membacanya.
  const [applyToRest, setApplyToRest] = useState(false);

  return (
    <div className="space-y-2 rounded-xl border border-amber-400/50 bg-amber-400/10 p-3 text-sm">
      <p>
        {t("command.crossroadTitle")
          .replace("{room}", info.room)
          .replace("{n}", String(info.found.count))
          .replace("{what}", info.category)}
      </p>
      {info.modifyBlocked && (
        <p className="text-xs opacity-70">
          {info.modifyBlocked === "dryRun"
            ? t("command.crossroadDryRun")
            : t("command.crossroadNeedCount")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {!info.modifyBlocked && (
          <button
            type="button"
            onClick={() => onAnswer("modify", applyToRest)}
            className="btn-accent text-sm"
          >
            {t("command.crossroadModify")}
          </button>
        )}
        <button
          type="button"
          onClick={() => onAnswer("add", applyToRest)}
          className="glass-input px-3 py-1.5 text-sm"
        >
          {t("command.crossroadAdd")}
        </button>
        {info.batch && (
          <button
            type="button"
            onClick={() => onAnswer("skip", applyToRest)}
            className="glass-input px-3 py-1.5 text-sm"
          >
            {t("command.crossroadSkip")}
          </button>
        )}
        <button
          type="button"
          onClick={() => onAnswer("cancel")}
          className="glass-input px-3 py-1.5 text-sm"
        >
          {info.batch ? t("command.crossroadStop") : t("command.crossroadCancel")}
        </button>
      </div>

      {info.batch && (
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={applyToRest}
            onChange={(e) => setApplyToRest(e.target.checked)}
          />
          {t("command.crossroadApplyRest")}
        </label>
      )}
    </div>
  );
}

/**
 * Grid yang akan dipakai, terlihat sebelum perintahnya dikirim.
 *
 * Angka inilah yang membuat sepuluh lampu jadi 5x2 dan bukan 4x3 dengan dua
 * lubang. Ia dihitung di server supaya jalur percakapan ikut mendapatkannya,
 * tapi ia harus TERLIHAT di sini: orang yang tahu ruangannya lebih dalam daripada
 * lebar perlu bisa membalikkannya, dan pembalikan itu satu ketukan.
 */
function GridNote({
  count,
  grid,
  onUse,
}: {
  count: unknown;
  grid: unknown;
  onUse: (text: string) => void;
}) {
  const { t } = useI18n();

  const n = Number(count);
  if (!Number.isInteger(n) || n < 1) return null;

  const typed = parseGrid(grid);
  if (typed) {
    // Grid yang tidak memuat jumlahnya ditolak server; disebutkan di sini supaya
    // ketahuan sebelum tombol kirim, bukan sesudahnya.
    if (gridCount(typed) === n) return null;
    const right = autoGrid(n);
    return (
      <span className="block text-xs text-red-500">
        {t("command.gridMismatch")
          .replace("{grid}", formatGrid(typed))
          .replace("{slots}", String(gridCount(typed)))
          .replace("{n}", String(n))}
        {right && (
          <button
            type="button"
            onClick={() => onUse(formatGrid(right))}
            className="ml-1 text-accent underline"
          >
            {t("command.gridUse").replace("{grid}", formatGrid(right))}
          </button>
        )}
      </span>
    );
  }

  const derived = autoGrid(n);
  if (!derived) return null;
  const other = flip(derived);

  return (
    <span className="block space-x-1 text-xs opacity-70">
      <span>
        {t("command.gridAuto")
          .replace("{n}", String(n))
          .replace("{grid}", formatGrid(derived))}
      </span>
      {other.cols !== derived.cols && (
        <button
          type="button"
          onClick={() => onUse(formatGrid(other))}
          className="text-accent underline"
        >
          {t("command.gridUse").replace("{grid}", formatGrid(other))}
        </button>
      )}
      {awkwardCount(n) && (
        <span className="text-amber-600 dark:text-amber-400">
          {t("command.gridAwkward")
            .replace("{n}", String(n))
            .replace("{alts}", friendlierCounts(n).join(" / "))}
        </span>
      )}
    </span>
  );
}

function RunRow({
  run,
  onUndo,
  addin,
  onCancel,
}: {
  run: RunEntry;
  /** Absen kalau perintah ini tidak bisa dibatalkan. */
  onUndo?: (room: string, marks: string[]) => void;
  addin: { busy: boolean; lastSeen: string | null };
  onCancel: (id: string) => void;
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
        //
        // Tapi "menunggu diambil add-in" sendirian adalah satu kalimat untuk dua
        // keadaan yang sangat berbeda: antrean yang bergerak, dan add-in yang
        // tidak mengambil apa pun karena Revit tertutup atau add-in-nya menunggu
        // di proyek yang lain. Yang kedua bisa ditunggu selamanya, dan itu persis
        // yang dialami orang yang melihat "menunggu" lalu tidak menemukan apa pun
        // di Revit. Jadi keadaan add-in disebutkan, dan disediakan jalan keluar.
        <div className="space-y-1">
          <p className="text-xs opacity-60">{t("command.waitingAddin")}</p>
          {run.status === "pending" && (
            <p className="text-xs opacity-60">
              {addin.busy
                ? t("command.addinBusy")
                : addin.lastSeen
                  ? t("command.addinLastSeen").replace("{when}", sinceText(addin.lastSeen, t))
                  : t("command.addinNever")}
            </p>
          )}
          {run.status === "pending" && (
            <button
              type="button"
              onClick={() => onCancel(run.id)}
              className="text-xs text-red-500 underline"
            >
              {t("command.cancel")}
            </button>
          )}
        </div>
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

/** "3 menit lalu" — cukup untuk memutuskan apakah add-in-nya hidup. */
function sinceText(iso: string, t: (key: string) => string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return t("command.sinceJustNow");

  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return t("command.sinceJustNow");
  if (minutes < 60) return t("command.sinceMinutes").replace("{n}", String(minutes));

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("command.sinceHours").replace("{n}", String(hours));
  return t("command.sinceDays").replace("{n}", String(Math.floor(hours / 24)));
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
  familyOptions,
  familyCategory,
  extra,
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
  /**
   * Nama family Revit yang boleh dipilih di kolom ini.
   *
   * Datang dari luar, bukan diterka di sini. Terkaannya dulu "buang akhiran
   * `_type` dari nama kolom", yang mencari kunci `fixture` di jawaban model_info
   * — kunci yang tidak pernah ada di sana. Jadi daftarnya selalu kosong, kolom
   * "Tipe armatur" selalu berupa kotak teks, dan satu-satunya cara mengisinya
   * adalah mengetik nama family dari ingatan.
   */
  familyOptions: RevitFamily[];
  /**
   * Kategori yang daftar itu berasal dari — kosong kalau belum ada satu pun.
   *
   * Dibutuhkan untuk membedakan dua sebab daftar kosong yang berbunyi sama dan
   * bukan hal yang sama: model yang memang tidak punya family kategori itu, dan
   * kategori yang belum dipilih sama sekali. Kolom "Kategori" pada /query berisi
   * `all` secara bawaan, dan `all` bukan sebuah kategori — jadi pesannya dulu
   * berbunyi "model ini tidak punya family untuk kategori itu" pada model yang
   * penuh family.
   */
  familyCategory?: string;
  /** Keterangan tambahan di bawah kolom, mis. grid yang dihitung dari jumlah. */
  extra?: React.ReactNode;
  onChange: (v: unknown) => void;
}) {
  const { t } = useI18n();
  const isRoom = field.name === "room";
  const isSheets = field.name === "sheets";

  const typeOptions = familyOptions;

  // Sudah memilih untuk mengetik sendiri, karena family yang dibutuhkan belum
  // ada di daftar yang terakhir dibaca dari model.
  const [typedByHand, setTypedByHand] = useState(false);

  /** Kolom ini memang kolom nama family, entah daftarnya sudah terbaca atau belum. */
  const isFamilyField = Boolean(field.familyCategory || field.familyCategoryFrom);

  /** Diketik sendiri, dan tidak ada satu pun family di model yang bernama begitu. */
  const unknownFamily =
    isFamilyField &&
    typeof value === "string" &&
    value.trim() !== "" &&
    typeOptions.length > 0 &&
    matchFamily(typeOptions, value).kind !== "exact";

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
        {/* Kolom nama family tanpa daftar, PADA kategori yang sudah dipilih:
            sebabnya model yang belum menjawab. Tombolnya di sini, bukan cuma di
            baris atas halaman — di sinilah pertanyaannya muncul, dan tanpa jalan
            dari sini yang tersisa hanya mengetik nama family dari ingatan.

            Tanpa kategori, membaca model tidak menghasilkan daftar apa pun, jadi
            tombolnya tidak ditawarkan: ia hanya akan menunggu Revit lalu tidak
            mengubah apa pun di layar. */}
        {isFamilyField && typeOptions.length === 0 && familyCategory && (
          <button
            type="button"
            onClick={onLoadModel}
            disabled={modelLoading}
            className="text-xs text-accent underline disabled:opacity-40"
          >
            {modelLoading ? t("command.modelLoading") : t("command.familiesLoad")}
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
            {/* Nilainya nama family saja, tanpa ": Tipe" di belakangnya.
                Bentuk `Family: Type` adalah cara Revit MENAMPILKAN sebuah tipe,
                dan mengirimkannya kembali sebagai argumen tidak cocok dengan apa
                pun: perintahnya tetap berjalan, tetap melaporkan sepuluh armatur
                terpasang, dan yang terpasang adalah family bawaan add-in. */}
            {typeOptions.map((option) => (
              <option key={option.name} value={option.name}>
                {option.name}
                {option.types.length > 1 ? ` (${option.types.length} tipe)` : ""}
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
          {/* Kolom family yang belum punya daftar. Dikatakan terus terang bahwa
              yang diketik di sini harus persis sama dengan nama di Revit. */}
          {isFamilyField && typeOptions.length === 0 && (
            <span className="block text-xs opacity-55">
              {!familyCategory
                ? t("command.familiesNoCategory")
                : model
                  ? t("command.familiesNone")
                  : t("command.familiesAsk")}
            </span>
          )}
          {/* Nama yang diketik sendiri dan tidak ada di daftar model.
              Add-in tidak menjawab "family tidak ditemukan" — ia memakai
              bawaannya lalu melaporkan sukses, jadi kalau tidak dikatakan di
              sini, tidak dikatakan di mana pun sampai gambarnya dilihat. */}
          {isFamilyField && typeOptions.length > 0 && unknownFamily && (
            <span className="block text-xs text-amber-600 dark:text-amber-400">
              {t("command.familyUnknown")}
            </span>
          )}
        </>
      )}
      {extra}
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
