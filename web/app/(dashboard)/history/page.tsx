"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import type { FileRecord } from "@/types/database";

export default function HistoryPage() {
  const { t } = useI18n();
  const supabase = createClient();
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("files").select("*").order("created_at", { ascending: false });
      setFiles(data ?? []);
    })();
  }, []);

  async function downloadSelected() {
    const urls = files.filter((f) => selected.includes(f.id)).map((f) => f.cloudinary_url);
    const res = await fetch("/api/files/zip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls }),
    });
    const blob = await res.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "export-bundle.zip";
    link.click();
  }

  if (files.length === 0) return <p className="text-text-secondary">{t("history.empty")}</p>;

  return (
    <div className="glass-panel max-w-2xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">{t("history.title")}</h1>
        <button onClick={downloadSelected} disabled={selected.length === 0} className="btn-accent text-xs">
          {t("history.downloadAll")}
        </button>
      </div>

      <div className="space-y-2">
        {files.map((f) => (
          <div key={f.id} className="glass-input flex items-center justify-between text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={selected.includes(f.id)}
                onChange={(e) =>
                  setSelected((prev) => (e.target.checked ? [...prev, f.id] : prev.filter((x) => x !== f.id)))
                }
              />
              {f.file_name ?? f.kind} · {f.kind.toUpperCase()}
            </label>
            <a href={f.cloudinary_url} target="_blank" className="text-accent underline">↓</a>
          </div>
        ))}
      </div>
    </div>
  );
}
