"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useProjects } from "@/lib/useProjects";
import { ACCESS_CLASSES, type AccessClass } from "@/lib/access";

type Role = "viewer" | "editor" | "admin";

interface Project {
  id: string;
  code: string;
  name: string;
}

interface User {
  id: string;
  full_name: string;
  auth_provider: "telegram" | "web";
  is_active: boolean;
  /** Halaman mana yang boleh dibuka akun ini. Berbeda dari peran di proyek. */
  access_class: AccessClass;
}

interface Access {
  user_id: string;
  project_id: string;
  role: Role;
}

/** Jeda sebelum ketikan jadi permintaan, supaya tiap huruf tidak jadi satu query. */
const SEARCH_DEBOUNCE_MS = 300;

interface AccessData {
  projects: Project[];
  members: User[];
  pending: User[];
  access: Access[];
  searchMinChars: number;
  /** Boleh memberi peran di proyek. Kelas standard_only hanya melihat. */
  canGrant: boolean;
  /** Id pemanggil, supaya barisnya sendiri tidak bisa diturunkan sendiri. */
  me: string;
  /**
   * Admin global. Menentukan dua hal yang keduanya berlaku di seluruh sistem:
   * mengubah kelas akun, dan menghapus akun.
   */
  isGlobalAdmin: boolean;
}

/**
 * Jawaban terakhir yang berhasil, disimpan di luar komponen.
 *
 * Layout dashboard bertahan lintas navigasi tapi halamannya tidak: berpindah ke
 * Export lalu kembali ke sini membongkar komponen ini dan membuang state-nya,
 * jadi tiap kunjungan berikutnya dimulai dari "Memuat…" walau datanya sudah
 * pernah ada. Disimpan di sini, kunjungan kedua langsung menampilkan yang
 * terakhir diketahui sementara versi barunya diambil di belakang.
 *
 * Hidup selama tab terbuka. Itu memang yang diinginkan: menyimpannya lebih lama
 * berarti data satu akun tertinggal di perangkat setelah orangnya keluar.
 */
let cached: AccessData | null = null;

/**
 * Memberi user akses ke proyek — satu-satunya hal yang membuat akun baru bisa
 * dipakai. Akun yang baru mendaftar sengaja tidak punya baris di
 * user_project_access, jadi tanpa halaman ini semua perintahnya ditolak RLS.
 *
 * Semua penulisan lewat /api/admin/access, bukan langsung dari browser: data
 * user butuh service role, dan pemeriksaan "pemanggil admin di proyek ini"
 * harus terjadi di server.
 *
 * Orang yang mau ditambahkan dicari dengan mengetik namanya, bukan dipilih dari
 * daftar semua orang. Bedanya bukan soal tampilan: daftar itu berarti server
 * mengirimkan seluruh tabel `users` ke setiap admin proyek, termasuk pengguna
 * yang tidak ada hubungannya dengan proyeknya.
 */
