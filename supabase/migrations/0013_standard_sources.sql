-- =============================================================================
-- 0013 — Sumber untuk halaman Standar
--
-- Sampai file ini ada, halaman Standar menjawab SNI/PUIL/IEC/NEC dari INGATAN
-- model: tidak ada korpus, tidak ada pencarian, tidak ada kutipan. Migrasi 0011
-- dan aturan prompt yang menyertainya sudah membuat keadaan itu DIKATAKAN —
-- keterangan permanen di halamannya, dan satu kalimat di setiap jawaban yang
-- menyebut nomor pasal. Itu penambalan, dan memang disebut penambalan.
--
-- Ini yang menyelesaikannya: jawaban yang menunjuk dokumen, halaman, dan pasal
-- yang benar-benar dibaca.
--
-- KENAPA BUKAN VEKTOR (dan kenapa itu bukan kekurangan)
--
-- Gateway di lib/anthropic.ts adalah proxy Anthropic, dan Messages API tidak
-- punya endpoint embeddings. Pencarian semantik berarti vendor kedua — kunci
-- baru, egress baru, biaya baru — dan itu keputusan pemilik sistem, bukan
-- keputusan sebuah migrasi.
--
-- Yang dipakai: full-text search Postgres. Untuk pertanyaan standar ini bukan
-- pilihan kedua. Kueri di halaman itu penuh hal yang harus cocok PERSIS —
-- "PUIL", "IEC 60364", "KHA", "60898", nomor pasal, nama tabel — dan justru itu
-- yang paling baik dijawab pencarian leksikal. Yang TIDAK bisa dijawabnya adalah
-- pertanyaan yang tidak memakai satu pun kata dari dokumennya ("jarak kabel ke
-- pipa air" terhadap pasal berjudul "separasi utilitas"), dan itu batas yang
-- nyata — bukan batas yang disembunyikan.
--
-- Menambahkan vektor nanti bersifat MENAMBAH: satu kolom `embedding vector(n)`
-- pada standard_chunks, satu indeks, dan satu cabang lagi di
-- search_standard_chunks. Tidak ada yang perlu dibentuk ulang, dan tidak ada
-- baris yang perlu dipindahkan.
--
-- KORPUSNYA TIDAK ADA DI REPO INI, dan tidak boleh ada. SNI, PUIL, IEC, dan NEC
-- berhak cipta; yang mengunggah salinannya bertanggung jawab atas hak yang ia
-- pegang atas salinan itu. Kolom `note` di standard_docs ada untuk itu — dari
-- mana salinan ini, dan atas dasar apa ia ada di sini.
-- =============================================================================

-- 1) Satu dokumen standar.
create table if not exists standard_docs (
  id uuid primary key default gen_random_uuid(),

  -- Nomor standarnya, sebagaimana orang menyebutnya: "PUIL 2011",
  -- "IEC 60364-4-41", "SNI 0225:2011". Ini yang muncul di kutipan.
  code text not null,
  title text not null,

  -- Edisi/tahun dipisah dari `code` karena inilah yang paling sering jadi
  -- sumber jawaban yang salah: pasal yang benar dari edisi yang bukan yang
  -- dipakai proyeknya. Dipisah supaya ia bisa disebut di setiap kutipan.
  --
  -- NOT NULL DEFAULT '' dan bukan nullable, dan itu bukan selera. Dokumen ini
  -- di-upsert pada (code, edition) saat dimuat ulang, dan ON CONFLICT menuntut
  -- constraint unik pada KOLOM-nya — sebuah indeks ekspresi
  -- `(code, coalesce(edition, ''))` tidak memenuhinya, dan yang terjadi adalah
  -- "there is no unique or exclusion constraint matching the ON CONFLICT
  -- specification" pada dokumen pertama yang diunggah. Diuji, bukan dikira.
  --
  -- Dengan '' sebagai "tanpa edisi", constraint biasa di bawah cukup, dan
  -- labelOf() di lib/standards.ts memang sudah tidak menuliskan edisi yang kosong.
  edition text not null default '',

  -- Dari mana salinan ini, dan atas dasar apa ia ada di sini. Sengaja teks
  -- bebas dan sengaja ada: sebuah korpus standar tanpa catatan asal adalah
  -- korpus yang tidak bisa diaudit, dan yang akan ditanyakan lebih dulu bukan
  -- soal teknis.
  note text,

  added_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),

  -- Satu dokumen per (kode, edisi). Constraint sungguhan, bukan indeks
  -- ekspresi: ini yang dipakai ON CONFLICT saat sebuah dokumen dimuat ulang.
  unique (code, edition)
);

