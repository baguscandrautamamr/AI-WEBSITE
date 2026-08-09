-- =============================================================================
-- 0008 — Akses lewat website
--
-- Skema inti proyek ini ada di repo `electrical_ai` (migrasi 0001..0007).
-- File ini melanjutkan urutan itu dan HARUS diterapkan ke project Supabase
-- yang sama dengan yang dipolling add-in Revit.
--
-- Tujuan: user yang login lewat website bisa ikut memakai commands_queue yang
-- sama dengan bot Telegram, tanpa mengubah add-in sama sekali.
--
-- Kenapa ini cukup kecil: `current_user_project_ids()` di 0001 sudah memakai
-- `u.id = auth.uid()`, dan policy `commands_queue_project_isolation` sudah
-- mengizinkan insert selama project_id termasuk proyek si user. Jadi begitu
-- ada baris `users` ber-id = auth.uid(), seluruh RLS yang ada langsung berlaku
-- untuk user web.
-- =============================================================================

-- 1) User web tidak punya Telegram. Kolom ini dibuat NULL-able; UNIQUE tetap
--    dipertahankan, dan Postgres mengizinkan banyak baris NULL pada kolom unik,
--    jadi user web tidak saling bentrok.
alter table users alter column telegram_user_id drop not null;

-- 2) Penanda asal akun, supaya laporan/audit bisa membedakan tanpa menebak.
alter table users add column if not exists auth_provider text
  not null default 'telegram'
  check (auth_provider in ('telegram', 'web'));

comment on column users.auth_provider is
  'telegram = dibuat lewat bot; web = dibuat lewat Supabase Auth (users.id = auth.uid())';

-- Baris lama semuanya dari Telegram; tandai eksplisit sekali saja.
update users set auth_provider = 'telegram' where telegram_user_id is not null;

-- 3) Minimal satu identitas harus ada. Tanpa ini sebuah baris bisa lolos tanpa
--    telegram_user_id maupun akun auth, dan tidak akan pernah bisa login.
alter table users drop constraint if exists users_identity_present;
alter table users add constraint users_identity_present
  check (telegram_user_id is not null or auth_provider = 'web');

-- 4) Saat seseorang mendaftar lewat Supabase Auth, buat baris `users`
--    pasangannya dengan id yang SAMA — itulah yang membuat RLS bekerja.
--    Sengaja TANPA akses proyek apa pun: user baru tidak bisa menyentuh model
--    siapa pun sampai admin memberi baris di user_project_access.
create or replace function handle_new_web_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into users (id, full_name, role, auth_provider, telegram_user_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    'viewer',
    'web',
    null
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_web_user();

-- 5) User web perlu membaca barisnya sendiri untuk tahu role & bahasa, dan
--    memperbaruinya saat mengganti tema/bahasa. Policy read sudah ada di 0001
--    (users_self_read); tinggal update.
drop policy if exists users_self_update on users;
create policy users_self_update on users
  for update using (id = auth.uid()) with check (id = auth.uid());

-- 6) Website perlu tahu proyek mana yang boleh diakses beserta perannya.
--    Tanpa policy ini tabelnya tertutup dan halaman project picker kosong.
alter table user_project_access enable row level security;

drop policy if exists upa_self_read on user_project_access;
create policy upa_self_read on user_project_access
  for select using (user_id = auth.uid());

-- 7) Website memantau hasil command lewat polling baris di commands_queue.
--    Policy project-isolation dari 0001 sudah menutup akses lintas proyek;
--    indeks ini yang membuat polling per-user murah.
create index if not exists idx_commands_queue_user_recent
  on commands_queue(user_id, queued_at desc);
