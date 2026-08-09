-- ============================================================
-- Electrical AI Platform — initial schema
-- ============================================================

create extension if not exists "pgcrypto";

-- profil user, extend dari auth.users
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text check (role in ('admin','user_revit','viewer')) default 'viewer',
  locale text default 'id',
  theme text default 'light',
  created_at timestamptz default now()
);

-- trigger: otomatis buat row profiles saat ada user baru daftar
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, new.raw_user_meta_data->>'full_name', 'viewer');
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- satu row = satu instalasi add-in Revit (dipasangkan via pairing code)
create table if not exists revit_devices (
  id uuid primary key default gen_random_uuid(),
  owner_admin uuid references profiles(id),
  device_name text not null,
  pairing_code text unique not null,
  is_paired boolean default false,
  last_seen_at timestamptz,
  created_at timestamptz default now()
);

-- admin memberi akses device ke user tertentu
create table if not exists device_access (
  device_id uuid references revit_devices(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  granted_by uuid references profiles(id),
  granted_at timestamptz default now(),
  primary key (device_id, user_id)
);

-- command bus: website insert, add-in polling & update status
create table if not exists commands (
  id uuid primary key default gen_random_uuid(),
  device_id uuid references revit_devices(id) on delete cascade,
  requested_by uuid references profiles(id),
  type text check (type in ('electrical','export_pdf','export_dwg','import_pdf','import_excel','export_excel','get_sheets')) not null,
  payload jsonb default '{}'::jsonb,
  status text check (status in ('pending','in_progress','done','failed')) default 'pending',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists command_results (
  id uuid primary key default gen_random_uuid(),
  command_id uuid unique references commands(id) on delete cascade,
  result jsonb,
  file_url text,
  finished_at timestamptz default now()
);

-- riwayat chat mode Standard (murni Q&A, tidak pernah menyentuh Revit)
create table if not exists chat_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  role text check (role in ('user','assistant')) not null,
  content text not null,
  created_at timestamptz default now()
);

-- file hasil export (pdf/dwg/xlsx) yang sudah diupload ke Cloudinary
create table if not exists files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  device_id uuid references revit_devices(id),
  command_id uuid references commands(id),
  kind text check (kind in ('pdf','dwg','xlsx')) not null,
  file_name text,
  cloudinary_url text not null,
  created_at timestamptz default now()
);

-- ============================================================
-- Row Level Security
-- ============================================================

alter table profiles enable row level security;
alter table revit_devices enable row level security;
alter table device_access enable row level security;
alter table commands enable row level security;
alter table command_results enable row level security;
alter table chat_logs enable row level security;
alter table files enable row level security;

-- profiles: user lihat & update profil sendiri, admin lihat semua
create policy "profiles_select_own_or_admin" on profiles for select
  using (id = auth.uid() or (select role from profiles where id = auth.uid()) = 'admin');
create policy "profiles_update_own" on profiles for update
  using (id = auth.uid());

-- revit_devices: admin full access, user_revit hanya lihat device yg dia punya akses
create policy "devices_select" on revit_devices for select
  using (
    (select role from profiles where id = auth.uid()) = 'admin'
    or id in (select device_id from device_access where user_id = auth.uid())
  );
create policy "devices_admin_write" on revit_devices for all
  using ((select role from profiles where id = auth.uid()) = 'admin');

-- device_access: admin kelola, user lihat akses miliknya sendiri
create policy "device_access_select" on device_access for select
  using (user_id = auth.uid() or (select role from profiles where id = auth.uid()) = 'admin');
create policy "device_access_admin_write" on device_access for all
  using ((select role from profiles where id = auth.uid()) = 'admin');

-- commands: user lihat command yg dia buat atau device yg dia punya akses
create policy "commands_select" on commands for select
  using (
    requested_by = auth.uid()
    or device_id in (select device_id from device_access where user_id = auth.uid())
    or (select role from profiles where id = auth.uid()) = 'admin'
  );
-- hanya admin & user_revit yang boleh insert command (viewer tidak boleh)
create policy "commands_insert" on commands for insert
  with check (
    (select role from profiles where id = auth.uid()) in ('admin','user_revit')
    and device_id in (select device_id from device_access where user_id = auth.uid())
  );
-- add-in update status pakai service_role key (bypass RLS di server), jadi tidak perlu policy update utk anon/user

-- command_results: ikut visibility commands terkait
create policy "results_select" on command_results for select
  using (
    command_id in (
      select id from commands where
        requested_by = auth.uid()
        or device_id in (select device_id from device_access where user_id = auth.uid())
    )
  );

-- chat_logs: murni privat per user
create policy "chat_logs_select_own" on chat_logs for select using (user_id = auth.uid());
create policy "chat_logs_insert_own" on chat_logs for insert with check (user_id = auth.uid());

-- files: privat per user (viewer pun boleh lihat riwayat file miliknya)
create policy "files_select_own" on files for select using (user_id = auth.uid());
