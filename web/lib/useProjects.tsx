"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
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
  /** Membaca ulang daftarnya — dipanggil setelah sebuah proyek dibuat. */
  refresh: () => Promise<void>;
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
  const [projects, setProjects] = useState<ProjectAccess[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const supabase = createClient();

    const { data, error: readError } = await supabase
      .from("user_project_access")
      .select("role, project_id, projects(code, name)")
      .returns<
        { role: Role; project_id: string; projects: { code: string; name: string } | null }[]
      >();

    if (readError) {
      setProjects([]);
      setError(readError.message);
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
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <ProjectsContext.Provider value={{ projects, loading, error, refresh }}>
      {children}
    </ProjectsContext.Provider>
  );
}

export function useProjects(): ProjectsState {
  const ctx = useContext(ProjectsContext);
  if (!ctx) throw new Error("useProjects harus dipakai di dalam ProjectsProvider");
  return ctx;
}
