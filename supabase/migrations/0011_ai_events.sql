-- =============================================================================
-- 0011 — Catatan setiap pemanggilan model bahasa
--
-- Seluruh nilai aplikasi ini ada di dua prompt panjang (`ELECTRICAL_SYSTEM_PROMPT`
-- dan `systemPrompt()` di /api/ai/standard), dan tidak ada satu pun angka soal
-- perilakunya. Yang sudah dibangun dengan susah payah adalah DETEKSI kegagalan:
--
--   mentionsCommand()  — model menulis baris perintah sebagai teks alih-alih
--                        memanggil tool. Kegagalan termahal di repo ini, karena
--                        chat menyatakan perintah sudah berangkat sementara
--                        commands_queue kosong.
--   redoReason()       — jawaban yang minta digambar tapi mengirim "[diagram]",
--                        atau kalimat yang tiba-tiba menyisipkan kata Sirilik.
--   strayWords()       — kata beraksara asing yang harus ditambal.
--
-- Ketiganya sudah menyala di tempatnya. Yang tidak ada: tempat menyimpan
-- nyalanya. Hasilnya `console.warn` yang tenggelam di log Vercel, jadi
-- pertanyaan "seberapa sering model menulis perintah sebagai teks?" tidak bisa
-- dijawab siapa pun — termasuk untuk membuktikan bahwa perbaikan berikutnya
-- memperbaiki sesuatu.
--
-- YANG TIDAK DISIMPAN DI SINI: isi pertanyaan, isi jawaban, nama ruangan, nama
-- family, argumen perintah. Itu data proyek orang, dan tabel telemetri bukan
-- tempatnya. Yang disimpan hanya bentuk kejadiannya — cukup untuk menghitung,
-- tidak cukup untuk membaca ulang percakapan siapa pun.
-- =============================================================================

create table if not exists ai_events (
  id bigserial primary key,
  created_at timestamptz not null default now(),

  -- on delete cascade: kalau akunnya dihapus, catatan telemetrinya ikut. Tidak
  -- ada gunanya menyimpan token milik user yang tidak ada lagi.
  user_id uuid not null references users(id) on delete cascade,

  mode text not null check (mode in ('electrical', 'standard')),

  -- DUA kolom model, dan bedanya justru intinya.
  --
  -- `model_requested` = isi env AI_MODEL, mis. 'claude-sonnet-5'.
  -- `model_served`    = yang benar-benar menjawab, dari `response.model`.
  --
  -- Kenapa dipisah: `claude-sonnet-5` sudah ID lengkap dan eksak — tidak ada
  -- varian bertanggal yang bisa dipakai untuk "mengunci" versi (sufiks tanggal
  -- justru ID tidak valid). Jadi satu-satunya cara mengetahui bahwa yang
  -- melayani sudah berganti adalah MENCATAT apa yang menjawab. Itu penting di
  -- sini karena setiap aturan di kedua prompt itu di-tuning terhadap kebiasaan
  -- satu model tertentu; kalau yang melayani berubah tanpa ada yang tahu, yang
  -- muncul bukan "kualitas bergeser sedikit" melainkan salah satu penjagaan
  -- berhenti relevan — dan yang memberi tahu adalah laporan pengguna.
  --
  -- Ditambah: request ini lewat gateway pihak ketiga (lihat lib/anthropic.ts),
  -- jadi model yang menjawab tidak sepenuhnya di bawah kendali repo ini.
  model_requested text,
  model_served text,

  -- 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'pause_turn' | ...
  --
  -- Dicatat karena selama ini tidak pernah DIBACA sama sekali di kode. Jawaban
  -- yang terpotong di 'max_tokens' tidak punya blok tool_use, jatuh ke cabang
  -- "model bertanya balik", dan yang sampai ke pengguna adalah pertanyaan
  -- klarifikasi untuk kalimat yang sudah jelas.
  stop_reason text,

  input_tokens integer,
  output_tokens integer,
  cache_read_tokens integer,

  latency_ms integer,

  -- Nama tool yang dipilih model, mis. 'place_lighting'. NULL = tidak memanggil
  -- tool (bertanya balik, menolak, atau mode standard yang memang tanpa tool).
  tool text,

  -- Apa yang akhirnya dikembalikan route ke browser. Bukan sama dengan
  -- stop_reason: sebuah jawaban bisa berhenti rapi di 'tool_use' lalu tetap
  -- ditahan di sini karena family-nya tidak ada di model ('choose').
  outcome text,

  -- mentionsCommand() menyala: model menulis perintah sebagai teks.
  wrote_command_as_text boolean not null default false,

  -- tool_choice:'any' dipakai sebagai percobaan kedua.
  forced_retry boolean not null default false,

  -- redoReason() menyala; isinya alasannya yang pendek, bukan jawabannya.
  redo text,

  -- Berapa kata beraksara asing yang ditambal. 0 = tidak ada.
  stray_words integer not null default 0,

  -- Galat dari gateway, kelasnya saja (mis. 'gateway_unreachable').
  error text
);

comment on table ai_events is
  'Telemetri per pemanggilan model bahasa. Tanpa isi pertanyaan/jawaban — '
  'lihat komentar di kepala migrasi 0011.';

-- Yang selalu ditanyakan: "sepekan terakhir, seberapa sering X" — jadi urutan
-- waktu menurun, per mode.
create index if not exists idx_ai_events_mode_created on ai_events(mode, created_at desc);

-- Dan "akun ini menghabiskan berapa" — untuk kuota per user nanti, kalau batas
-- laju per-instance di lib/rateLimit.ts diganti yang benar-benar global.
create index if not exists idx_ai_events_user_created on ai_events(user_id, created_at desc);

alter table ai_events enable row level security;

-- MENULIS saja, dan hanya barisnya sendiri.
--
-- Route menulis lewat klien sesi (anon key + JWT si user), bukan service role,
-- supaya route AI tidak perlu memegang kunci yang bisa membaca seluruh
-- database. Konsekuensinya jujur: sebuah `curl` dari akun yang sah bisa
-- menyisipkan baris telemetri palsu. Itu diterima — yang dijaga tabel ini
-- adalah pertanyaan operasional, bukan bukti.
drop policy if exists ai_events_insert_self on ai_events;
create policy ai_events_insert_self on ai_events
  for insert
  with check (user_id = auth.uid());

-- Sengaja TIDAK ada policy select untuk user biasa: tidak ada halaman yang
-- membacanya, dan seorang user tidak punya alasan membaca telemetri —
-- termasuk telemetrinya sendiri. Yang membaca adalah SQL editor / service role,
-- yang memang melewati RLS.
drop policy if exists ai_events_read_admin on ai_events;
create policy ai_events_read_admin on ai_events
  for select
  using (
    exists (
      select 1 from users u
      where u.id = auth.uid() and u.role = 'admin'
    )
  );
