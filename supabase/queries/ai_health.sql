-- =============================================================================
-- Membaca `ai_events` — pertanyaan yang tabel itu ada untuk menjawabnya.
--
-- Ditempel satu per satu di SQL editor Supabase. Bukan sebuah halaman, dan itu
-- disengaja: yang membaca ini satu-dua orang, beberapa kali sebulan, biasanya
-- saat memutuskan apakah sebuah perubahan prompt memperbaiki sesuatu. Sebuah
-- dasbor untuk itu adalah kode yang harus dipelihara demi pemakaian yang jarang
-- — dan yang paling sering terjadi pada dasbor semacam itu adalah ia basi
-- diam-diam sementara SQL di sini tetap benar.
--
-- Yang TIDAK ada di tabel ini: isi pertanyaan dan isi jawaban. Jadi tidak ada
-- kueri di bawah yang bisa menunjukkan "pertanyaan mana yang gagal" — hanya
-- berapa banyak dan seberapa sering. Itu batas yang dipilih sadar (lihat kepala
-- migrasi 0011), dan konsekuensinya nyata: penyebab sebuah lonjakan tetap harus
-- dicari dari laporan orang.
-- =============================================================================


-- 1) MODEL MENULIS PERINTAH SEBAGAI TEKS
--
-- Kegagalan termahal di repo ini: chat menyatakan perintah sudah berangkat
-- sementara commands_queue kosong. `wrote_command_as_text` menyala saat
-- jawabannya menyebut sebuah perintah tanpa memanggil tool; `forced_retry`
-- menyala saat percobaan kedua dengan tool_choice diwajibkan dipakai.
--
-- Yang dicari: apakah keduanya MENURUN setelah sebuah perubahan prompt. Angka
-- mutlaknya sendiri tidak berarti banyak; yang berarti arahnya.
select
  date_trunc('week', created_at)::date          as pekan,
  count(*)                                       as giliran,
  count(*) filter (where wrote_command_as_text)  as menulis_sebagai_teks,
  count(*) filter (where forced_retry)           as dipaksa_ulang,
  round(100.0 * count(*) filter (where forced_retry) / nullif(count(*), 0), 1)
                                                 as persen_dipaksa
from ai_events
where mode = 'electrical' and created_at > now() - interval '90 days'
group by 1 order by 1 desc;


-- 2) JAWABAN YANG TERPOTONG DI BATAS TOKEN
--
-- `outcome = 'truncated'` berarti pengguna membaca "jawaban saya terpotong"
-- alih-alih jawabannya. Kalau ini muncul lagi setelah max_tokens dinaikkan ke
-- 16.000, yang perlu dinaikkan bukan batasnya lagi — yang perlu diperiksa
-- apakah ada permintaan yang memang terlalu besar untuk satu giliran.
select
  date_trunc('day', created_at)::date as hari,
  count(*)                            as terpotong,
  round(avg(output_tokens))           as rata_output_token
from ai_events
where outcome = 'truncated' and created_at > now() - interval '30 days'
group by 1 order by 1 desc;


-- 3) RANTAI BACA: BERAPA LANGKAH YANG BENAR-BENAR DIPAKAI
--
-- `step` = 0 giliran yang diketik orang, 1..4 langkah yang dibangkitkan sistem.
--
-- Yang dicari: sebaran yang menumpuk di 4. Kalau hampir semua pertanyaan
-- menyentuh batas, yang salah bukan penggunanya — batasnya terlalu rendah, atau
-- urutan pembacaan yang diwajibkan prompt terlalu bertele-tele. Keduanya bisa
-- diperbaiki; tidak satu pun bisa diperbaiki dari perasaan.
select
  step,
  count(*)                                            as giliran,
  count(*) filter (where outcome = 'command')         as memanggil_tool,
  count(*) filter (where outcome = 'reply')           as menjawab,
  round(avg(latency_ms))                              as rata_ms
from ai_events
where mode = 'electrical' and created_at > now() - interval '30 days'
group by 1 order by 1;


-- 4) SEBERAPA SERING JAWABAN STANDAR PUNYA SUMBER
--
-- Ini satu-satunya angka yang mengatakan apakah perpustakaan dokumennya perlu
-- diisi lebih banyak. `sources = 0` berarti dijawab dari pengetahuan model —
-- sah, dan disertai keterangan bahwa nomor pasalnya perlu dicek, tapi bukan yang
-- kita inginkan untuk pertanyaan yang dokumennya seharusnya ada.
select
  date_trunc('week', created_at)::date              as pekan,
  count(*)                                          as pertanyaan,
  count(*) filter (where sources > 0)               as dijawab_dari_dokumen,
  round(100.0 * count(*) filter (where sources > 0) / nullif(count(*), 0), 1)
                                                    as persen_bersumber,
  round(avg(sources) filter (where sources > 0), 1) as rata_potongan
