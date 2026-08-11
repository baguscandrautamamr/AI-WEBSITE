-- =============================================================================
-- 0010 — Kelas akun
--
-- Sampai file ini ada, sistem ini punya dua konsep izin dan tidak satu pun
-- menjawab pertanyaan "halaman mana yang boleh dibuka akun ini":
--
--   user_project_access.role  — viewer/editor/admin PER PROYEK. Menjaga semua
--                               yang menyentuh Revit.
--   users.role                — viewer/editor/admin global, dipakai di satu
--                               tempat saja: admin global ikut ditambahkan ke
--                               proyek yang baru dibuat.
--
-- Halaman Standar berada di luar keduanya. `/api/ai/standard` hanya memeriksa
-- "sudah login" — tanpa project_id, tanpa peran — karena standards mode memang
-- dirancang bekerja tanpa proyek. Akibatnya akun yang belum diberi proyek apa
-- pun tetap bisa memakainya, dan tidak ada cara menyatakan sebaliknya.
--
-- Kelas akun adalah pertanyaan yang BERBEDA dari peran proyek, jadi ia kolom
-- sendiri dan bukan nilai baru pada peran yang sudah ada:
--
--   peran proyek = APA yang boleh kamu lakukan pada satu model
--   kelas akun   = HALAMAN MANA yang boleh kamu buka
--
-- Keduanya berlaku bersamaan. Akun berkelas 'full' yang di proyek A hanya
-- viewer tetap tidak boleh memasang apa pun di A.
-- =============================================================================

-- 1) Kelasnya.
--
--    'full'          — semuanya.
--    'standard_only' — hanya halaman Standar. Tidak menyentuh Revit sama sekali.
--    'no_standard'   — semuanya KECUALI halaman Standar.
alter table users add column if not exists access_class text
  not null default 'full'
  check (access_class in ('full', 'standard_only', 'no_standard'));

comment on column users.access_class is
  'Halaman mana yang boleh dibuka akun ini. Berdampingan dengan '
  'user_project_access.role, bukan menggantikannya: kelas menentukan halaman, '
  'peran menentukan apa yang boleh dilakukan di dalam sebuah proyek. '
  'Hanya admin global (users.role = ''admin'') yang boleh mengubahnya.';

-- Bawaannya 'full', dan itu bukan detail: default apa pun selain itu akan
-- MENCABUT akses dari setiap akun yang sudah ada pada detik migrasi ini
-- dijalankan. Kelas dipersempit satu per satu oleh admin, bukan sekali oleh
-- sebuah default.

-- 2) Jaring kedua di database, untuk utas percakapan Standar.
--
--    Yang menjaga sebenarnya adalah pemeriksaan di route: ia menolak SEBELUM
--    model bahasa dipanggil, sedangkan policy di sini hanya menolak saat
--    menyimpan — tagihannya sudah keluar pada titik itu. Tetap dipasang karena
--    ia berlaku untuk apa pun yang memakai anon key, termasuk kode yang belum
--    ditulis, dan karena route yang lupa memeriksa adalah kejadian yang sudah
--    pernah terjadi di repo ini.
drop policy if exists standards_threads_self on standards_threads;
create policy standards_threads_self on standards_threads
  for all
  using (
    user_id = auth.uid()
    and exists (
      select 1 from users u
      where u.id = auth.uid() and u.access_class <> 'no_standard'
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from users u
      where u.id = auth.uid() and u.access_class <> 'no_standard'
    )
  );

-- 3) Kelas dibaca pada setiap permintaan, untuk satu user.
--
--    `users` sudah punya primary key pada id, jadi pencariannya sudah murah;
--    yang belum ada adalah jalan murah untuk "siapa saja yang berkelas X",
--    yang dipakai halaman admin.
create index if not exists idx_users_access_class on users(access_class);
