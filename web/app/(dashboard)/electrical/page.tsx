"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";

interface DeviceOption { device_id: string; device_name: string }

export default function ElectricalPage() {
  const { t } = useI18n();
  const supabase = createClient();
  const [devices, setDevices] = useState<DeviceOption[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [text, setText] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [resultLog, setResultLog] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // ambil device yg diakses user, join manual sederhana
    (async () => {
      const { data } = await supabase
        .from("device_access")
        .select("device_id, revit_devices(device_name)")
        .returns<any[]>();
      const opts = (data ?? []).map((d) => ({
        device_id: d.device_id,
        device_name: d.revit_devices?.device_name ?? d.device_id,
      }));
      setDevices(opts);
      if (opts[0]) setDeviceId(opts[0].device_id);
    })();
  }, []);

  async function runCommand() {
    setLoading(true);
    setStatus("pending");
    setResultLog(null);

    const res = await fetch("/api/ai/electrical", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId, text }),
    });
    const { commandId, error } = await res.json();
    if (error) {
      setStatus("failed");
      setResultLog(error);
      setLoading(false);
      return;
    }

    // polling command_results tiap 2 detik sampai selesai
    const interval = setInterval(async () => {
      const { data: cmd } = await supabase.from("commands").select("status").eq("id", commandId).single();
      if (cmd?.status === "done" || cmd?.status === "failed") {
        clearInterval(interval);
        setStatus(cmd.status);
        const { data: result } = await supabase
          .from("command_results")
          .select("*")
          .eq("command_id", commandId)
          .single();
        setResultLog(JSON.stringify(result?.result ?? {}, null, 2));
        setLoading(false);
      } else if (cmd?.status) {
        setStatus(cmd.status);
      }
    }, 2000);
  }

  if (devices.length === 0) {
    return <p className="text-text-secondary">{t("electrical.noDevice")}</p>;
  }

  return (
    <div className="glass-panel max-w-2xl p-6 space-y-4">
      <h1 className="text-lg font-medium">{t("electrical.title")}</h1>

      <select className="glass-input w-full" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
        {devices.map((d) => (
          <option key={d.device_id} value={d.device_id}>{d.device_name}</option>
        ))}
      </select>

      <textarea
        className="glass-input w-full h-28"
        placeholder={t("electrical.placeholder")}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      <button onClick={runCommand} disabled={loading || !text} className="btn-accent">
        {t("electrical.run")}
      </button>

      {status && <p className="text-sm text-text-secondary">{t(`electrical.status.${status}`)}</p>}
      {resultLog && <pre className="glass-panel p-3 text-xs overflow-auto max-h-64">{resultLog}</pre>}
    </div>
  );
}
