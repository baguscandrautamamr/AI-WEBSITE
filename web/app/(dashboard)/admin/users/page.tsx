"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile, RevitDevice } from "@/types/database";

export default function AdminUsersPage() {
  const supabase = createClient();
  const [users, setUsers] = useState<Profile[]>([]);
  const [devices, setDevices] = useState<RevitDevice[]>([]);
  const [selectedUser, setSelectedUser] = useState("");
  const [selectedDevice, setSelectedDevice] = useState("");

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.from("profiles").select("*");
      const { data: d } = await supabase.from("revit_devices").select("*");
      setUsers(u ?? []);
      setDevices(d ?? []);
    })();
  }, []);

  async function grantAccess() {
    if (!selectedUser || !selectedDevice) return;
    await supabase.from("device_access").insert({ user_id: selectedUser, device_id: selectedDevice });
  }

  async function revokeAccess(userId: string, deviceId: string) {
    await supabase.from("device_access").delete().eq("user_id", userId).eq("device_id", deviceId);
  }

  return (
    <div className="glass-panel max-w-2xl p-6 space-y-4">
      <h1 className="text-lg font-medium">Kelola Akses User</h1>

      <div className="flex gap-2">
        <select className="glass-input flex-1" value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)}>
          <option value="">Pilih user</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.full_name ?? u.id} ({u.role})</option>)}
        </select>
        <select className="glass-input flex-1" value={selectedDevice} onChange={(e) => setSelectedDevice(e.target.value)}>
          <option value="">Pilih device</option>
          {devices.map((d) => <option key={d.id} value={d.id}>{d.device_name}</option>)}
        </select>
        <button onClick={grantAccess} className="btn-accent">Grant</button>
      </div>

      <p className="text-xs text-text-secondary">
        Ubah role user (admin/user_revit/viewer) langsung di tabel `profiles` — bisa ditambahkan UI-nya di sini kalau perlu.
      </p>
    </div>
  );
}
