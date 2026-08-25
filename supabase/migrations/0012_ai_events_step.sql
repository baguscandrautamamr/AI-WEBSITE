-- =============================================================================
-- 0012 — Langkah ke berapa sebuah pemanggilan model
--
-- Menyusul loop baca berantai: `query` dan `inspect` sekarang dijalankan sistem
-- sendiri sebagai langkah antara, dan hasilnya dikembalikan kepada model supaya
-- ia bisa melanjutkan sampai bisa menjawab. Satu pertanyaan orang jadi beberapa
-- pemanggilan model.
--
-- Tanpa kolom ini, `ai_events` tidak bisa membedakan lima baris dari lima
-- pertanyaan dengan lima baris dari SATU pertanyaan yang memakai empat
-- pembacaan. Keduanya terlihat sama persis, dan keduanya menuntut kesimpulan
-- yang berlawanan.
--
-- Yang mau dijawab kolom ini: berapa langkah yang benar-benar dipakai sebuah
-- pertanyaan. Kalau ternyata hampir semuanya menyentuh batas empat, yang salah
-- bukan penggunanya — batasnya terlalu rendah, atau urutan pembacaan yang
-- diwajibkan prompt terlalu bertele-tele. Keduanya bisa diperbaiki; tapi tidak
-- ada yang bisa diperbaiki selama angkanya cuma bisa dikira-kira.
--
-- Ditulis sebagai migrasi tersendiri, bukan dengan menyunting 0011, supaya
-- project yang SUDAH menjalankan 0011 tetap bisa maju. `if not exists` membuat
-- keduanya aman dalam urutan apa pun.
-- =============================================================================

alter table ai_events add column if not exists step integer not null default 0;

comment on column ai_events.step is
  'Pembacaan otomatis ke berapa dalam satu pertanyaan. 0 = giliran yang '
  'benar-benar diketik orang; 1..4 = langkah yang dibangkitkan sistem setelah '
  'sebuah perintah baca selesai. Lihat MAX_AUTO_STEPS di '
  'web/app/api/ai/electrical/route.ts.';

-- "Pertanyaan mana yang memakai paling banyak langkah" ditanyakan per rentang
-- waktu, jadi indeksnya ikut waktu — bukan step sendirian, yang cuma punya lima
-- nilai dan tidak menyaring apa pun.
create index if not exists idx_ai_events_step_created on ai_events(step, created_at desc);
