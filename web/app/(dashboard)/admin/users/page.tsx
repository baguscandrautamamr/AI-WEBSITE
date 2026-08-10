"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";

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
}

interface Access {
  user_id: string;
  project_id: string;
  role: Role;
}

/** Jeda sebelum ketikan jadi permintaan, supaya tiap huruf tidak jadi satu query. */
const SEARCH_DEBOUNCE_MS = 300;

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
  const [projects, setProjects] = useState<Project[]>([]);
  const [members, setMembers] = useState<User[]>([]);
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
  const [picked, setPicked] = useState<User | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/access");
    const body = await res.json();
    if (!res.ok) {
      setError(body.error ?? t("admin.loadFailed"));
      setLoading(false);
      return;
    }
    setProjects(body.projects);
    setMembers(body.members);
    setAccess(body.access);
    setMinChars(body.searchMinChars ?? 2);
    setProjectId((prev) => prev || body.projects[0]?.id || "");
    setLoading(false);
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

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

  async function grant() {
    if (!picked || !projectId) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: picked.id, projectId, role }),
    });
    if (!res.ok) setError((await res.json()).error ?? t("admin.grantFailed"));
    else {
      setPicked(null);
      setQuery("");
      await load();
    }
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

  if (projects.length === 0) {
    return (
      <div className="glass-panel max-w-2xl p-6 space-y-2">
        <h1 className="text-lg font-medium">{t("admin.title")}</h1>
        <p className="text-sm text-text-secondary">{error ?? t("admin.notAdmin")}</p>
      </div>
    );
  }

  const nameOf = (id: string) => members.find((u) => u.id === id)?.full_name ?? id.slice(0, 8);
  const onProject = access.filter((a) => a.project_id === projectId);
  // Orang yang sudah ada di proyek ini tidak perlu muncul lagi sebagai hasil.
  const grantable = matches.filter((u) => !onProject.some((a) => a.user_id === u.id));

  return (
    <div className="glass-panel max-w-2xl p-6 space-y-5">
      <div>
        <h1 className="text-lg font-medium">{t("admin.title")}</h1>
        <p className="text-sm text-text-secondary">{t("admin.subtitle")}</p>
      </div>

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
          <div key={a.user_id} className="glass-input flex items-center justify-between gap-3 text-sm">
            <span>
              {nameOf(a.user_id)} <span className="opacity-55">· {a.role}</span>
            </span>
            <button
              onClick={() => revoke(a.user_id)}
              disabled={busy}
              className="text-xs text-red-500 hover:underline disabled:opacity-40"
            >
              {t("admin.revoke")}
            </button>
          </div>
        ))}
      </div>

      <div className="space-y-2">
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
            <button onClick={grant} disabled={busy} className="btn-accent">
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
