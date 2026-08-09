"use client";

import CommandRunner from "../CommandRunner";
import { useI18n } from "@/lib/i18n";

// Mode Electrical: setiap tombol di sini menulis satu baris ke commands_queue,
// yang diambil add-in Revit lewat claim_next_command. Berbeda dengan halaman
// Standard, yang sengaja tidak pernah menyentuh Revit.
export default function ElectricalPage() {
  const { t } = useI18n();
  return <CommandRunner groups={["device", "layout"]} title={t("electrical.title")} />;
}
