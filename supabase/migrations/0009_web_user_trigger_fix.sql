-- =============================================================================
-- 0009 — Perbaikan trigger pembuat user web
--
-- Aman dijalankan berkali-kali, dan aman dijalankan meski 0008 sudah masuk.
--
-- Masalah di 0008: full_name diisi
--   coalesce(raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
-- Akun tanpa email (dibuat lewat dashboard dengan nomor telepon, atau provider
-- yang tidak menyetorkan email) membuat split_part() mengembalikan NULL,
-- coalesce ikut NULL, dan users.full_name yang `not null` menolak barisnya.
-- Karena trigger ini AFTER INSERT pada auth.users, kegagalannya membatalkan
-- seluruh pendaftaran — user tidak bisa daftar sama sekali.
--
-- Perbaikannya: sediakan lapisan cadangan yang tidak mungkin NULL.
-- =============================================================================

create or replace function handle_new_web_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  display_name text;
begin
  display_name := nullif(trim(new.raw_user_meta_data->>'full_name'), '');

  if display_name is null and new.email is not null then
    display_name := nullif(split_part(new.email, '@', 1), '');
  end if;

  if display_name is null and new.phone is not null then
    display_name := new.phone;
  end if;

  -- Lapisan terakhir: selalu ada nilai, jadi baris tidak pernah ditolak dan
  -- pendaftaran tidak pernah gagal gara-gara nama kosong.
  display_name := coalesce(display_name, 'Pengguna ' || left(new.id::text, 8));

  insert into users (id, full_name, role, auth_provider, telegram_user_id)
  values (new.id, display_name, 'viewer', 'web', null)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_web_user();

-- -----------------------------------------------------------------------------
-- Menyusulkan akun auth yang terlanjur dibuat sebelum trigger ada.
-- Tanpa ini, akun yang didaftarkan lebih dulu tidak punya baris `users`, dan
-- setiap halaman akan menolaknya karena RLS tidak menemukan proyek apa pun.
-- -----------------------------------------------------------------------------
insert into users (id, full_name, role, auth_provider, telegram_user_id)
select
  au.id,
  coalesce(
    nullif(trim(au.raw_user_meta_data->>'full_name'), ''),
    nullif(split_part(au.email, '@', 1), ''),
    au.phone,
    'Pengguna ' || left(au.id::text, 8)
  ),
  'viewer',
  'web',
  null
from auth.users au
left join users u on u.id = au.id
where u.id is null;
