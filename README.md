# Electrical AI Platform — starter scaffold

Ini kerangka awal (bukan produk siap-pakai) untuk tiga bagian yang didiskusikan:

```
supabase/       schema database + RLS (jalankan lewat Supabase CLI atau SQL editor)
web/            Next.js 14 (App Router) — deploy ke Vercel
revit-addin/    C# add-in Revit (WPF + WebView2 + Revit API)
```

## Sebelum mulai

1. **Command electrical asli belum terpasang.** File
   `revit-addin/Revit/ElectricalCommands.cs` masih placeholder (keyword
   matching sederhana). Begitu kamu share command list / kode dari bot
   Telegram lama, bagian ini diganti supaya perilakunya sama.
2. **Endpoint AI di `web/lib/anthropic.ts`** menunjuk ke gateway pihak ketiga
   (`gateway.olagon.site`) sesuai yang kamu berikan — bukan endpoint resmi
   Anthropic. API key HARUS diisi lewat environment variable server
   (`AI_GATEWAY_API_KEY`), jangan pernah ditaruh di kode client.

## Environment variables yang dibutuhkan (`web/.env.local`)

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
AI_GATEWAY_API_KEY=
AI_GATEWAY_BASE_URL=https://gateway.olagon.site/anthropic
AI_MODEL=claude-sonnet-5
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

## Cara jalanin web app secara lokal

```bash
cd web
npm install
npm run dev
```

## Cara apply schema Supabase

Buka SQL editor di dashboard Supabase project kamu, jalankan isi
`supabase/migrations/0001_init.sql`. (Atau pakai Supabase CLI:
`supabase db push` kalau sudah link project.)

## Yang belum ada di scaffold ini (perlu ditambahkan)

- Route upload generik `web/app/api/files/upload/route.ts` (dipanggil dari
  halaman export-import untuk upload PDF import ke Cloudinary sebelum
  dikirim ke add-in).
- UI admin untuk mengubah role user (`profiles.role`) — saat ini harus
  diubah manual lewat SQL editor / dashboard Supabase.
- Icon PWA (`web/public/icons/icon-192.png`, `icon-512.png`) — taruh file
  asli di sana.
- Alur pairing device end-to-end (Edge Function yang menukar pairing code
  jadi device_id + token untuk add-in).
- Function calling / tool-use di `api/ai/electrical` supaya teks bahasa
  manusia diubah jadi payload terstruktur sebelum dikirim ke add-in, bukan
  dikirim mentah (lihat komentar TODO di file itu).

## Struktur lengkap ada di dokumen sebelumnya

`spesifikasi-electrical-ai-platform.md` (sudah dikirim di respons
sebelumnya) menjelaskan alasan arsitektur command-bus, skema DB, dan urutan
pengerjaan yang disarankan — dokumen ini scaffold kodenya.
