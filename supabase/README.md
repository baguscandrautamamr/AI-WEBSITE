# Skema database

**Sumber kebenaran skema ada di repo [`electrical_ai`](https://github.com/baguscandrautamamr/electrical_ai)**, di `supabase/migrations/0001..0007`. Website ini memakai **project Supabase yang sama** dengan bot Telegram dan add-in Revit.

Folder ini hanya memuat migrasi yang ditambahkan oleh website, melanjutkan urutan repo tersebut:

| Migrasi | Isi |
|---|---|
| `0008_web_auth.sql` | Membuat user Supabase Auth bisa memakai `commands_queue` yang sama: `telegram_user_id` jadi nullable, trigger pembuat baris `users` dengan `id = auth.uid()`, dan policy RLS untuk user web. |

## Kenapa `0001_init.sql` dihapus dari repo ini

Scaffold awal membawa skemanya sendiri (`commands`, `command_results`, `profiles`, `revit_devices`, …) yang **tidak kompatibel** dengan skema yang dipolling add-in (`commands_queue`, `projects`, `user_project_access`, …). Menerapkannya ke database yang sama akan membuat dua sistem tandingan di satu project: website menulis ke `commands`, sementara add-in menunggu di `commands_queue`, dan tidak ada satu pun command yang sampai ke Revit.

## Urutan penerapan pada project baru

```bash
# 1. Skema inti — dari repo electrical_ai
psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql
psql "$DATABASE_URL" -f supabase/migrations/0002_claim_any_project.sql
# … sampai 0007_standards_mode.sql

# 2. Lalu dukungan login web — dari repo ini
psql "$DATABASE_URL" -f supabase/migrations/0008_web_auth.sql
```

Pada project yang sudah berjalan (kasus saat ini), cukup jalankan `0008_web_auth.sql`.

## Memberi akses proyek ke user web

User baru sengaja dibuat **tanpa akses proyek apa pun** — halaman mana pun akan kosong sampai admin memberi izin. Itu memenuhi aturan "user bisa mengakses revitnya sendiri atas perizinan admin", dan juga menampung "user yang hanya bisa akses tapi tidak punya Revit" (cukup jangan diberi baris di sini).

```sql
insert into user_project_access (user_id, project_id, role)
values (
  (select id from users where auth_provider = 'web' and full_name = 'Nama User'),
  (select id from projects where code = 'KODE_PROYEK'),
  'editor'   -- viewer | editor | admin
);
```

Peran mengikuti tabel di `docs/COMMANDS.md` repo `electrical_ai`: `viewer` hanya baca (query, export, print_pdf, list_sheets), `editor` boleh menjalankan command perangkat, `admin` boleh mengelola user.
