"use client";

import ImportExcel from "../ImportExcel";
import ImportTable from "../ImportTable";
import { useI18n } from "@/lib/i18n";

// Halaman sendiri, bukan bagian bawah halaman Export.
//
// Keduanya membawa sesuatu MASUK ke model, sementara segala yang di halaman
// Export membawa sesuatu keluar. Menempelkannya di bawah tombol Export membuat
// arah kerjanya harus dibaca dari judul panel, bukan dari menu.
export default function ImportPage() {
  const { t } = useI18n();

  return (
    <div className="space-y-4">
      <div className="glass-panel max-w-4xl space-y-2 p-4 sm:p-6">
        <h1 className="text-lg font-medium">{t("import.title")}</h1>
        <p className="text-sm text-text-secondary">{t("import.subtitle")}</p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-text-secondary">
          <li>{t("import.whichTable")}</li>
          <li>{t("import.whichExcel")}</li>
        </ul>
      </div>

      {/* Import Tabel lebih dulu: ia menerima spreadsheet apa pun, dan itu yang
          dimaksud orang sembilan dari sepuluh kali. Import Excel menuntut kolom
          Element Id atau Mark, yang hanya ada pada file yang berasal dari
          Export — menaruhnya di atas membuat orang mencobanya lebih dulu lalu
          ditolak oleh syarat yang tidak mereka ketahui. */}
      <ImportTable />
      <ImportExcel />
    </div>
  );
}
