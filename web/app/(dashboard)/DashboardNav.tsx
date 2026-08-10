"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useI18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/client";
import type { Role } from "@/lib/commands";

export default function DashboardNav({ role }: { role: Role }) {
  const { t, locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();
  const pathname = usePathname();
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  /**
   * Keluar dari sesi ini.
   *
   * Sebelumnya tidak ada jalan keluar sama sekali: sesi Supabase bertahan
   * berhari-hari, jadi satu komputer yang dipakai bergantian — hal yang biasa di
   * ruang proyek — berarti orang berikutnya melanjutkan sebagai orang
   * sebelumnya, dengan akses proyek dan riwayat chat yang bukan miliknya.
   *
   * router.refresh() setelahnya, bukan hanya replace: halaman dashboard adalah
   * Server Component yang membaca cookie, dan tanpa penyegaran itu ia bisa
   * tergambar ulang dari cache dengan data orang yang baru saja keluar.
   */
  async function signOut() {
    if (leaving) return;
    setLeaving(true);

    try {
      await createClient().auth.signOut();
    } catch {
      // Sesi yang sudah tidak sah di server tetap harus hilang dari layar ini.
      // Kegagalannya bukan alasan untuk menahan orangnya tetap di dalam.
    }

    router.replace("/login");
    router.refresh();
  }

  // Peran mengikuti tabel di docs/COMMANDS.md: viewer boleh query, export,
  // print_pdf dan list_sheets — jadi export-import ikut terlihat untuk viewer.
  // Yang mengubah model (halaman electrical) butuh editor ke atas.
  const items: { href: string; label: string; roles: Role[] }[] = [
    { href: "/electrical", label: t("nav.electrical"), roles: ["editor", "admin"] },
    { href: "/standard", label: t("nav.standard"), roles: ["viewer", "editor", "admin"] },
    { href: "/export-import", label: t("nav.exportImport"), roles: ["viewer", "editor", "admin"] },
    // Import mengubah model, jadi viewer tidak melihatnya sama sekali — bukan
    // melihatnya lalu ditolak setelah file terlanjur diunggah.
    { href: "/import", label: t("nav.import"), roles: ["editor", "admin"] },
    { href: "/history", label: t("nav.history"), roles: ["viewer", "editor", "admin"] },
    // Terlihat semua peran: di sinilah proyek dibuat, dan orang yang belum
    // punya proyek sama sekali justru yang paling perlu membukanya. Yang di
    // dalamnya tetap dijaga — pengelolaan akses hanya muncul untuk proyek yang
    // memang dia admini.
    { href: "/admin/users", label: t("nav.admin"), roles: ["viewer", "editor", "admin"] },
  ];

  return (
    // Di HP: baris menu yang bisa digeser ke samping, menempel di atas. Di layar
    // sedang ke atas: kolom di kiri seperti sebelumnya. Lebarnya dibatasi hanya
    // pada mode kolom — `w-56` yang berlaku di semua ukuran adalah yang membuat
    // layar telepon kehabisan tempat.
    <nav
      className="glass-panel m-3 flex shrink-0 gap-2 overflow-x-auto p-3
                 md:m-4 md:h-fit md:w-56 md:flex-col md:overflow-visible md:p-4"
    >
      {items
        .filter((i) => i.roles.includes(role))
        .map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`whitespace-nowrap rounded-xl px-3 py-2 text-sm ${
              pathname === item.href ? "bg-accent text-white" : "hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            {item.label}
          </Link>
        ))}

      {/* Ikut mengalir di baris menu saat di HP, dan turun ke bawah daftar saat
          jadi kolom. ms-auto mendorongnya ke ujung kanan baris supaya tidak
          terselip di antara menu. */}
      <div className="ms-auto flex shrink-0 items-center gap-2 text-xs text-text-secondary md:ms-0 md:mt-4">
        <button
          onClick={() => setLocale(locale === "id" ? "en" : "id")}
          className="glass-input px-2 py-1"
          aria-label="Bahasa"
        >
          {locale.toUpperCase()}
        </button>
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="glass-input px-2 py-1"
          aria-label="Tema"
        >
          {theme === "dark" ? "🌙" : "☀️"}
        </button>
        <button
          onClick={signOut}
          disabled={leaving}
          className="glass-input px-2 py-1 disabled:opacity-40"
          title={t("auth.logout")}
        >
          {leaving ? t("auth.loggingOut") : t("auth.logout")}
        </button>
      </div>
    </nav>
  );
}
