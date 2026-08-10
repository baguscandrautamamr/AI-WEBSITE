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
      <div className="max-w-4xl">
        <h1 className="text-lg font-medium">{t("import.title")}</h1>
        <p className="text-sm text-text-secondary">{t("import.subtitle")}</p>
      </div>

      <ImportExcel />
      <ImportTable />
    </div>
  );
}
