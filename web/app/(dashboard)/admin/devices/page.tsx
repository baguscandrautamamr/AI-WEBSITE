"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RevitDevice } from "@/types/database";

export default function AdminDevicesPage() {
  const supabase = createClient();
  const [devices, setDevices] = useState<RevitDevice[]>([]);
  const [name, setName] = useState("");

  async function load() {
    const { data } = await supabase.from("revit_devices").select("*").order("created_at", { ascending: false });
    setDevices(data ?? []);
  }

  useEffect(() => { load(); }, []);

  async function createDevice() {
    const res = await fetch("/api/devices/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceName: name }),
    });
    if (res.ok) {
      setName("");
      load();
    }
  }

  return (
    <div className="glass-panel max-w-2xl p-6 space-y-4">
      <h1 className="text-lg font-medium">Kelola Device Revit</h1>

      <div className="flex gap-2">
        <input className="glass-input flex-1" placeholder="Nama device (misal: PC Bagus)" value={name} onChange={(e) => setName(e.target.value)} />
        <button onClick={createDevice} className="btn-accent">Buat pairing code</button>
      </div>

      <div className="space-y-2">
        {devices.map((d) => (
          <div key={d.id} className="glass-input flex items-center justify-between text-sm">
            <span>{d.device_name} {d.is_paired ? "✅ terpasang" : "⏳ belum dipasang"}</span>
            <code className="text-xs">{d.pairing_code}</code>
          </div>
        ))}
      </div>
      <p className="text-xs text-text-secondary">
        Masukkan pairing code ini saat pertama kali add-in dijalankan di PC Revit yang bersangkutan.
      </p>
    </div>
  );
}