-- 2) Potongan teksnya — yang benar-benar dicari dan dikutip.
create table if not exists standard_chunks (
  id bigserial primary key,
  doc_id uuid not null references standard_docs(id) on delete cascade,

  -- Urutan di dalam dokumennya. Dipakai untuk mengambil potongan sebelum dan
  -- sesudah sebuah kecocokan, dan supaya pemuatan ulang sebuah dokumen bisa
  -- mengganti isinya tanpa menebak.
  ord integer not null,

  -- Jalur judul yang berlaku di potongan ini — "3.24.2.1 Proteksi terhadap
  -- kejut listrik". Ini yang jadi nomor pasal di kutipan, jadi ia diambil dari
  -- dokumennya, bukan dari ingatan siapa pun.
  heading text,

  -- Halaman tempat potongan ini dimulai. Kosong kalau sumbernya tidak berhalaman.
  page integer,

  content text not null,

  -- `simple`, bukan `english`: teks standar di sini bercampur Indonesia dan
  -- Inggris, dan stemmer Inggris merusak keduanya sekaligus — ia memotong kata
  -- Indonesia dengan aturan yang bukan aturannya, dan ia menyatukan istilah
  -- teknis yang justru harus dibedakan. `simple` hanya menurunkan huruf besar,
  -- yang untuk "IEC 60364-4-41" dan "KHA" persis yang diinginkan.
  --
  -- Judulnya ikut diindeks: banyak pertanyaan menyebut nomor pasal, dan nomor
  -- pasal hidup di judul, bukan di kalimatnya.
  fts tsvector generated always as (
    to_tsvector('simple', coalesce(heading, '') || ' ' || content)
  ) stored,

  created_at timestamptz not null default now(),

  unique (doc_id, ord)
);

create index if not exists idx_standard_chunks_fts on standard_chunks using gin (fts);
create index if not exists idx_standard_chunks_doc on standard_chunks (doc_id, ord);

comment on table standard_chunks is
  'Potongan teks dokumen standar, untuk dicari dan dikutip halaman Standar. '
  'Lihat komentar di kepala migrasi 0013 soal hak cipta korpusnya.';

-- 3) Pencariannya, sebagai satu fungsi.
--
--    Di sini, bukan disusun supabase-js di route, karena peringkatnya punya DUA
--    tahap dan tahap keduanya justru yang menyelamatkan sebagian besar
--    pertanyaan nyata:
--
--      websearch_to_tsquery meng-AND-kan seluruh kata. "berapa KHA kabel NYY 4x25
--      di dalam conduit" menuntut kesembilan kata itu ada di satu potongan yang
--      sama, dan hampir tidak ada potongan yang memenuhinya. Hasilnya nol — dan
--      nol dari pencarian tidak bisa dibedakan dari korpus yang memang tidak
--      memuatnya.
--
--      Jadi kalau AND tidak menemukan apa pun, kueri yang sama dicoba sebagai OR
--      dan diperingkat: potongan yang memuat "KHA" dan "NYY" naik ke atas, yang
--      cuma memuat "di" tidak. Ini pelemahan yang terukur, bukan tebakan.
--
--    `security invoker`: RLS pemanggilnya yang berlaku. Akun berkelas
--    'no_standard' tidak mendapat satu baris pun dari sini, dan itu ditegakkan
--    database — bukan oleh route yang mungkin lupa memeriksa.
create or replace function search_standard_chunks(q text, want integer default 6)
returns table (
  chunk_id bigint,
  doc_code text,
  doc_title text,
  doc_edition text,
  heading text,
  page integer,
  content text,
  rank real
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  and_q tsquery;
  or_q tsquery;
begin
  -- Kueri kosong, atau yang seluruh katanya tersaring, menghasilkan tsquery
  -- kosong — yang cocok dengan NOL baris, bukan dengan semuanya.
  and_q := websearch_to_tsquery('simple', coalesce(q, ''));

  if and_q is null or and_q::text = '' then
    return;
  end if;

  return query
    select c.id, d.code, d.title, d.edition, c.heading, c.page, c.content,
           ts_rank_cd(c.fts, and_q)::real
    from standard_chunks c
    join standard_docs d on d.id = c.doc_id
    where c.fts @@ and_q
    order by ts_rank_cd(c.fts, and_q) desc, c.id
    limit want;

  if found then
    return;
  end if;

  -- Tahap dua: kata yang sama, tapi cukup sebagian yang cocok.
  or_q := replace(and_q::text, '&', '|')::tsquery;

  return query
    select c.id, d.code, d.title, d.edition, c.heading, c.page, c.content,
           ts_rank_cd(c.fts, or_q)::real
    from standard_chunks c
    join standard_docs d on d.id = c.doc_id
    where c.fts @@ or_q
    order by ts_rank_cd(c.fts, or_q) desc, c.id
    limit want;
end;
$$;

-- 4) Siapa yang boleh membaca, dan siapa yang boleh menulis.
alter table standard_docs enable row level security;
alter table standard_chunks enable row level security;

