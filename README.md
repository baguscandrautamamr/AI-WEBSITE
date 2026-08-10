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
| `/standard` | Tanya jawab standar (SNI/PUIL/IEC). Tidak pernah menyentuh `commands_queue`. Riwayatnya di `standards_threads`, sama dengan bot Telegram. |
| `/history` | 50 perintah terakhir milik sendiri dari `commands_queue`, beserta status dan hasilnya. |
| `/admin/users` | Memberi/mencabut akses proyek (`user_project_access`). Hanya untuk admin proyek. |

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

**Nama family dipilih dari model, tidak diketik.** `model_info` mengembalikan
`family_types`; `web/lib/families.ts` mencocokkan kuncinya dengan kategori yang
disebut katalog (`familyCategory` pada field), tahan terhadap ejaan — huruf
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
`0009_web_user_trigger_fix.sql` untuk login web.

Akun yang baru mendaftar **sengaja tidak punya akses proyek apa pun** sampai
seorang admin memberikannya lewat `/admin/users`.

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
