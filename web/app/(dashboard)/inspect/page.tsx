"use client";

import CommandRunner from "../CommandRunner";
import { useI18n } from "@/lib/i18n";

// Perintah yang MEMBACA model dan tidak mengubahnya: /query dan /inspect.
//
// Kelompok "read" sudah ada di katalog sejak awal dan tidak pernah punya
// halaman — /electrical menampilkan device dan layout, /export-import
// menampilkan export, dan tidak ada satu pun tombol di mana pun yang menjalankan
// /query. Kemampuannya ada, jalannya tidak.
//
// Terbuka untuk semua peran, termasuk viewer: tidak ada perintah di sini yang
// membuka transaksi Revit, jadi tidak ada yang bisa mengubah gambar. Itu juga
// yang membuat halaman ini tempat yang benar untuk orang yang hanya boleh
// melihat — sebelum ini, mereka tidak punya halaman yang bisa menjawab apa pun
// tentang isi model.
export default function InspectPage() {
  const { t } = useI18n();
  return <CommandRunner groups={["read"]} title={t("inspect.title")} chat />;
}