from ai_events
where mode = 'standard' and created_at > now() - interval '90 days'
group by 1 order by 1 desc;


-- 5) JAWABAN YANG HARUS DIPERBAIKI SENDIRI
--
-- `redo` = jawaban ditulis ulang seluruhnya (penanda "[diagram]" alih-alih
-- gambar). `stray_words` = kata beraksara asing yang ditambal.
--
-- Keduanya terlihat pengguna: yang pertama sebagai jawaban yang selesai lalu
-- hilang lalu kembali, yang kedua sebagai satu kata yang tidak bisa dibaca. Yang
-- dicari: apakah keduanya mendekati nol.
select
  date_trunc('week', created_at)::date            as pekan,
  count(*)                                        as jawaban,
  count(*) filter (where redo is not null)        as ditulis_ulang,
  count(*) filter (where stray_words > 0)         as ada_kata_asing,
  sum(stray_words)                                as total_kata_asing
from ai_events
where mode = 'standard' and created_at > now() - interval '90 days'
group by 1 order by 1 desc;

-- Alasan penulisan-ulang, dikelompokkan. Isinya kalimat pendek dari redoReason.
select redo, count(*) as kali
from ai_events
where redo is not null and created_at > now() - interval '90 days'
group by 1 order by 2 desc;


-- 6) MODEL MANA YANG BENAR-BENAR MELAYANI
--
-- `claude-sonnet-5` adalah ID lengkap tanpa varian bertanggal, jadi tidak ada
-- versi yang bisa dikunci dari sisi kita. Hampir setiap aturan di kedua prompt
-- di-tuning terhadap kebiasaan satu model tertentu; kalau yang melayani
-- berganti, yang berubah bukan "kualitas bergeser sedikit" — salah satu
-- penjagaan bisa berhenti relevan.
--
-- Kueri ini yang membuat pergantian itu TERLIHAT, alih-alih datang sebagai
-- laporan pengguna. Baris yang model_served-nya berbeda dari model_requested,
-- atau tanggal pertama munculnya sebuah nilai baru, adalah yang dicari.
select
  model_requested,
  model_served,
  min(created_at)::date as pertama_terlihat,
  max(created_at)::date as terakhir_terlihat,
  count(*)              as giliran
from ai_events
where created_at > now() - interval '180 days'
group by 1, 2 order by 3 desc;


-- 7) BIAYA DAN KECEPATAN
--
-- Token per hari per mode, dan latensi yang benar-benar dirasakan. p95, bukan
-- rata-rata: yang membuat orang mengira aplikasinya menggantung adalah ekornya,
-- bukan tengahnya.
select
  date_trunc('day', created_at)::date as hari,
  mode,
  count(*)                            as giliran,
  sum(input_tokens)                   as input,
  sum(output_tokens)                  as output,
  sum(cache_read_tokens)              as dari_cache,
  round(percentile_cont(0.5) within group (order by latency_ms))  as p50_ms,
  round(percentile_cont(0.95) within group (order by latency_ms)) as p95_ms
from ai_events
where created_at > now() - interval '30 days'
group by 1, 2 order by 1 desc, 2;


-- 8) YANG GAGAL
--
-- Dipisah per kelas galat. `gateway_unreachable` yang menumpuk pada satu jam
-- tertentu adalah gangguan gateway, bukan bug di sini — dan bedanya cuma
-- kelihatan dari sebarannya di waktu.
select
  date_trunc('hour', created_at) as jam,
  error,
  count(*)                       as kali
from ai_events
where outcome = 'error' and created_at > now() - interval '7 days'
group by 1, 2 order by 1 desc;


-- 9) PEMAKAIAN PER AKUN
--
-- Untuk kuota per user, kalau batas laju per-instance di lib/rateLimit.ts nanti
-- diganti yang benar-benar global. Nama diambil dari `users`, bukan disimpan di
-- ai_events.
select
  u.full_name,
  count(*)                     as giliran,
  sum(e.input_tokens + e.output_tokens) as total_token,
  max(e.created_at)            as terakhir
from ai_events e join users u on u.id = e.user_id
where e.created_at > now() - interval '30 days'
group by 1 order by 3 desc nulls last limit 20;
