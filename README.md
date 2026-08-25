# Electrical AI — website

Website untuk mengendalikan add-in Revit lewat browser. Ini **bukan sistem
berdiri sendiri**: ia menumpang project Supabase, skema, dan add-in yang sudah
dipakai bot Telegram di repo
[`electrical_ai`](https://github.com/baguscandrautamamr/electrical_ai).

```
web/            Next.js 16 (App Router, React 19) — deploy ke Vercel
supabase/       migrasi tambahan untuk login web (0008, 0009)
```

Add-in Revit-nya **tidak ada di repo ini**. Yang dipakai produksi ada di
`revit-addin/RevitCommandCenter.Electrical` pada repo `electrical_ai`. (Repo ini
sempat memuat scaffold C# lama yang mem-polling tabel `commands` dengan konsep
`device_id`/`pairing_code` — tabel yang tidak pernah ada di database sebenarnya.
Sudah dihapus.)

## Cara kerjanya

Mengirim perintah ke Revit secara harfiah = INSERT satu baris di
`commands_queue`. Add-in mengambilnya lewat RPC `claim_next_command`, jadi
website tidak perlu tahu apa pun soal device, koneksi, atau alamat PC. Kolom
`chat_id` dibiarkan `null` — itulah penanda bahwa baris ini berasal dari
website, dan yang membuat hasilnya tidak dikirim ke chat Telegram siapa pun.

Katalog perintah di `web/lib/commands.ts` menyalin `docs/COMMANDS.md` di repo
`electrical_ai`. Kalau add-in menambah perintah baru, file itu yang diperbarui —
form di UI dibangun otomatis dari sana.

## Halaman

| Halaman | Isi |
|---|---|
| `/electrical` | Perintah yang mengubah model (place_*, cable tray, equip_room, modify, delete, undo). Butuh peran `editor`. |
| `/export-import` | `list_sheets`, `print_pdf`, `export`. Boleh untuk `viewer`. |
| `/standard` | Tanya jawab standar (SNI/PUIL/IEC), boleh dengan lampiran gambar. Tidak pernah menyentuh `commands_queue`. Riwayatnya di `standards_threads`, sama dengan bot Telegram. |
| `/history` | 50 perintah terakhir milik sendiri dari `commands_queue`, beserta status dan hasilnya. |
| `/admin/users` | Memberi/mencabut akses proyek (`user_project_access`). Anggota proyek boleh melihat; yang memberi hanya admin proyek. Membuat proyek hanya admin sistem. |

## Aturan yang menentukan gambarnya benar atau tidak

Empat hal di bawah bukan kenyamanan. Masing-masing pernah menghasilkan gambar
yang salah tanpa satu pun galat muncul di mana pun.

**Grid diturunkan dari jumlah** (`web/lib/grid.ts`, dipakai `buildPayload`).
"Pasang 10 lampu" tanpa grid dibaca add-in sebagai "cari grid yang cukup memuat
sepuluh", dan yang cukup memuat sepuluh adalah 4x3: dua belas titik, sepuluh
terpakai, dua lubang di deret terakhir. Sepuluh punya jawaban tepat — 5 kolom x
2 baris — jadi grid itu dihitung dan ikut dikirim. Dihitung di `buildPayload`,
bukan di form, supaya perintah yang datang dari percakapan ikut mendapatkannya.
Grid yang disebut sendiri tidak disentuh, dan grid yang TIDAK memuat jumlahnya
(10 lampu pada 3x3) ditolak dengan menyebutkan angka yang benar. Lanskap secara
bawaan; form menyediakan satu ketukan untuk membalikkannya jadi 2x5.

**Ruangan yang sudah berisi ditata ulang, bukan ditumpuki.** Sebelum sebuah
perintah `place_*` berangkat, isi ruangan dibaca dari Revit (`/query`). Kalau
sudah ada isinya, muncul satu pilihan: tata ulang (`/modify_devices`, set lama
keluar, set baru masuk), tambah di atasnya, atau batal. Tanpa ini "pasang 10
lampu" di ruangan berisi 9 armatur menghasilkan 19 armatur pada satu plafon —
dua grid dengan jarak berbeda, sirkuit ganda, schedule yang menghitung dua kali.
Jalannya satu untuk form dan untuk percakapan (`dispatch` di `CommandRunner`);
pemeriksaan yang hanya ada di salah satunya bisa dilewati dengan mengetik
kalimat. Dilewati kalau Revit tidak menjawab — pemeriksaan tambahan tidak boleh
jadi alasan perintahnya tertahan.

**Yang dikirim adalah nama family, bukan bentuk tampilan Revit.** `model_info`
melaporkan tipe sebagai `Family: Type` — "ACT_E_DOWNLIGHT 22WATT: DOWNLIGHT 22
WATT". Itu cara Revit MENAMPILKAN sebuah FamilySymbol, bukan nilai yang bisa
dicocokkan kembali: perintah dengan `fixture_type="ACT_E_DOWNLIGHT 22WATT:
DOWNLIGHT 22 WATT"` berjalan tanpa galat, melaporkan sepuluh armatur terpasang,
dan yang benar-benar terpasang adalah family bawaan add-in — RECESSED 600x600,
bukan downlight yang diminta. Kegagalan pencocokan namanya tidak diteruskan ke
mana pun; ia hanya jadi gambar yang salah. Jadi bagian sebelum titik dua yang
dikirim, dinormalkan di `buildPayload` (bukan di form) supaya perintah dari
percakapan ikut terkena, dan daftar yang masuk prompt AI juga berisi nama family
saja. Bentuk ini sama dengan contoh di katalog: `fixture_type=act_e_downlight`.

**Tebakan family diperiksa, bukan diteruskan.** "Pasang lampu downlight" tidak
menyebut family mana pun, dan model harus memilih satu — lalu tebakannya
berangkat tanpa ada yang memeriksanya. `web/lib/familyChoice.ts` mencocokkannya
dengan isi model yang sebenarnya sebelum perintahnya boleh jalan: cocok persis
(atau satu-satunya yang mendekati, "downlight" untuk satu family downlight) →
ejaannya dirapikan jadi ejaan model dan perintahnya berangkat; beberapa kandidat
atau tidak ada sama sekali → perintahnya DITAHAN dan daftarnya muncul sebagai
tombol di percakapan. Satu ketukan, bukan membuka formulir dan mengisi ulang.
Yang memilih tetap orangnya — hanya dia yang tahu family mana yang benar untuk
proyeknya — dan "biarkan add-in yang pilih" tetap ada sebagai pilihan yang
dinyatakan, bukan yang terjadi karena tidak ada yang menjawab. Di formulir,
nama yang diketik sendiri dan tidak ada di daftar model diberi peringatan dengan
alasan yang sama.

**"Semua ruangan" dikerjakan, bukan ditanyakan balik.** Add-in mengerjakan satu
ruangan per perintah — itu bentuk `place_*` sejak awal. Yang tidak perlu
dikerjakan orang adalah menyalinnya lima kali: "kasih saklar di semua ruangan"
dulu dijawab dengan daftar ruangan dan pertanyaan balik, lalu SATU perintah, dan
empat ruangan sisanya harus diminta lagi dengan kalimat yang sama. Sekarang
argumen `room` menerima `*` (semua ruangan yang dilaporkan model) dan daftar
dipisah koma; `web/lib/roomList.ts` memekarkannya jadi satu perintah per
ruangan, dikirim berurutan, berlaku untuk kedelapan perintah perangkat.

Dimekarkan di server, bukan dengan meminta model memanggil tool lima kali: model
yang diminta begitu akan memanggilnya empat kali pada percobaan yang lain, dan
tidak ada yang menyadarinya kecuali dari gambar yang kurang satu ruangan. Yang
gagal disebut namanya lalu dilewati — empat ruangan yang benar tidak batal karena
satu nama yang salah eja. Ruangan yang sudah berisi tetap memunculkan
persimpangannya, dengan dua tambahan yang hanya ada di pengiriman berkelompok:
"lewati ruangan ini" dan "pakai jawaban ini untuk ruangan berikutnya juga" —
lima ruangan yang tiga di antaranya sudah berisi berarti tiga pertanyaan identik
berturut-turut, dan tiga pertanyaan identik adalah tiga kali menekan tombol tanpa
membacanya.

**Formulir hanya terbuka kalau diminta.** Usulan dari percakapan dulu langsung
mengisi dan membuka formulir di bawahnya; percakapan itu sudah menyusun
perintahnya, jadi yang tersisa cuma satu layar penuh yang harus dilewati untuk
sampai ke hasil. Sekarang gelembungnya punya tombol "Ubah di formulir", dan
formulirnya muncul saat tombol itu — atau tombol perintah di atas — ditekan.

**Setiap perintah perangkat bisa memilih family, bukan cuma lampu dan saklar.**
Kolom "Tipe" di sebelahnya bukan penggantinya: ia daftar tertutup yang menyatakan
maksud (`double_grounded`, `dual`, `dome`) dan add-in menerjemahkannya ke family
bawaannya sendiri. Family mana yang benar untuk sebuah proyek hanya bisa
ditentukan dari isi file .rvt-nya, dan untuk enam dari delapan kategori tidak ada
cara menyatakannya sama sekali. Sekarang semuanya punya kolom `family` yang berisi
family kategori itu dari model yang terbuka. Kosong = bawaan add-in, persis
seperti sebelumnya.

**Kategori family dinyatakan, tidak diterka.** `web/lib/families.ts` mencocokkan
kunci `family_types` dengan `familyCategory` di katalog, tahan ejaan — huruf
besar-kecil, spasi, garis bawah, dan bentuk jamak diabaikan, karena add-in
menamainya menurut kategori Revit ("Lighting Fixtures") sementara form menamai
kolomnya menurut argumen perintah (`fixture_type`). Pemetaan sebelumnya adalah
"buang akhiran `_type`", yang mencari kunci `fixture` — kunci yang tidak pernah
ada, jadi dropdown-nya tidak pernah muncul sekali pun. Untuk `/modify_devices`,
daftarnya mengikuti kolom "Kategori" di sebelahnya. `fixture_type` juga tidak
lagi punya default `LED_15W`: nilai itu terisi otomatis di form dan karenanya
ikut terkirim setiap kali orang tidak menyentuh kolomnya, membawa nama family
yang tidak ada di model mana pun.

**Nama ruangan bersepasi dikutip di `command_text`.** Argumen bernama sudah
dikutip sejak awal; yang posisional tidak — dan di situlah nama ruangan berada.
`/delete_devices LOUNGE 5 what=all` terbaca sebagai ruangan "LOUNGE" dengan
sebuah "5" yang menggantung oleh parser mana pun yang memecah per spasi.
`command_json`-nya memang selalu benar, tapi teks itu yang dibaca orang di
Riwayat dan disalin ulang ke Telegram.

## Kalau chat mengaku sudah mengirim padahal tidak

Ini bentuk kegagalan yang paling mahal di mode percakapan, karena ia terlihat
persis seperti keberhasilan: gelembung berbunyi
`/place_lighting "LOUNGE 5" count=10 …` diikuti "perintah ini dikirim ke antrean
Revit", sementara `commands_queue` kosong dan Revit tidak menerima apa pun.

Sebabnya ada di riwayat. Usulan yang berangkat dicatat sebagai giliran asisten,
dan bentuk catatannya dulu adalah baris perintah telanjang plus kalimat "dikirim
ke antrean Revit" — persis rupa sebuah jawaban. Model meniru bentuk yang ia lihat
sebagai jawabannya sendiri: pada giliran berikutnya ia MENULIS baris itu sebagai
teks dan tidak memanggil tool apa pun. Memanggil tool adalah satu-satunya hal
yang benar-benar menulis baris ke antrean.

Tiga lapis penjagaannya sekarang:

1. `turnsFromChat` menandai catatan itu sebagai catatan sistem dan menyebutkan
   terus terang bahwa menulis teks tidak mengirim apa pun (`web/lib/chatHistory.ts`).
2. `/api/ai/electrical` mendeteksi jawaban yang menyebut perintah dari katalog
   tanpa memanggil tool, lalu mencoba **sekali lagi dengan `tool_choice: any`**.
   Kalau tetap tidak ada tool, jawabannya dikembalikan dengan tanda `nothingSent`
   dan panel chat mengatakan tidak ada perintah yang dikirim.
3. Gelembung usulan hanya berbunyi "sudah dikirim" setelah baris antreannya
   benar-benar ada, dan berubah jadi galat kalau penulisannya gagal.

Kalau baris antreannya ADA tapi Revit tetap tidak mengerjakannya, yang salah
bukan website: baris hasil menyebutkan kapan add-in terakhir menyelesaikan
sesuatu di proyek ini (dari `/api/commands/active`), dan "belum pernah" di situ
berarti add-in tidak sedang mengambil dari proyek yang dipilih di halaman ini —
Revit tertutup, add-in belum terpasang, atau kode proyeknya berbeda. Perintah
yang masih `pending` bisa dibatalkan dari situ (`PATCH /api/commands?id=…`, hanya
milik sendiri dan hanya yang belum diambil), supaya ia tidak berjalan sejam
kemudian ke model yang sudah berubah.

## Batas dan penjagaan

Setiap route yang bisa menyentuh sebuah proyek memeriksa peran pemanggil di
proyek itu lewat `roleForProject()` (`web/lib/access.ts`) — termasuk
`/api/files/upload`, yang dulu hanya memeriksa "sudah login" dan karenanya
menerima unggahan dari akun yang belum diberi proyek apa pun.

Batas laju per user ada di `web/lib/rateLimit.ts`: 30 giliran chat/menit, 20
pertanyaan standar/menit, 10 unggahan/jam. Hitungannya di memori proses, jadi
**per instance serverless, bukan global** — cukup untuk memotong penyalahgunaan
berulang dari satu akun, tidak cukup sebagai kuota yang tegas. Kalau nanti butuh
yang benar-benar global, tempatnya di Postgres atau Upstash.

Halaman `/admin/users` mencari orang dengan mengetik namanya. Sebelumnya
`/api/admin/access` mengirimkan seluruh tabel `users` ke setiap admin proyek;
sekarang yang keluar hanya anggota proyek si admin, plus hasil pencarian yang
dibatasi 20 baris dan minimal 2 huruf.

Daftar akun orang lain — hasil pencarian dan daftar "menunggu akses" — hanya
dikirim kepada orang yang memang akan menambahkan seseorang: admin di setidaknya
satu proyek, atau admin sistem. Sebelum itu penjaganya cuma menuntut "sudah
login", jadi akun yang belum diberi apa pun bisa membaca 50 pendaftar terakhir
beserta id, nama, dan kelasnya — halamannya memang tidak menampilkan tombol,
tapi yang bocor adalah jawaban JSON-nya, dan itu terbaca dengan satu `curl`.

## Environment variables (`web/.env.local`)

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
# Wajib: dipakai /api/admin/access untuk membaca daftar user dan menulis
# user_project_access. Tanpa ini halaman admin tidak jalan.
SUPABASE_SERVICE_ROLE_KEY=

AI_GATEWAY_API_KEY=
AI_GATEWAY_BASE_URL=https://gateway.olagon.site/anthropic
AI_MODEL=claude-sonnet-5

# Hanya dipakai /api/files/upload (belum ada halaman yang memanggilnya —
# lihat "Yang belum ada").
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

`AI_GATEWAY_BASE_URL` menunjuk gateway pihak ketiga, bukan endpoint resmi
Anthropic. Pastikan kamu percaya operatornya sebelum mengirim data proyek lewat
sana. API key hanya boleh dibaca di server, tidak pernah di browser.

## Jalanin lokal

```bash
cd web
npm install
npm run dev
```

Pemeriksaan yang sama dengan CI (`.github/workflows/ci.yml`, jalan di semua
branch):

```bash
npm run lint       # eslint — flat config di eslint.config.mjs
npm test           # vitest — validasi command & penyusunan riwayat chat
npm run typecheck  # tsc --noEmit
npm run build
```

## PWA

`public/manifest.json` + `public/sw.js`, keduanya ditulis tangan dan
didaftarkan oleh `app/ServiceWorker.tsx` — hanya di produksi, karena service
worker di `next dev` menyimpan aset yang berubah setiap detik.

Ikonnya dihasilkan tanpa dependensi apa pun (zlib + struct saja); lihat riwayat
commit untuk skripnya. Kilatnya menempati sekitar 52% sisi ubin, bukan hampir
seluruhnya seperti sebelumnya — ikon tanpa ruang kosong terlihat seperti satu
blok biru di pratinjau tautan dan di daftar aplikasi. Ada satu berkas `maskable`
tersendiri karena Android memotong ikonnya jadi bentuk apa pun: latarnya penuh
sampai tepi dan kilatnya dijaga di dalam zona aman. Di dalam halaman, tandanya
bukan PNG melainkan `app/BrandMark.tsx` — SVG sebaris, tajam pada ukuran berapa
pun, tanpa permintaan jaringan.

Dulu ini dihasilkan `next-pwa`. Paket itu sudah dilepas: ia berhenti dipelihara
sebelum App Router ada, mengikat repo ke webpack (Next 16 mem-build dengan
Turbopack), dan merupakan tersangka utama crash middleware di bawah. Yang
dibutuhkan aplikasi ini — bisa dipasang di layar utama HP, aset statis tidak
diunduh ulang terus — muat dalam satu file tanpa dependensi build.

`sw.js` **tidak pernah** menyimpan `/api/`: di situlah status perintah dipolling,
dan jawaban "pending" yang ter-cache berarti halaman menunggu selamanya sesuatu
yang sebenarnya sudah selesai.

## Setelan project Vercel

| Setelan | Nilai | Kenapa |
|---|---|---|
| Root Directory | `web` | Aplikasi Next.js-nya di subfolder, bukan di akar repo. |
| Framework Preset | **Next.js** | Ditegakkan oleh `web/vercel.json` (`"framework": "nextjs"`). |

Framework Preset **tidak boleh** `Other`. Dengan `Other`, Vercel tidak memakai
builder Next.js: Output Directory-nya jatuh ke `public` (folder itu ada — berisi
`manifest.json`, `icons/`, dan `sw.js`), sehingga yang
diterbitkan hanyalah isi `web/public` sebagai situs statis. `next build` tetap
jalan dan "sukses", tapi seluruh `.next` dibuang, tidak ada route yang disajikan,
dan setiap URL membalas `404: NOT_FOUND`.

`web/vercel.json` ada supaya setelan ini ikut di repo dan tidak bisa bergeser
lagi lewat dashboard — setelan di `vercel.json` mengalahkan setelan project.
Jangan menambahkan `outputDirectory` di situ: untuk Next.js, builder-nya yang
menentukan, dan menyetelnya ke `public` persis yang menyebabkan 404 di atas.
(Repo `electrical_ai` memang memakai `"outputDirectory": "public"` — itu benar
di sana, karena isinya static + serverless `api/`, bukan Next.js.)

## Kenapa tidak ada `middleware.ts`

Sengaja dihapus, dan jangan ditambahkan lagi tanpa membaca ini.

Riwayatnya begini. Pada Next 14, middleware selalu berjalan di **Edge runtime**.
`next/server` menarik `@opentelemetry/api` versi bundel Next, yang memuat baris:

```js
if (typeof __nccwpck_require__ !== "undefined") __nccwpck_require__.ab = __dirname + "/";
```

Build lokal mengganti `__dirname` dengan `"/"`. Build di Vercel tidak, sehingga
`__dirname` — yang tidak ada di Edge runtime — tetap hidup di bundle dan melempar
`ReferenceError` **saat modul dimuat**, sebelum fungsi middleware-nya sendiri
dijalankan. Akibatnya setiap URL membalas 500 `MIDDLEWARE_INVOCATION_FAILED`,
termasuk `/login`. Karena kegagalannya di tahap pemuatan modul, tidak ada
try/catch di dalam middleware yang bisa menolong.

Tersangka utamanya `next-pwa@5.6.0` (sudah tidak dipelihara, terbit sebelum
App Router): ia mengubah `config.entry` dan menyuntikkan plugin dari **salinan
webpack-nya sendiri** ke setiap compiler, termasuk compiler edge — persis jenis
gangguan yang membuat mock `__dirname` milik Next hilang. Belum pernah dibuktikan
langsung, karena kegagalannya tidak muncul di build lokal.

Tugas middleware itu cuma satu: menyegarkan cookie sesi Supabase. Penggantinya
sekarang: klien browser menyegarkan sesinya sendiri selama tab terbuka, dan
`/login` menukar refresh token jadi sesi baru lalu mengembalikan orangnya ke
dashboard. Yang menegakkan akses tetap RLS dan `auth.getUser()` di layout serta
route handler — tidak ada yang berkurang.

**Kedua penghalangnya sekarang sudah hilang**, jadi menghidupkannya kembali
bukan lagi hal yang mustahil: `next-pwa` sudah dilepas (diganti `public/sw.js`
tulis tangan, yang tidak menyentuh proses build), dan repo ini sudah di Next 16,
yang mengizinkan `export const runtime = "nodejs"` di middleware. Kalau mau
dicoba: tambahkan middleware-nya di satu PR tersendiri dan **uji di preview
deployment, bukan di lokal** — bug lamanya memang tidak pernah muncul di lokal.

## Kalau situsnya 500 / `MIDDLEWARE_INVOCATION_FAILED`

Buka **`/api/health`** di domain yang bermasalah. Route itu tidak butuh login dan
tidak menampilkan nilai rahasia — hanya ada/tidaknya tiap variabel, apakah URL
Supabase bisa di-parse, dan apakah host-nya menjawab:

```json
{ "ok": false,
  "env": { "NEXT_PUBLIC_SUPABASE_URL": true, "NEXT_PUBLIC_SUPABASE_ANON_KEY": true, … },
  "supabase": { "host": null, "urlValid": false, "reachable": null } }
```

`urlValid: false` padahal variabelnya ada = nilainya salah format. Yang paling
sering: nama variabelnya ikut ke-paste ke kolom value
(`NEXT_PUBLIC_SUPABASE_URL=https://…`), ada spasi/baris baru di ujung, atau
`https://` hilang.

**Env var dibaca saat build, bukan saat request.** Menambah atau memperbaikinya
di dashboard Vercel tidak berpengaruh apa-apa sampai deploy diulang. Pastikan
juga variabelnya dicentang untuk environment yang benar (Production, bukan cuma
Preview).

## Skema database

Lihat `supabase/README.md`. Ringkasnya: skema inti (0001–0007) ada di repo
`electrical_ai`; repo ini hanya menambah `0008_web_auth.sql` dan
`0009_web_user_trigger_fix.sql` untuk login web, `0010_access_class.sql` untuk
kelas akun, serta `0011_ai_events.sql` dan `0012_ai_events_step.sql` untuk
telemetri model bahasa.

Akun yang baru mendaftar **sengaja tidak punya akses proyek apa pun** sampai
seorang admin memberikannya lewat `/admin/users`.

**Dua "admin", dan bedanya menentukan keamanan seluruh sistem.** Admin *proyek*
(`user_project_access.role`) mengelola akses di satu proyek; admin *sistem*
(`users.role = 'admin'`) boleh membuat proyek, mengubah kelas akun, dan
menghapus akun. `users.role` tidak bisa diubah dari website mana pun — hanya
lewat SQL editor, langkahnya di `supabase/README.md`.

Membuat proyek dulu terbuka untuk setiap akun yang login, dan pembuatnya
langsung ditulis sebagai admin proyek itu. Akibatnya berantai: daftar email →
login → buat proyek → admin proyek → `granted` → seluruh aplikasi terbuka, tanpa
persetujuan siapa pun. Sekarang `/api/projects` menuntut admin sistem.

## Rantai baca: satu pertanyaan, beberapa pembacaan

Prompt-nya sendiri mewajibkan sebuah urutan untuk pertanyaan tentang isi model:
`what=categories` untuk tahu kategori apa yang ada, lalu `what=parameters` untuk
tahu nama parameternya **persis**, baru `what=elements`. Alasannya nyata — nama
parameter yang salah mengembalikan kolom KOSONG, dan kosong tidak bisa dibedakan
dari model yang memang tidak punya nilainya.

Yang mengerjakan urutan itu dulu **penggunanya**. Satu pemanggilan model = satu
perintah, dan hasil perintah itu tidak pernah kembali ke model, jadi "berapa
downlight 22W di lantai 1" berarti tiga kali mengetik, tiga kali menunggu Revit,
dan di antaranya ia sendiri yang menyalin nama parameter dari layar ke kalimat
berikutnya.

Sekarang sistem yang menjalankannya. Perintah **baca** dijalankan, ditunggu, dan
hasilnya dikembalikan kepada model sebagai catatan sistem — sampai ia bisa
menjawab, atau sampai batas empat pembacaan.

**Perintah yang mengubah model tidak pernah masuk rantai ini.** Ia diusulkan
sekali, berhenti di situ, dan hasilnya tidak dikembalikan kepada model untuk
dilanjutkan. Yang memutuskan perintah mana yang boleh berjalan sendiri adalah
`canAutoRun()` di `web/lib/commands.ts`, dan syaratnya diturunkan dari katalog,
bukan dari daftar nama: `group === "read"` **dan** `role === "viewer"` **dan**
tanpa `confirm` **dan** tidak `hidden`. Hari ini itu tepat dua perintah — `query`
dan `inspect` — dan `web/lib/commands.test.ts` menuliskan daftar itu harfiah,
supaya perintah baru yang salah dikelompokkan ke `read` menggagalkan CI alih-alih
mulai berjalan sendiri di model orang.

`list_sheets` sengaja tidak ikut walaupun ia membaca: ia berkelompok `export`, dan
mengikutkannya berarti menambahkan pengecualian bernama ke fungsi yang seluruh
gunanya justru tidak punya daftar nama. `print_pdf`, `export_cad`, dan `export`
juga tidak — ketiganya menulis berkas ke disk PC Revit, dan berkas yang tertimpa
tidak kembali.

### Yang dikembalikan ke model bukan ringkasannya

Ini yang menentukan rantainya berguna atau sia-sia. `summarizeResult` menjawab
`inspect what=parameters` dengan **"12 parameter"** — benar, cukup sebagai judul
gelembung, dan tidak mungkin dipakai memutuskan langkah berikutnya, karena yang
dibutuhkan langkah berikutnya justru nama kedua belas parameter itu.

Jadi ada `digestResult()` (`web/lib/resultDigest.ts`): isi hasilnya, dirapikan
untuk dibaca model. Skalar lebih dulu — `total`, `shown`, `room`, `family_used` —
lalu daftarnya, dibatasi 40 butir dan 3.000 karakter. Kalau pemotongan harus
terjadi, yang hilang baris ke-38 sebuah daftar, bukan angka yang ditanyakan
orangnya. Dan setiap pemotongan **dikatakan**: daftar yang dipendekkan menyebut
jumlah sebenarnya, karena 40 yang dibaca sebagai seluruhnya adalah kesimpulan
salah tanpa satu pun tanda.

Fungsi itu sengaja tidak tahu bentuk keluaran satu pun perintah. Aturannya umum,
dan itu pilihan yang diambil setelah melihat apa yang sudah dua kali menyakiti
repo ini: setiap tempat yang menyalin bentuk keluaran add-in akan berbeda dari
add-in pada perubahan pertama.

Digest hanya ikut untuk langkah yang sedang berjalan. Riwayat yang disusun ulang
dari layar pada giliran-giliran berikutnya membawa ringkasannya saja — isi lengkap
setiap pembacaan yang pernah terjadi adalah biaya input yang dibayar berulang
untuk data yang sudah selesai dipakai.

### Batasnya, dan di mana ia ditegakkan

Empat pembacaan per pertanyaan (`MAX_AUTO_STEPS`), ditulis di **dua** tempat dan
keduanya perlu: `web/app/api/ai/electrical/route.ts` yang menegakkannya — langkah
kelima ditolak dengan 400 — dan `CommandRunner.tsx` yang berhenti dengan sopan
sebelum sampai ke situ. Client yang melingkar, jadi client yang menghitung; tapi
hitungan client bukan batas, ia hanya niat baik sebuah program yang bisa punya
bug. Batas laju 30 giliran/menit menahan lajunya dan tidak pernah menghentikan
apa pun — 30 per menit selamanya tetap selamanya.

Rantainya juga berhenti, tanpa mengirim ulang apa pun, ketika: pembacaannya
**gagal** di Revit (mengirim ulang otomatis dengan argumen yang ditebak adalah
cara membakar antrean Revit tanpa ada yang meminta), Revit **tidak menjawab**
dalam 90 detik, atau orangnya menekan **Berhenti** — tombol yang menggantikan
tombol kirim selama rantai berjalan, karena sebelumnya satu-satunya jalan keluar
dari penantian beberapa menit adalah memuat ulang halaman, yang juga membuang
seluruh percakapannya.

Panel chat menampilkan **langkah keberapa dari berapa**, bukan satu kalimat yang
tidak berubah: "Menyusun perintah…" yang diam selama tiga menit berbunyi sama
persis dengan halaman yang menggantung.

## Telemetri model bahasa (`ai_events`)

Tabel dari `0011_ai_events.sql`. Satu baris per pemanggilan model, dan alasannya
bukan "biar ada dasbor": deteksi kegagalannya sudah lengkap dan tidak ada yang
menghitungnya.

`mentionsCommand()` menyala ketika model menulis baris perintah sebagai teks
alih-alih memanggil tool — kegagalan termahal di repo ini, karena chat berbunyi
seperti perintahnya sudah berangkat sementara `commands_queue` kosong.
`redoReason()` menyala ketika yang diminta gambar dan yang datang tulisan
`[diagram]`. `strayWords()` menyala ketika ada kata beraksara asing yang harus
ditambal. Ketiganya sudah berjalan sejak lama; yang dihasilkan nyalanya cuma
`console.warn` yang tenggelam di log Vercel. Jadi "seberapa sering model menulis
perintah sebagai teks?" tidak bisa dijawab siapa pun — termasuk untuk
membuktikan bahwa perbaikan berikutnya memperbaiki sesuatu.

Dua kolom model, dan bedanya justru intinya. `model_requested` adalah isi env
`AI_MODEL`; `model_served` adalah yang benar-benar menjawab, dari `response.model`.
Dipisah karena **`claude-sonnet-5` sudah ID yang lengkap dan eksak** — tidak ada
varian bertanggal untuk "mengunci" versinya, dan sufiks tanggal seperti
`claude-sonnet-5-20251114` adalah ID yang tidak ada, bukan versi yang terkunci.
Karena hampir setiap aturan di kedua prompt panjang itu di-tuning terhadap
kebiasaan satu model tertentu, penjagaannya jadi pengamatan, bukan pinning:
pergantian model terlihat di kolom itu, bukan di laporan pengguna.

Kolom `step` (migrasi `0012`) membedakan lima baris dari lima pertanyaan dengan
lima baris dari SATU pertanyaan yang memakai empat pembacaan. Tanpa itu keduanya
terlihat sama persis dan menuntut kesimpulan yang berlawanan. Yang mau dijawabnya:
kalau hampir semua pertanyaan menyentuh batas empat, yang salah bukan
penggunanya — batasnya terlalu rendah, atau urutan pembacaan yang diwajibkan
prompt terlalu bertele-tele.

**Yang TIDAK disimpan:** isi pertanyaan, isi jawaban, argumen perintah, nama
ruangan, nama family. Itu data proyek orang, dan tabel telemetri bukan tempatnya.
Yang tersimpan hanya bentuk kejadiannya — cukup untuk menghitung, tidak cukup
untuk membaca ulang percakapan siapa pun.

Ditulis lewat klien sesi (bukan service role), dengan policy `ai_events_insert_self`
yang hanya mengizinkan menulis barisnya sendiri. Konsekuensinya jujur: sebuah
`curl` dari akun yang sah bisa menyisipkan baris palsu. Diterima — yang dijaga
tabel ini pertanyaan operasional, bukan bukti. Yang membaca: admin sistem, atau
SQL editor. Kegagalan menulisnya selalu ditelan; telemetri tidak pernah boleh
menjatuhkan permintaan yang jawabannya sudah benar.

## Kalau jawaban asisten terpotong di tengah

Pada Sonnet 5 adaptive thinking aktif secara default, dan `max_tokens` membatasi
thinking **beserta** jawabannya. `/api/ai/electrical` dulu memberi 2048 untuk
ketiganya sekaligus (thinking + teks + panggilan tool), dan yang terjadi ketika
jatahnya habis bukan sebuah galat: jawabannya berhenti sebelum blok `tool_use`
selesai ditulis, jadi tidak ada tool untuk ditemukan, dan permintaan itu jatuh ke
cabang "model bertanya balik" — sehingga yang dibaca orangnya adalah **"Bisa
diperjelas maksudnya?" untuk kalimat yang sudah jelas.** Ia lalu mengetik ulang
kalimat yang sama dan gagal dengan cara yang sama.

Sekarang batasnya 16.000 (anjuran untuk permintaan non-streaming; mode standard
yang dialirkan memakai 32.000), dan `stop_reason` **dibaca** — sebelumnya tidak
disentuh di mana pun di repo. Jawaban yang berhenti di `max_tokens` dikatakan apa
adanya, beserta satu-satunya hal yang menolong: memperkecil permintaannya.
Bedanya besar bagi orangnya, karena pertanyaan klarifikasi bisa dijawab sementara
jawaban yang terpotong tidak — mengetik ulang akan terpotong di tempat yang sama.

`max_tokens` adalah batas atas, bukan target: menaikkannya tidak menaikkan biaya
per permintaan.

## Melampirkan gambar di halaman Standar

Foto papan nama panel, gambar kerja, tangkapan layar tabel — sampai **3 gambar**
per pertanyaan (JPG, PNG, WebP, GIF). Pertanyaannya boleh kosong: gambar saja
sudah cukup untuk "ini apa?".

Dua jalan masuk: tombol 📎, atau **tempel langsung dengan Ctrl+V** — Win+Shift+S,
pilih areanya, Ctrl+V, terkirim. Penyimak tempelnya dipasang di seluruh halaman,
bukan di kolom tulis saja: di antara memilih area dan menekan Ctrl+V tidak ada
yang menyuruh orangnya mengklik kolom tulis lebih dulu. Tempelan **teks** tidak
pernah disentuh — tanpa gambar di papan klip, penyimaknya langsung keluar.

Gambarnya **dikecilkan di browser** ke sisi panjang 1600 px dan dijadikan JPEG
sebelum satu byte pun dikirim. Foto telepon 8 MB berangkat sebagai ratusan
kilobyte, dan yang paling mahal dari sebuah foto — perjalanannya lewat jaringan
telepon — tidak pernah terjadi. Batas ukurannya tetap ditegakkan ulang di server
(`web/lib/imageInput.ts`): halaman memang mengecilkan lebih dulu, tapi sebuah
`curl` bisa mengirim apa saja.

**Gambarnya tidak tersimpan di riwayat.** `standards_threads` hanya menerima
`{ role, text }` — bentuk yang dipakai bersama bot Telegram — jadi yang
tertinggal di sana keterangan `[N gambar dilampirkan]`, bukan fotonya. Di layar
gambarnya bertahan selama tab terbuka; setelah dimuat ulang yang tersisa
pertanyaan dan jawabannya. Model diberi tahu soal ini di system prompt, jadi
pertanyaan lanjutan tentang gambar yang sudah hilang dijawab dengan meminta
gambarnya dikirim ulang — bukan dengan mengarang isinya.

Gateway di `AI_GATEWAY_BASE_URL` harus meneruskan blok `image` milik Messages
API. Kalau gambar ditolak dengan 400 dari sana sementara pertanyaan teks biasa
jalan, penyebabnya gateway-nya, bukan kode ini.

## Nomor pasal dijawab dari ingatan, dan itu dikatakan

Halaman Standar menjawab SNI/PUIL/IEC/NEC **tanpa satu pun dokumen standar
dibaca** — tidak ada korpus, tidak ada pencarian, tidak ada kutipan. Jawabannya
berasal dari ingatan model.

Itu bentuk kegagalan yang paling berbahaya di aplikasi ini, dan bahayanya justru
karena ia tidak terlihat seperti kegagalan. System prompt sudah lama melarang
menebak angka di foto papan nama yang buram, dengan alasan yang tepat: angka itu
dipakai orang untuk memilih pengaman. Nomor pasal persis sama, dengan satu
bedanya yang membuatnya lebih buruk — foto yang buram *terlihat* buram,
sementara "PUIL 2011 pasal 3.24.2.1" terbaca seperti kutipan entah ia benar atau
tidak. Nomor yang keliru menyuruh orang mencari di tempat yang tidak memuat apa
pun, dan yang ia simpulkan dari situ adalah standarnya tidak mengatur hal itu.

Jadi dua hal, dan keduanya perlu ada:

- **Di prompt** — yang tidak diyakini nomornya disebut isinya saja, keraguan
  ditulis di kalimat itu sendiri (bukan sebagai catatan di akhir), tahun edisi
  tidak dikarang, dan angka tabel selalu dibawa bersama tabel asalnya beserta
  syarat pakainya. Jawaban yang memuat nomor pasal atau angka tabel ditutup satu
  kalimat bahwa keduanya perlu dicek di dokumen aslinya.
- **Di halaman** — keterangan yang sama, permanen, di bawah judul. Tidak bisa
  ditutup: peringatan yang bisa ditutup adalah peringatan yang ditutup sekali di
  hari pertama lalu tidak pernah terlihat lagi oleh orang yang sama, termasuk
  pada hari ia sedang tergesa.

Keduanya sengaja tumpang tindih. Yang di halaman menjaga orang yang sedang
membaca; yang di jawaban ikut terbawa ketika jawabannya disalin ke WhatsApp atau
ditempel ke notulen — dan pada saat itu keterangan di halaman sudah tidak ada di
mana-mana.

Ini penambalan, bukan penyelesaian. Yang menyelesaikan adalah korpus standar
sendiri (pgvector di Supabase) atau pencarian web dengan kutipan, sehingga
jawabannya bisa menunjuk sumber alih-alih meminta orang memercayainya.

## Import & file hasil export

Keduanya butuh add-in versi terbaru (branch `claude/website-files-and-import`
di repo `electrical_ai`).

**File export muncul di Riwayat** begitu add-in diberi kredensial Cloudinary di
`%APPDATA%\RevitCommandCenter\config.json`:

```json
{
  "cloudinary_cloud_name": "...",
  "cloudinary_api_key": "...",
  "cloudinary_api_secret": "...",
  "cloudinary_folder": "electrical-ai/exports"
}
```

Perintah dari website tidak punya `chat_id`, jadi tanpa ini hasil export hanya
ada di PC yang menjalankan Revit. Dengan ini, URL-nya ikut ditulis ke
`result_json` dan halaman Riwayat menampilkannya sebagai tautan unduhan.

**Import Excel** ada di halaman Export. Bentuk file-nya sama dengan yang ditulis
`/export`: kolom `Element Id` atau `Mark` menentukan elemennya, kolom lain
dianggap nama parameter. Jadi alurnya export → sunting di Excel → kirim balik.
Centang "uji coba" untuk menjalankan lalu membatalkannya, dan lihat apa yang
akan berubah sebelum benar-benar menulis ke model.

## Yang belum bisa dipastikan dari repo ini

Add-in Revit ada di repo `electrical_ai`, jadi dua hal di atas berdiri pada
kesimpulan dari bukti, bukan dari kode yang bisa dibaca di sini:

- **Bentuk nilai `fixture_type`/`family`.** Yang pasti: `Family: Type` TIDAK
  cocok — perintah dengan bentuk itu memasang family bawaan add-in. Yang
  disimpulkan: nama family saja yang cocok, mengikuti contoh di katalog
  (`fixture_type=act_e_downlight`). Cara memastikannya: satu perintah dengan
  centang "Uji coba saja", lalu lihat family apa yang dilaporkan.
- **Apakah add-in menerima `door_offset`.** Jarak saklar dari tepi daun pintu
  standarnya 300 mm dan add-in sudah memakainya sendiri; kolom ini hanya cara
  menyebut angka LAIN. Sengaja tanpa nilai default, jadi ia tidak pernah ikut
  terkirim kecuali benar-benar diisi — perintah saklar yang tidak menyentuhnya
  berjalan persis seperti sebelumnya, apa pun versi add-in-nya.
- **Apakah add-in menerima argumen `family` untuk keenam kategori baru.**
  Presedennya `place_lighting_device`, yang sudah menerimanya sejak awal, dan
  `model_info` memang melaporkan family untuk kedelapan kategori. Kalau ternyata
  belum diterima, kegagalannya kelihatan — argumen yang tidak dikenal dijawab
  add-in sebagai galat, bukan diabaikan diam-diam. Kolom yang dibiarkan kosong
  tidak mengirim apa pun, jadi perintah yang tidak menyentuhnya berjalan persis
  seperti sebelumnya.

## Import tabel: tiga tujuan, dua di antaranya cuma gambar

`import_table` punya tiga nilai `target`, dan bedanya penting:

| target | Yang jadi | Bisa difilter/diurutkan? |
|---|---|---|
| `schedule` | Drafting view berisi GAMBAR dari tabelnya | tidak |
| `legend` | Legend view berisi gambar yang sama, bisa dipakai ulang di banyak sheet | tidak |
| `schedule_view` | Schedules/Quantities yang sebenarnya | ya |

Dua yang pertama menggambar garis dan teks; isinya tidak tahu apa-apa soal model
dan tidak ikut berubah saat modelnya berubah. Yang ketiga adalah schedule
sungguhan seperti yang dibuat TableGen (DiRootsOne).

**Sisi Revit-nya ada di repo `electrical_ai`, bukan di sini.** Website hanya
menuliskan `target=schedule_view` ke antrean; yang membuat view-nya add-in. Dan
itu bukan pekerjaan yang sama dengan menggambar tabel: sebuah Schedule di Revit
MEMBACA data model — ia tidak bisa memuat sel bebas. Baris dari Excel harus
punya wujud di model lebih dulu, biasanya lewat key schedule atau elemen
pembawa parameter. Sampai add-in mendukungnya, pilihan itu dijawab galat, dan
galat yang terlihat lebih baik daripada diam-diam jatuh kembali jadi drafting
view — orang yang memilih "schedule asli" lalu menerima gambar tidak akan tahu
sampai ia mencoba memfilternya.

## Yang belum ada

- **Import selain Excel.** Yang ada baru `import_excel`. `/api/files/upload`
  sudah menerima PDF juga, tapi belum ada perintah di sisi add-in yang
  memakainya.
- **Tautan file hasil export.** Add-in menaruh path lokal di `result_json`
  kecuali dijalankan dengan `export_base_url`. Halaman Riwayat hanya membuat
  tautan untuk yang benar-benar berupa URL.
- **Membuat proyek dari web.** `projects` masih diisi lewat SQL editor.
- **Sinkron tema/bahasa ke `users.theme` / `users.language`** supaya sama antara
  Telegram dan web; saat ini bahasa disimpan di localStorage browser.
