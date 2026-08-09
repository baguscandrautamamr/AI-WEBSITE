# Electrical AI — Revit Add-in

## Setup
1. Install .NET 8 SDK.
2. Sesuaikan `HintPath` di `ElectricalAddin.csproj` dengan folder instalasi
   Revit di komputer target (default contoh: `C:\Program Files\Autodesk\Revit 2025\`).
3. Install WebView2 Runtime di komputer target (biasanya sudah ada bawaan
   Windows 10/11 modern, tapi cek dulu).
4. `dotnet restore` lalu `dotnet build -c Release`.
5. Copy `ElectricalAddin.addin` + folder `bin/Release/net8.0-windows/` ke:
   `%AppData%\Autodesk\Revit\Addins\<versi>\`
6. Set environment variable di komputer target (atau baca dari file config —
   lihat TODO di `CommandPoller.LoadOrCreateDeviceId`):
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `DEVICE_TOKEN`
   - `DEVICE_ID`

## Yang masih berupa stub / TODO
- `Revit/ElectricalCommands.cs` — logika command electrical asli (perlu
  detail dari bot Telegram sebelumnya).
- `Revit/ExportService.cs` — upload hasil export ke Cloudinary setelah
  `doc.Export(...)` (saat ini baru mengembalikan path lokal).
- `Revit/ExcelService.cs` — mapping kolom Excel ↔ parameter Revit yang
  sebenarnya.
- `Bridge/CommandPoller.cs` — alur pairing device pakai `pairing_code` dari
  admin (saat ini hanya baca dari env var).

## Catatan keamanan
Pola auth device di `Bridge/SupabaseClient.cs` saat ini masih dasar (anon key
+ token statis). Untuk produksi, pertimbangkan menerbitkan JWT khusus per
device lewat Supabase Edge Function saat proses pairing, supaya RLS bisa
memverifikasi identitas device secara kriptografis.