export default function AdminUsersPage() {
  const { t } = useI18n();
  const { refresh: refreshProjects } = useProjects();
  const [projects, setProjects] = useState<Project[]>([]);
  const [members, setMembers] = useState<User[]>([]);
  const [pending, setPending] = useState<User[]>([]);
  const [access, setAccess] = useState<Access[]>([]);
  const [projectId, setProjectId] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [minChars, setMinChars] = useState(2);
  /**
   * Dua izin yang berbeda, dan keduanya datang dari server.
   *
   * Tidak diturunkan dari daftar proyek di browser: "boleh memberi akses" adalah
   * keputusan yang dibuat route, dan menghitungnya ulang di sini berarti dua
   * jawaban yang bisa berbeda — yang satu menentukan tombolnya terlihat, yang
   * lain menentukan permintaannya diterima.
   */
  const [canGrant, setCanGrant] = useState(true);
  const [me, setMe] = useState("");
  const [isGlobalAdmin, setIsGlobalAdmin] = useState(false);
  const [picked, setPicked] = useState<User | null>(null);
  /** Peran yang dipilih untuk tiap akun menunggu, sebelum tombol Beri ditekan. */
  const [pendingRole, setPendingRole] = useState<Record<string, Role>>({});

  const apply = useCallback((data: AccessData) => {
    setProjects(data.projects);
    setMembers(data.members);
    setPending(data.pending);
    setAccess(data.access);
    setMinChars(data.searchMinChars);
    setCanGrant(data.canGrant);
    setMe(data.me);
    setIsGlobalAdmin(data.isGlobalAdmin);
    setProjectId((prev) => prev || data.projects[0]?.id || "");
    setLoading(false);
  }, []);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/access");
    const body = await res.json();
    if (!res.ok) {
      setError(body.error ?? t("admin.loadFailed"));
      setLoading(false);
      return;
    }

    cached = {
      projects: body.projects ?? [],
      members: body.members ?? [],
      pending: body.pending ?? [],
      access: body.access ?? [],
      searchMinChars: body.searchMinChars ?? 2,
      canGrant: Boolean(body.canGrant),
      me: String(body.me ?? ""),
      isGlobalAdmin: Boolean(body.isGlobalAdmin),
    };
    apply(cached);

    // Daftar proyek di seluruh aplikasi ikut diperbarui: proyek yang baru
    // dibuat harus muncul di dropdown halaman lain tanpa perlu memuat ulang.
    await refreshProjects();
  }, [t, apply, refreshProjects]);

  // Kunjungan kedua langsung menampilkan yang terakhir diketahui, lalu
  // menyegarkannya di belakang — bukan mengosongkan layar dulu.
  useEffect(() => {
    if (cached) apply(cached);
    load();
  }, [apply, load]);

  // Pencarian hanya berangkat setelah ketikan berhenti sejenak dan sudah cukup
  // panjang; di bawah itu daftar hasil dikosongkan, bukan diisi tebakan.
  useEffect(() => {
    const q = query.trim();
    let cancelled = false;

    // Semuanya di dalam timeout, termasuk pengosongan hasil: menulis state
    // langsung di badan efek memicu render beruntun, dan jeda 300 ms sebelum
    // daftar lama hilang tidak terlihat oleh siapa pun.
    const timer = setTimeout(async () => {
      if (q.length < minChars) {
        setMatches([]);
        setSearched(false);
        return;
      }

      setSearching(true);
      try {
        const res = await fetch(`/api/admin/access?q=${encodeURIComponent(q)}`);
        const body = await res.json();
        if (cancelled) return;
        if (res.ok) setMatches(body.matches ?? []);
        else setError(body.error ?? t("admin.loadFailed"));
      } finally {
        if (!cancelled) {
          setSearching(false);
          setSearched(true);
        }
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, minChars, t]);

  async function grant(user: User, chosenRole: Role) {
    if (!projectId) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id, projectId, role: chosenRole }),
    });
    if (!res.ok) setError((await res.json()).error ?? t("admin.grantFailed"));
    else {
      setPicked(null);
      setQuery("");
      await load();
    }
    setBusy(false);
  }

  /**
   * Mengubah kelas akun seseorang.
   *
   * PATCH, bukan POST yang sama dengan pemberian peran: yang ini berlaku untuk
   * SELURUH akun — di semua proyek, dan di halaman yang tidak punya proyek sama
   * sekali — sementara POST memberi peran pada satu proyek. Dikirim ke endpoint
   * yang sama tapi metode yang berbeda, karena keduanya juga dijaga berbeda:
   * peran oleh admin proyek, kelas oleh admin global.
   */
  async function setClass(targetUserId: string, next: AccessClass) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/access", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: targetUserId, accessClass: next }),
    });
    if (!res.ok) setError((await res.json()).error ?? t("admin.classFailed"));
    else await load();
    setBusy(false);
  }

  /**
   * Menghapus sebuah akun, kedua sisinya: identitas login dan barisnya.
   *
   * Dikonfirmasi dengan namanya, bukan dengan "yakin?" — daftar ini berisi
   * beberapa baris yang bentuknya sama persis, dan tombol yang salah baris adalah
   * kesalahan yang paling mudah dilakukan di sini dan tidak bisa dibatalkan.
   */
  async function removeAccount(user: User) {
    if (!window.confirm(t("admin.deleteConfirm").replace("{name}", user.full_name))) return;

    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/users?userId=${encodeURIComponent(user.id)}`, {
      method: "DELETE",
    });
    if (!res.ok) setError((await res.json()).error ?? t("admin.deleteFailed"));
    else await load();
    setBusy(false);
  }

  /**
   * Mengubah peran seseorang di proyek yang sedang dipilih.
   *
   * Endpoint yang sama dengan pemberian akses, karena memang hal yang sama: ia
   * `upsert` pada (user_id, project_id), jadi memberi ulang dengan peran lain
   * MENGGANTI yang ada. Tanpa kendali ini, satu-satunya cara mengubah peran
   * adalah mencabut lalu memberi ulang — dan hasil pencarian menyaring keluar
   * orang yang sudah ada di proyek itu, jadi orang yang perannya mau diubah
   * justru tidak bisa ditemukan lagi setelah dicabut.
   */
  async function setProjectRole(targetUserId: string, next: Role) {
    if (!projectId) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: targetUserId, projectId, role: next }),
    });
    if (!res.ok) setError((await res.json()).error ?? t("admin.roleFailed"));
    else await load();
    setBusy(false);
  }

  async function revoke(targetUserId: string) {
    setBusy(true);
    setError(null);
    const res = await fetch(
      `/api/admin/access?userId=${encodeURIComponent(targetUserId)}&projectId=${encodeURIComponent(projectId)}`,
      { method: "DELETE" }
    );
    if (!res.ok) setError((await res.json()).error ?? t("admin.revokeFailed"));
    else await load();
    setBusy(false);
  }

  if (loading) return <p className="opacity-60">{t("common.loading")}</p>;

  // Belum mengelola proyek apa pun. Bukan halaman kosong: di sinilah proyek
  // pertama dibuat, dan tanpa itu akun yang baru mendaftar tidak punya satu pun
  // jalan untuk mulai bekerja.
  if (projects.length === 0) {
    return (
      <div className="glass-panel max-w-2xl space-y-4 p-4 sm:p-6">
        <div>
          <h1 className="text-lg font-medium">{t("admin.title")}</h1>
          <p className="text-sm text-text-secondary">
            {canGrant ? t("admin.notAdmin") : t("admin.notAdminViewOnly")}
          </p>
        </div>
        {/* Membuat proyek berarti memberi diri sendiri akses admin di dalamnya,
            jadi formulirnya ikut kelas `grant`. Ditampilkan tanpa itu, ia
            formulir yang selalu ditolak — dan yang menekannya tidak punya cara
            menduga sebabnya, karena "buat proyek" tidak berbunyi seperti
            "beri akses". */}
        {canGrant && <NewProject onCreated={load} />}
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    );
  }

  const nameOf = (id: string) => members.find((u) => u.id === id)?.full_name ?? id.slice(0, 8);
  const classOf = (id: string) => members.find((u) => u.id === id)?.access_class ?? "full";
  const onProject = access.filter((a) => a.project_id === projectId);
  // Orang yang sudah ada di proyek ini tidak perlu muncul lagi sebagai hasil.
  const grantable = matches.filter((u) => !onProject.some((a) => a.user_id === u.id));
  const waiting = pending.filter((u) => !onProject.some((a) => a.user_id === u.id));

  return (
    <div className="glass-panel max-w-2xl space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="text-lg font-medium">{t("admin.title")}</h1>
        <p className="text-sm text-text-secondary">{t("admin.subtitle")}</p>
      </div>

      <NewProject onCreated={load} />

      <label className="block space-y-1">
        <span className="text-sm">{t("command.project")}</span>
        <select
          className="glass-input w-full"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} — {p.name}
            </option>
          ))}
        </select>
      </label>

      <div className="space-y-2">
        <h2 className="text-sm font-medium">{t("admin.members")}</h2>
        {onProject.length === 0 && (
          <p className="text-sm text-text-secondary">{t("admin.noMembers")}</p>
        )}
        {onProject.map((a) => (
          <div key={a.user_id} className="glass-input flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
            <span className="min-w-[6rem] flex-1 truncate">{nameOf(a.user_id)}</span>

            {/* Peran, bisa diubah di tempat. Sebelumnya ia tulisan mati, dan
                mengubahnya berarti mencabut lalu mencari orangnya lagi — padahal
                hasil pencarian sengaja menyaring keluar anggota proyek ini, jadi
                setelah dicabut ia hilang dari kedua daftar sampai dicari ulang.
                Barisnya sendiri dimatikan: seorang admin yang menjadikan dirinya
                viewer kehilangan halaman ini tanpa jalan kembali. */}
            {canGrant ? (
              <select
                className="glass-input text-xs"
                value={a.role}
                disabled={busy || a.user_id === me}
                title={a.user_id === me ? t("admin.roleSelf") : undefined}
                onChange={(e) => setProjectRole(a.user_id, e.target.value as Role)}
              >
                <option value="viewer">viewer</option>
                <option value="editor">editor</option>
                <option value="admin">admin</option>
              </select>
            ) : (
              <span className="text-xs opacity-55">{a.role}</span>
            )}

            {/* Kelas akun selalu TERLIHAT, kontrolnya hanya untuk admin global.
                Terlihat karena tanpa itu tidak ada cara mengetahui mengapa
                seorang editor tidak bisa membuka halaman Electrical — peran dan
                kelas dua-duanya menentukan, dan yang satu tak terlihat. */}
            {isGlobalAdmin ? (
              <ClassPicker
                value={classOf(a.user_id)}
                disabled={busy}
                onChange={(next) => setClass(a.user_id, next)}
              />
            ) : (
              <span className="text-xs opacity-55">{t(`admin.class.${classOf(a.user_id)}`)}</span>
            )}

            {canGrant && (
              <button
                onClick={() => revoke(a.user_id)}
                disabled={busy}
                className="text-xs text-red-500 hover:underline disabled:opacity-40"
              >
                {t("admin.revoke")}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Akun yang baru mendaftar muncul sendiri di sini. Sampai seorang admin
          memberinya peran, orangnya bisa login tapi tidak bisa berbuat apa pun —
          jadi daftar ini adalah pekerjaan yang menunggu, bukan sekadar info. */}
      {waiting.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium">{t("admin.pendingTitle")}</h2>
          <p className="text-xs text-text-secondary">{t("admin.pendingNote")}</p>
          {waiting.map((u) => (
            <div key={u.id} className="glass-input flex flex-wrap items-center gap-2 text-sm">
              {/* Boleh dipangkas, dan min-width-nya kecil: barisnya memuat empat
                  kendali, dan nama yang menolak menyusut mendorong tombol
                  terakhir — Hapus — turun ke barisnya sendiri. */}
              <span className="min-w-[6rem] flex-1 truncate">
                {u.full_name} <span className="opacity-55">({u.auth_provider})</span>
              </span>
              {isGlobalAdmin ? (
                <ClassPicker
                  value={u.access_class}
                  disabled={busy}
                  onChange={(next) => setClass(u.id, next)}
                />
              ) : (
                <span className="text-xs opacity-55">{t(`admin.class.${u.access_class}`)}</span>
              )}

              {/* Akun berkelas standard_only tidak butuh peran proyek sama
                  sekali — halaman yang memakai proyek tidak ada baginya. Kolom
                  peran di sebelahnya hanya akan mengundang pemberian yang tidak
                  berarti apa-apa. */}
              {canGrant && u.access_class !== "standard_only" && (
                <>
                  <select
                    className="glass-input"
                    value={pendingRole[u.id] ?? "viewer"}
                    onChange={(e) =>
                      setPendingRole((prev) => ({ ...prev, [u.id]: e.target.value as Role }))
                    }
                  >
                    <option value="viewer">viewer</option>
                    <option value="editor">editor</option>
                    <option value="admin">admin</option>
                  </select>
                  <button
                    onClick={() => grant(u, pendingRole[u.id] ?? "viewer")}
                    disabled={busy}
                    className="btn-accent"
                  >
                    {t("admin.grant")}
                  </button>
                </>
              )}

              {/* Menghapus akun berlaku di seluruh sistem dan tidak bisa
                  dibatalkan, jadi tombolnya hanya ada untuk admin global —
                  syarat yang sama dengan mengubah kelas akun, dan bukan "admin
                  di setidaknya satu proyek" yang bisa dipenuhi siapa pun dengan
                  membuat satu proyek sendiri. */}
              {isGlobalAdmin && (
                <button
                  onClick={() => removeAccount(u)}
                  disabled={busy}
                  className="text-xs text-red-500 hover:underline disabled:opacity-40"
                >
                  {t("admin.delete")}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Yang tidak boleh memberi akses tidak melihat blok ini sama sekali.
          Menampilkannya lalu menolak di server berarti seseorang mencari orang,
          memilih perannya, menekan tombolnya, dan baru kemudian diberi tahu —
          tiga langkah yang seluruhnya sia-sia. */}
      {!canGrant && (
        <p className="text-xs text-text-secondary">{t("admin.viewOnly")}</p>
      )}

      <div className={canGrant ? "space-y-2" : "hidden"}>
        <h2 className="text-sm font-medium">{t("admin.grantTitle")}</h2>

        {picked ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="glass-input flex-1 min-w-[12rem] text-sm">
              {picked.full_name} <span className="opacity-55">({picked.auth_provider})</span>
            </span>
            <select
              className="glass-input"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              <option value="viewer">viewer</option>
              <option value="editor">editor</option>
              <option value="admin">admin</option>
            </select>
            <button onClick={() => grant(picked, role)} disabled={busy} className="btn-accent">
              {t("admin.grant")}
            </button>
            <button
              onClick={() => setPicked(null)}
              disabled={busy}
              className="text-xs opacity-70 hover:opacity-100 disabled:opacity-40"
            >
              {t("admin.clearPick")}
            </button>
          </div>
        ) : (
          <>
            <input
              className="glass-input w-full"
              type="search"
              placeholder={t("admin.searchUser")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />

            {searching && <p className="text-xs opacity-60">{t("admin.searching")}</p>}

            {!searching && searched && grantable.length === 0 && (
              <p className="text-xs text-text-secondary">{t("admin.noMatches")}</p>
            )}

            {!searching && grantable.length > 0 && (
              <div className="space-y-1">
                {grantable.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => setPicked(u)}
                    className="glass-input block w-full text-left text-sm hover:opacity-80"
                  >
                    {u.full_name} <span className="opacity-55">({u.auth_provider})</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        <p className="text-xs text-text-secondary">{t("admin.searchHint")}</p>
        <p className="text-xs text-text-secondary">{t("admin.roleNote")}</p>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}

/**
 * Kelas akun sebagai satu dropdown.
 *
 * Sengaja BUKAN digabung ke dropdown peran di sebelahnya. Keduanya akan terbaca
 * sebagai satu daftar pilihan yang sederajat, dan "standard_only" di antara
 * viewer/editor/admin terbaca sebagai peran di proyek — padahal ia berlaku untuk
 * seluruh akun, termasuk di halaman yang tidak punya proyek.
 */
function ClassPicker({
  value,
  disabled,
  onChange,
}: {
  value: AccessClass;
  disabled: boolean;
  onChange: (next: AccessClass) => void;
}) {
  const { t } = useI18n();

  return (
    <select
      className="glass-input text-xs"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as AccessClass)}
      title={t("admin.classTitle")}
    >
      {ACCESS_CLASSES.map((cls) => (
        <option key={cls} value={cls}>
          {t(`admin.class.${cls}`)}
        </option>
      ))}
    </select>
  );
}

/**
 * Membuat proyek baru.
 *
 * Terbuka untuk siapa pun yang sudah login, bukan hanya admin: sebelum ini
 * baris `projects` hanya bisa lahir dari SQL editor, jadi setiap proyek baru
 * menunggu orang yang punya akses database.
 *
 * Yang membuat langsung jadi admin proyek itu — kalau tidak, ia baru saja
 * membuat sesuatu yang tidak bisa ia pakai. Admin global ikut diberi akses
 * penuh, jadi proyek yang dibuat siapa pun tetap terlihat tanpa harus diminta.
 */
function NewProject({ onCreated }: { onCreated: () => Promise<void> | void }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const wanted = name.trim();
    if (!wanted || busy) return;

    setBusy(true);
    setError(null);
    setCreated(null);

    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: wanted }),
      });
      const body = await res.json();

      if (!res.ok) {
        setError(body.error ?? t("admin.createFailed"));
        return;
      }

      setName("");
      setCreated(body.project?.code ?? null);
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.createFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <h2 className="text-sm font-medium">{t("admin.createTitle")}</h2>
      <div className="flex flex-wrap gap-2">
        <input
          className="glass-input min-w-[12rem] flex-1"
          type="text"
          value={name}
          maxLength={120}
          placeholder={t("admin.createPlaceholder")}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" disabled={busy || !name.trim()} className="btn-accent">
          {busy ? t("admin.creating") : t("admin.create")}
        </button>
      </div>
      {created && (
        <p className="text-sm text-emerald-600">
          {t("admin.created")} <code>{created}</code>
        </p>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
      <p className="text-xs text-text-secondary">{t("admin.createNote")}</p>
    </form>
  );
}
