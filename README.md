# Electrical AI — website

Website untuk mengendalikan add-in Revit lewat browser. Ini **bukan sistem
berdiri sendiri**: ia menumpang project Supabase, skema, dan add-in yang sudah
dipakai bot Telegram di repo
[`electrical_ai`](https://github.com/baguscandrautamamr/electrical_ai).

```
web/            Next.js 14 (App Router) — deploy ke Vercel
supabase/       migrasi tambahan untuk login web (0008, 0009)
revit-addin/    ⚠️ scaffold lama, JANGAN dipakai — lihat catatan di bawah
```

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

## Setelan project Vercel

| Setelan | Nilai | Kenapa |
|---|---|---|
| Root Directory | `web` | Aplikasi Next.js-nya di subfolder, bukan di akar repo. |
| Framework Preset | **Next.js** | Ditegakkan oleh `web/vercel.json` (`"framework": "nextjs"`). |

Framework Preset **tidak boleh** `Other`. Dengan `Other`, Vercel tidak memakai
builder Next.js: Output Directory-nya jatuh ke `public` (folder itu ada — berisi
`manifest.json`, `icons/`, dan `sw.js` yang ditulis next-pwa), sehingga yang
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

Middleware Next 14 selalu berjalan di **Edge runtime**. `next/server` menarik
`@opentelemetry/api` versi bundel Next, yang memuat baris:

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
gangguan yang membuat mock `__dirname` milik Next hilang. Belum dibuktikan
langsung, karena kegagalannya tidak muncul di build lokal.

Tugas middleware itu cuma satu: menyegarkan cookie sesi Supabase. Penggantinya
sekarang: klien browser menyegarkan sesinya sendiri selama tab terbuka, dan
`/login` menukar refresh token jadi sesi baru lalu mengembalikan orangnya ke
dashboard. Yang menegakkan akses tetap RLS dan `auth.getUser()` di layout serta
route handler — tidak ada yang berkurang.

Kalau nanti mau menghidupkannya lagi, urutan yang masuk akal: lepas `next-pwa`
(atau ganti ke `@ducanh2912/next-pwa` yang dipelihara), atau naik ke Next 15.2+
yang mengizinkan `export const runtime = "nodejs"` di middleware — lalu uji di
preview deployment, bukan di lokal, karena bug ini memang tidak muncul di lokal.

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

## ⚠️ Folder `revit-addin/` di repo ini sudah usang

Isinya scaffold C# lama yang mem-polling tabel `commands` dengan konsep
`device_id` / `pairing_code`. Tabel dan konsep itu **tidak ada** di database yang
sebenarnya, dan logika electrical-nya masih stub. Add-in yang asli dan dipakai
produksi ada di `revit-addin/RevitCommandCenter.Electrical` pada repo
`electrical_ai`. Jangan build atau pasang yang di sini — folder ini tinggal
dihapus.

## Yang belum ada

- **Import.** Add-in tidak punya perintah import apa pun, jadi tidak ada tombol
  import di UI. `/api/files/upload` (Cloudinary) sudah siap dan tervalidasi,
  tapi belum ada yang memanggilnya sampai perintah import ada di sisi add-in.
- **Tautan file hasil export.** Add-in menaruh path lokal di `result_json`
  kecuali dijalankan dengan `export_base_url`. Halaman Riwayat hanya membuat
  tautan untuk yang benar-benar berupa URL.
- **Membuat proyek dari web.** `projects` masih diisi lewat SQL editor.
- **Sinkron tema/bahasa ke `users.theme` / `users.language`** supaya sama antara
  Telegram dan web; saat ini bahasa disimpan di localStorage browser.
