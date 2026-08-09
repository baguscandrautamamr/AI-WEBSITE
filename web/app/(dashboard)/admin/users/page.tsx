"use client";

import { useEffect, useState } from "react";
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

/**
 * Memberi user akses ke proyek — satu-satunya hal yang membuat akun baru bisa
 * dipakai. Akun yang baru mendaftar sengaja tidak punya baris di
 * user_project_access, jadi tanpa halaman ini semua perintahnya ditolak RLS.
 *
 * Semua penulisan lewat /api/admin/access, bukan langsung dari browser: daftar
 * user butuh service role, dan pemeriksaan "pemanggil admin di proyek ini"
 * harus terjadi di server.
 */
export default function AdminUsersPage() {
  const { t } = useI18n();
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [access, setAccess] = useState<Access[]>([]);
  const [projectId, setProjectId] = useState("");
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/admin/access");
    const body = await res.json();
    if (!res.ok) {
      setError(body.error ?? t("admin.loadFailed"));
      setLoading(false);
      return;
    }
    setProjects(body.projects);
    setUsers(body.users);
    setAccess(body.access);
    setProjectId((prev) => prev || body.projects[0]?.id || "");
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function grant() {
    if (!userId || !projectId) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, projectId, role }),
    });
    if (!res.ok) setError((await res.json()).error ?? t("admin.grantFailed"));
    else {
      setUserId("");
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

  const nameOf = (id: string) => users.find((u) => u.id === id)?.full_name ?? id.slice(0, 8);
  const onProject = access.filter((a) => a.project_id === projectId);
  const grantable = users.filter((u) => !onProject.some((a) => a.user_id === u.id));

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
        <div className="flex flex-wrap gap-2">
          <select
            className="glass-input flex-1 min-w-[12rem]"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          >
            <option value="">{t("admin.pickUser")}</option>
            {grantable.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name} ({u.auth_provider})
              </option>
            ))}
          </select>
          <select
            className="glass-input"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            <option value="viewer">viewer</option>
            <option value="editor">editor</option>
            <option value="admin">admin</option>
          </select>
          <button onClick={grant} disabled={busy || !userId} className="btn-accent">
            {t("admin.grant")}
          </button>
        </div>
        <p className="text-xs text-text-secondary">{t("admin.roleNote")}</p>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
