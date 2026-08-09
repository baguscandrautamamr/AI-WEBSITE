"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";

interface Sheet { id: number; number: string; name: string }

export default function ExportImportPage() {
  const { t } = useI18n();
  const supabase = createClient();
  const [deviceId, setDeviceId] = useState(""); // TODO: isi dari dropdown device seperti di halaman electrical
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [dwgSetup, setDwgSetup] = useState("");
  const [pdfQuality, setPdfQuality] = useState("High");
  const [busy, setBusy] = useState(false);

  async function insertCommand(type: string, payload: Record<string, unknown>) {
    const { data, error } = await supabase
      .from("commands")
      .insert({ device_id: deviceId, type, payload })
      .select("id")
      .single();
    if (error) throw error;
    return data.id as string;
  }

  async function pollResult(commandId: string) {
    return new Promise<any>((resolve) => {
      const interval = setInterval(async () => {
        const { data: cmd } = await supabase.from("commands").select("status").eq("id", commandId).single();
        if (cmd?.status === "done" || cmd?.status === "failed") {
          clearInterval(interval);
          const { data: result } = await supabase
            .from("command_results")
            .select("*")
            .eq("command_id", commandId)
            .single();
          resolve(result);
        }
      }, 2000);
    });
  }

  async function refreshSheets() {
    setBusy(true);
    const id = await insertCommand("get_sheets", {});
    const result = await pollResult(id);
    setSheets(result?.result?.sheets ?? []);
    setBusy(false);
  }

  async function exportPdf() {
    setBusy(true);
    await insertCommand("export_pdf", { sheetIds: selected, style: { rasterQuality: pdfQuality } });
    setBusy(false);
    // hasil file akan muncul di halaman History setelah add-in upload ke Cloudinary
  }

  async function exportDwg() {
    setBusy(true);
    await insertCommand("export_dwg", { sheetIds: selected, exportSetupName: dwgSetup });
    setBusy(false);
  }

  async function importPdf(file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const uploadRes = await fetch("/api/files/upload", { method: "POST", body: form });
      const body = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(body.error ?? "upload gagal");
      await insertCommand("import_pdf", { fileUrl: body.url });
    } catch (err) {
      // TODO: ganti dengan komponen toast begitu ada di UI kit.
      alert(`Import PDF gagal: ${err instanceof Error ? err.message : err}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass-panel max-w-3xl p-6 space-y-6">
      <h1 className="text-lg font-medium">{t("exportImport.title")}</h1>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">{t("exportImport.sheets")}</h2>
          <button onClick={refreshSheets} disabled={busy} className="btn-accent text-xs">
            {t("exportImport.refreshSheets")}
          </button>
        </div>
        <div className="glass-input max-h-48 overflow-auto space-y-1">
          {sheets.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(s.id)}
                onChange={(e) =>
                  setSelected((prev) =>
                    e.target.checked ? [...prev, s.id] : prev.filter((x) => x !== s.id)
                  )
                }
              />
              {s.number} — {s.name}
            </label>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm">{t("exportImport.pdfQuality")}</label>
          <select className="glass-input w-full" value={pdfQuality} onChange={(e) => setPdfQuality(e.target.value)}>
            <option>Low</option>
            <option>Medium</option>
            <option>High</option>
          </select>
          <button onClick={exportPdf} disabled={busy || selected.length === 0} className="btn-accent w-full">
            {t("exportImport.exportPdf")}
          </button>
        </div>

        <div className="space-y-2">
          <label className="text-sm">{t("exportImport.dwgSetup")}</label>
          <input className="glass-input w-full" value={dwgSetup} onChange={(e) => setDwgSetup(e.target.value)} />
          <button onClick={exportDwg} disabled={busy || selected.length === 0} className="btn-accent w-full">
            {t("exportImport.exportDwg")}
          </button>
        </div>
      </section>

      <section className="space-y-2">
        <label className="text-sm">{t("exportImport.importPdf")}</label>
        <input type="file" accept="application/pdf" onChange={(e) => e.target.files && importPdf(e.target.files[0])} />
      </section>
    </div>
  );
}
