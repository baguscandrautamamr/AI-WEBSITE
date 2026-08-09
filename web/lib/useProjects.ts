"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Role } from "@/lib/commands";

export interface ProjectAccess {
  projectId: string;
  code: string;
  name: string;
  role: Role;
}

/**
 * Proyek yang boleh diakses user beserta perannya di masing-masing proyek.
 *
 * Datanya dari user_project_access; RLS sudah membatasi ke baris milik user,
 * jadi tidak ada filter tambahan di sini. Daftar kosong bukan error — itu
 * kondisi normal untuk akun yang belum diberi izin admin, dan halaman
 * menampilkannya sebagai pesan, bukan sebagai kegagalan.
 */
export function useProjects() {
  const [projects, setProjects] = useState<ProjectAccess[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("user_project_access")
        .select("role, project_id, projects(code, name)")
        .returns<
          { role: Role; project_id: string; projects: { code: string; name: string } | null }[]
        >();

      if (cancelled) return;

      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }

      setProjects(
        (data ?? []).map((r) => ({
          projectId: r.project_id,
          code: r.projects?.code ?? r.project_id.slice(0, 8),
          name: r.projects?.name ?? r.projects?.code ?? "—",
          role: r.role,
        }))
      );
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { projects, loading, error };
}
