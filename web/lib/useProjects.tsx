"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Role } from "@/lib/commands";

export interface ProjectAccess {
  projectId: string;
  code: string;
  name: string;
  role: Role;
}

interface ProjectsState {
  projects: ProjectAccess[];
  loading: boolean;
  error: string | null;
}

const ProjectsContext = createContext<ProjectsState | null>(null);

/**
 * Proyek yang boleh diakses user beserta perannya di masing-masing proyek.
 *
 * Datanya dari user_project_access; RLS sudah membatasi ke baris milik user,
 * jadi tidak ada filter tambahan di sini. Daftar kosong bukan error — itu
 * kondisi normal untuk akun yang belum diberi izin admin, dan halaman
 * menampilkannya sebagai pesan, bukan sebagai kegagalan.
 *
 * Provider-nya dipasang di layout dashboard, dan layout di App Router bertahan
 * lintas navigasi. Jadi daftar ini diambil sekali per kunjungan, bukan setiap
 * kali pindah halaman — itu satu perjalanan ke Supabase yang hilang dari setiap
 * klik menu.
 */
export function ProjectsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ProjectsState>({
    projects: [],
    loading: true,
    error: null,
  });

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
        setState({ projects: [], loading: false, error: error.message });
        return;
      }

      setState({
        projects: (data ?? []).map((r) => ({
          projectId: r.project_id,
          code: r.projects?.code ?? r.project_id.slice(0, 8),
          name: r.projects?.name ?? r.projects?.code ?? "—",
          role: r.role,
        })),
        loading: false,
        error: null,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return <ProjectsContext.Provider value={state}>{children}</ProjectsContext.Provider>;
}

export function useProjects(): ProjectsState {
  const ctx = useContext(ProjectsContext);
  if (!ctx) throw new Error("useProjects harus dipakai di dalam ProjectsProvider");
  return ctx;
}
