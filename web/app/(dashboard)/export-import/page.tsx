"use client";

import CommandRunner from "../CommandRunner";
import { useI18n } from "@/lib/i18n";

// Export lewat command yang benar-benar dimengerti add-in: /list_sheets untuk
// melihat nomor sheet, /print_pdf untuk mencetak gambarnya, dan /export untuk
// schedule serta laporan kepatuhan (excel, pdf, dwg, dxf, ifc).
//
// Tidak ada tombol Import di sini: katalog command add-in (docs/COMMANDS.md di
// repo electrical_ai) tidak punya command import apa pun, jadi tombol semacam
// itu hanya akan mengantre baris yang pasti ditolak.
export default function ExportImportPage() {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <CommandRunner groups={["export"]} title={t("exportImport.title")} />
      <p className="max-w-4xl text-xs text-text-secondary">{t("exportImport.note")}</p>
    </div>
  );
}
