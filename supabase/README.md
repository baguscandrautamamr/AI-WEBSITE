# Skema database

**Sumber kebenaran skema ada di repo [`electrical_ai`](https://github.com/baguscandrautamamr/electrical_ai)**, di `supabase/migrations/0001..0007`. Website ini memakai **project Supabase yang sama** dengan bot Telegram dan add-in Revit.

Folder ini hanya memuat migrasi yang ditambahkan oleh website, melanjutkan urutan repo tersebut:

| Migrasi | Isi |
|---|---|
| `0008_web_auth.sql` | Membuat user Supabase Auth bisa memakai `commands_queue` yang sama: `telegram_user_id` jadi nullable, trigger pembuat baris `users` dengan `id = auth.uid()`, dan policy RLS untuk user web. |
| `0009_web_user_trigger_fix.sql` | Memperbaiki trigger 0008 yang menolak akun tanpa email (pendaftaran gagal total), dan menyusulkan baris `users` untuk akun auth yang terlanjur dibuat sebelum trigger ada. |
| `0010_access_class.sql` | Kolom `users.access_class` (`full` / `standard_only` / `no_standard`): menentukan **halaman mana** yang boleh dibuka sebuah akun, berdampingan dengan peran proyek yang menentukan apa yang boleh dilakukan **di dalam** sebuah proyek. Ikut memasang policy `standards_threads_self`, karena sampai saat itu halaman Standar berada di luar kedua konsep izin yang ada. |
| `0011_ai_events.sql` | Tabel `ai_events` — satu baris per pemanggilan model bahasa. Yang disimpan hanya **bentuk** kejadiannya: mode, model yang diminta vs model yang benar-benar menjawab, jumlah token, dan penanda kegagalan yang sebelumnya cuma jadi `console.warn`. Isi pertanyaan, isi jawaban, nama ruangan, dan argumen perintah sengaja tidak ikut. |
| `0012_ai_events_step.sql` | Kolom `ai_events.step`. Tanpa ini, lima baris dari lima pertanyaan terlihat sama persis dengan lima baris dari **satu** pertanyaan yang memakai empat pembacaan berantai — dan keduanya menuntut kesimpulan yang berlawanan. |
| `0013_standard_sources.sql` | Perpustakaan dokumen untuk halaman Standar: tabel `standard_docs` dan `standard_chunks`, pencarian full-text `search_standard_chunks()`, dan kolom `ai_events.sources`. **Korpusnya kosong sampai diisi, dan itu bukan sementara** — SNI, PUIL, IEC, dan NEC berhak cipta, jadi tidak ada satu pun salinannya di repo ini. Selama kosong, halaman Standar bekerja persis seperti sebelum migrasi ini ada. |

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
psql "$DATABASE_URL" -f supabase/migrations/0009_web_user_trigger_fix.sql
psql "$DATABASE_URL" -f supabase/migrations/0010_access_class.sql
psql "$DATABASE_URL" -f supabase/migrations/0011_ai_events.sql
psql "$DATABASE_URL" -f supabase/migrations/0012_ai_events_step.sql
psql "$DATABASE_URL" -f supabase/migrations/0013_standard_sources.sql
```

Pada project yang sudah berjalan (kasus saat ini), jalankan `0008` sampai `0013` berurutan. Semuanya aman dijalankan berulang: kolom dan indeks dipasang dengan `if not exists`, dan setiap policy didahului `drop policy if exists` — jadi menjalankan ulang satu file yang sudah pernah masuk tidak menggagalkan apa pun dan tidak mengubah apa pun.

## Memberi akses proyek ke user web

User baru sengaja dibuat **tanpa akses proyek apa pun** — halaman mana pun akan kosong sampai admin memberi izin. Itu memenuhi aturan "user bisa mengakses revitnya sendiri atas perizinan admin", dan juga menampung "user yang hanya bisa akses tapi tidak punya Revit" (cukup jangan diberi baris di sini).

### Admin sistem (`users.role = 'admin'`) — hanya lewat SQL

Ada dua "admin" di sistem ini dan keduanya tidak sama:

| | disimpan di | menentukan |
|---|---|---|
| admin **proyek** | `user_project_access.role` | boleh mengelola akses **di proyek itu** |
| admin **sistem** | `users.role` | boleh **membuat proyek**, mengubah kelas akun, menghapus akun |

Admin sistem sengaja **tidak bisa diberikan lewat website** — tidak ada satu pun tombol yang menulis `users.role`. Itu yang membuat "membuat proyek" jadi pagar yang benar-benar menahan: sampai perbaikan ini, siapa pun yang mendaftar dengan email bisa membuat proyek, dan pembuat proyek langsung jadi admin di dalamnya — jadi satu akun baru bisa membuka seluruh aplikasi tanpa persetujuan siapa pun.

Admin sistem pertama ditetapkan lewat SQL editor:

```sql
-- Lihat dulu siapa yang mau dijadikan admin, supaya tidak salah baris.
select id, full_name, role, access_class, is_active from users order by created_at desc limit 20;

update users set role = 'admin' where id = 'UUID_USER';
```

Untuk memeriksa apakah masih ada sisa dari lubang lama — proyek yang dibuat sendiri oleh akun yang bukan admin sistem:

```sql
select p.code, p.name, u.full_name, u.role as global_role
from user_project_access a
join projects p on p.id = a.project_id
join users u on u.id = a.user_id
where a.role = 'admin' and u.role <> 'admin'
order by p.code;
```

Baris yang tidak seharusnya ada dicabut dengan `delete from user_project_access where user_id = '…' and project_id = '…';`, dan proyek uji coba yang ikut terbuat dihapus terpisah (`delete from projects where code = '…';`) setelah dipastikan tidak ada yang memakainya.

### Peran di sebuah proyek

Cara biasa: halaman `/admin/users` di website, oleh seseorang yang sudah berperan `admin` di proyek itu. Untuk admin pertama — saat belum ada siapa pun yang bisa membuka halaman itu — lewat SQL editor:

```sql
insert into user_project_access (user_id, project_id, role)
values (
  (select id from users where auth_provider = 'web' and full_name = 'Nama User'),
  (select id from projects where code = 'KODE_PROYEK'),
  'editor'   -- viewer | editor | admin
);
```

Peran mengikuti tabel di `docs/COMMANDS.md` repo `electrical_ai`: `viewer` hanya baca (query, export, print_pdf, list_sheets), `editor` boleh menjalankan command perangkat, `admin` boleh mengelola user.
