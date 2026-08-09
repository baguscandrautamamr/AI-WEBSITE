"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useI18n } from "@/lib/i18n";
import type { Role } from "@/types/database";

export default function DashboardNav({ role }: { role: Role }) {
  const { t, locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();
  const pathname = usePathname();

  const items = [
    { href: "/electrical", label: t("nav.electrical"), roles: ["admin", "user_revit"] },
    { href: "/standard", label: t("nav.standard"), roles: ["admin", "user_revit", "viewer"] },
    { href: "/export-import", label: t("nav.exportImport"), roles: ["admin", "user_revit"] },
    { href: "/history", label: t("nav.history"), roles: ["admin", "user_revit", "viewer"] },
    { href: "/admin/devices", label: t("nav.admin"), roles: ["admin"] },
  ];

  return (
    <nav className="glass-panel m-4 w-56 flex flex-col p-4 gap-2 h-fit">
      {items
        .filter((i) => i.roles.includes(role))
        .map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-xl px-3 py-2 text-sm ${
              pathname === item.href ? "bg-accent text-white" : "hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            {item.label}
          </Link>
        ))}

      <div className="mt-4 flex gap-2 text-xs text-text-secondary">
        <button onClick={() => setLocale(locale === "id" ? "en" : "id")} className="glass-input px-2 py-1">
          {locale.toUpperCase()}
        </button>
        <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="glass-input px-2 py-1">
          {theme === "dark" ? "🌙" : "☀️"}
        </button>
      </div>
    </nav>
  );
}