-- Membaca: siapa pun yang boleh membuka halaman Standar. Pagar yang sama dengan
-- standards_threads di migrasi 0010, dan sengaja sama — keduanya menjawab
-- pertanyaan "apakah halaman Standar ada bagi akun ini".
drop policy if exists standard_docs_read on standard_docs;
create policy standard_docs_read on standard_docs
  for select
  using (
    exists (
      select 1 from users u
      where u.id = auth.uid() and u.access_class <> 'no_standard'
    )
  );

drop policy if exists standard_chunks_read on standard_chunks;
create policy standard_chunks_read on standard_chunks
  for select
  using (
    exists (
      select 1 from users u
      where u.id = auth.uid() and u.access_class <> 'no_standard'
    )
  );

-- MENULIS: tidak ada policy sama sekali, dan itu keputusan, bukan kelupaan.
--
-- Dengan RLS aktif dan tanpa policy insert/update/delete, anon key TIDAK BISA
-- menulis apa pun ke dua tabel ini — termasuk kode yang belum ditulis. Yang
-- memasukkan dokumen adalah /api/admin/standards memakai service role, setelah
-- memeriksa `isGlobalAdmin`.
--
-- Sebuah policy "boleh menulis kalau kamu admin" akan terlihat lebih rapi dan
-- lebih buruk: ia memindahkan kunci ke sisi browser, untuk tabel yang isinya
-- dipakai sebagai SUMBER jawaban teknis. Korpus yang bisa disunting dari sisi
-- client adalah korpus yang kutipannya tidak berarti apa-apa.

-- 5) Berapa sumber yang benar-benar dipakai sebuah jawaban.
--
--    Ditaruh di migrasi ini, bukan di migrasi telemetri sendiri, karena kolom
--    ini ada SEBAB fitur ini ada — dan yang akan membacanya adalah orang yang
--    sedang menilai apakah korpusnya cukup.
--
--    Pertanyaan yang dijawabnya: berapa bagian pertanyaan yang benar-benar
--    terjawab oleh dokumen, dan berapa yang masih dijawab dari ingatan model.
--    Itu satu-satunya angka yang mengatakan apakah perpustakaannya perlu diisi
--    lebih banyak — dan tanpa kolom ini ia hanya bisa dikira-kira dari perasaan
--    orang yang paling terakhir bertanya.
--
--    0 berarti dua hal yang sengaja tidak dibedakan di sini: korpusnya belum
--    memuat jawabannya, atau pencariannya tidak menemukannya. Membedakan
--    keduanya menuntut menyimpan kuerinya, dan kueri adalah pertanyaan orang.
alter table ai_events add column if not exists sources integer not null default 0;

comment on column ai_events.sources is
  'Berapa potongan dokumen standar yang ikut dikirim sebagai SUMBER pada '
  'jawaban ini. 0 = dijawab tanpa sumber, yaitu dari pengetahuan model.';
