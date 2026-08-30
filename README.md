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

Arah sebaliknya ada di folder `docs/` repo ini: apa yang harus dipenuhi handler
C# supaya sesuatu di sini berguna.

| Dokumen | Isinya |
|---|---|
| `docs/addin-electrical-commands.md` | Enam perintah kelistrikan — beban, panel schedule, keseimbangan fasa, tunjukkan elemen, section box, sambung sirkuit. |
| `docs/addin-dokumen-aktif-dan-batas-ruangan.md` | Dokumen yang dikerjakan disebut di setiap balikan, dan armatur yang jatuh di luar batas ruangan dibuang alih-alih dipasang. Sudah dibangun; dokumennya menyimpan alasannya. |

## Halaman

| Halaman | Isi |
|---|---|
| `/electrical` | Perintah yang mengubah model (place_*, cable tray, equip_room, modify, delete, undo). Butuh peran `editor`. |
| `/export-import` | `list_sheets`, `print_pdf`, `export`. Boleh untuk `viewer`. |
| `/standard` | Tanya jawab standar (SNI/PUIL/IEC), boleh dengan lampiran gambar. Tidak pernah menyentuh `commands_queue`. Riwayatnya di `standards_threads`, sama dengan bot Telegram. |
| `/history` | 50 perintah terakhir milik sendiri dari `commands_queue`, beserta status dan hasilnya. Tanpa `model_info`: itu dikirim halaman perintah sendiri, berkala, dan akan mendorong keluar setiap perintah yang benar-benar dikirim orangnya. |
| `/admin/users` | Memberi/mencabut akses proyek (`user_project_access`). Anggota proyek boleh melihat; yang memberi hanya admin proyek. Membuat proyek hanya admin sistem. |

## Aturan yang menentukan gambarnya benar atau tidak

Yang di bawah bukan kenyamanan. Masing-masing pernah menghasilkan gambar
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

**Modifikasi berangkat apa adanya, tanpa dibaca dulu.** `/modify_devices` dulu
ditahan sebentar: isi ruangannya ditanyakan ke Revit, dan kalau jawabannya nol
perintahnya DITUKAR jadi `place_*`. Ketiga bagian dari itu salah. Tidak perlu —
add-in menjalankan delete lalu place, dan delete pada ruangan kosong
mengembalikan "0 dihapus", bukan galat, jadi modify di ruangan kosong sudah sama
hasilnya dengan place. Berbahaya — "ganti" dan "tambah" adalah dua perintah yang
berbeda, dan satu `/query` yang melaporkan nol untuk ruangan yang sebenarnya
berisi menukar "ganti enam lampu" jadi "tambah enam lampu": dua belas armatur di
plafon yang sama, dan lampu yang diminta tidak pernah berganti. Dan lambat —
satu pembacaan adalah satu baris antrean, ditunggu sampai enam belas detik,
sebelum perintah yang diminta orangnya berangkat. Yang tahu keadaan model
sekarang adalah orang yang sedang menatap layar Revit; ia sudah melihatnya, dan
ia sudah mengetik apa yang ia mau.

**Yang salah tempat digeser, bukan dihapus lalu dipasang ulang.** Saklar yang
berdiri 3.570 mm dari pintu padahal seharusnya 300 mm cuma salah koordinat —
perangkatnya sendiri benar. Satu-satunya jalan yang ada sebelumnya,
`/modify_devices`, menghapus lalu memasang ulang: yang ikut hilang bersamanya
adalah Mark-nya, sirkuit yang sudah menyambungnya, tag yang menempel padanya,
dan setiap penyesuaian yang sudah dikerjakan orang di atasnya. `/move_devices`
menggeser elemen yang sama ke tempat yang benar, dan `directCommand` mengenali
kata kerjanya ("geser saklar 300mm dari pintu di office") jadi ia tidak menunggu
model.

Jarak yang dilaporkannya **diukur sesudahnya, bukan yang diminta**. Revit
mengekang perpindahan instance yang menempel pada muka dinding, dan kekangan itu
tidak selalu melempar — ia diam-diam menaruh elemennya di tempat lain. Balasan
yang berbunyi "300 mm" karena 300 mm yang diminta tidak membuktikan apa pun, dan
itu persis bentuk kegagalan yang perintah ini dibuat untuk memperbaiki.

**Kalimat perintah yang lugas tidak menunggu model sama sekali.** "pasang lampu
recessed di meeting 2 5x3 tinggi 3 meter" memuat setiap argumen yang
dibutuhkan — kata kerja, kategori, ruangan, family, grid, ketinggian — dan
melemparkannya ke model menambahkan satu ketergantungan yang tidak memberi
apa-apa. Ketergantungan itulah yang dilaporkan rusak: balasan teks berkali-kali
berturut-turut, tanpa satu pun perintah berangkat, bahkan setelah
`tool_choice: any` dipaksakan — dan permintaan ini lewat gateway pihak ketiga,
jadi apa yang benar-benar sampai ke model di seberang sana bukan sesuatu yang
bisa dipastikan dari sini. `web/lib/directCommand.ts` membacanya sendiri.

Yang dibacanya bukan tebakan, dan itu syarat ia boleh ada: nama ruangan dan nama
family DICARI di daftar yang dilaporkan add-in lewat `model_info` — tanpa daftar
itu ia tidak menjawab sama sekali. Ia juga menolak apa pun yang tidak ia yakini
(pertanyaan, kalimat bersyarat, negasi, dua kata kerja sekaligus, kategori yang
tidak disebut), dan yang ditolak jatuh ke model persis seperti sebelumnya. Yang
diterima tetap lewat `resolveFamilies` dan `buildPayload` — jalur validasi yang
sama dengan usulan model, tanpa satu langkah pun dilewati. Efek sampingnya:
nol panggilan API dan nol detik menunggu untuk kalimat yang paling sering
diketik.

**Jawaban yang meniru catatan sistem dibuang, bukan ditampilkan.** Bentuk
kegagalan paling mahal di sistem ini — bukan karena paling sering, tapi karena
ia satu-satunya yang berbohong dengan angka. "Pasang lampu 5x3 downlight di
meeting 1" dijawab dengan sebuah `[CATATAN SISTEM]` karangan lengkap dengan
"HASILNYA: 15 perangkat dipasang · 15 sirkuit dibuat · Beban 3300 VA", tanpa
satu pun tool dipanggil: tidak ada baris di `commands_queue`, tidak ada apa pun
di Revit, dan yang dibaca orangnya adalah laporan sukses berangka. Sebabnya ada
di bentuk riwayatnya — catatan sistem dicatat sebagai giliran ASISTEN (harus:
model yang tidak melihat perintah yang ia kirim sendiri menyimpulkan
permintaannya belum dikerjakan), dan giliran asisten adalah persis yang sedang
diminta model untuk dituliskan berikutnya. Tiga lapis sekarang: catatannya
dipendekkan dari 553 jadi 231 karakter dengan ceramahnya dipindah ke prompt
sistem SEKALI alih-alih diulang dua belas kali (~1.000 token per giliran, dan
satu pola yang jauh lebih tipis untuk ditiru); balasan yang memuat penanda
catatan memicu pengulangan dengan `tool_choice: any`; dan kalau itu pun gagal,
teksnya DIBUANG — satu baris peringatan di sebelah angka yang salah tidak
menetralkan angka yang sudah terbaca.

**Perintah dipilih dari kata kerja orangnya, bukan dari terkaan isi ruangan.**
Prompt dulu menyuruh model memakai `modify_devices` untuk ruangan yang sudah
berisi dan `place_*` untuk yang kosong — sebuah pertanyaan yang model TIDAK BISA
jawab: ia tidak melihat model Revit. Yang dilakukannya adalah mencari bukti, dan
satu-satunya bukti yang tersedia baginya adalah catatan riwayat, yang merekam
masa lalu. Di situlah "pasang lampu di MEETING 1" berubah jadi `modify_devices`
untuk ruangan yang di layar jelas kosong. Sekarang: "pasang/tambah" → `place_*`,
"ganti/modifikasi/tata ulang" → `modify_devices`, titik. Yang menjaga tebakannya
bukan model — website membaca isi ruangan sebelum mengirim dan menawarkan
penggantian kalau ternyata sudah berisi, dan `modify_devices` pada ruangan
kosong tetap benar karena add-in menghapus nol lalu memasang.

**Penolakan "sudah dikerjakan" dipaksa jadi perintah.** Riwayat memuat catatan
bahwa perintah serupa pernah berangkat, dan dari situ model menyimpulkan
pekerjaannya selesai — lalu menjawab begitu, tanpa memanggil tool apa pun.
Orangnya melihat Revit, lampunya belum berganti, ia meminta lagi, dan jawabannya
sama. Berapa kali pun. Prompt sistem sudah melarangnya, dan larangan yang lebih
dekat di konteks — dua belas catatan hasil — mengalahkan aturan yang lebih jauh;
jadi larangan itu sekarang ditegakkan di kode, bukan diharapkan dipatuhi.
`propose` mengulang panggilannya dengan `tool_choice: any` begitu balasan
menolak dengan alasan sudah dikerjakan DAN pesan terakhir orangnya memang
menyuruh menjalankan (`asksToRun` + `refusesAsAlreadyDone` di `web/lib/aiTools.ts`).
Dua syarat, dan keduanya wajib: "sudah terpasang enam armatur" adalah jawaban
yang benar untuk sebuah pertanyaan, dan memaksanya jadi perintah berarti
memasang sesuatu yang tidak diminta siapa pun.

**`fixture_type` adalah nama family, bukan tebakan.** Ini separuh di add-in.
`type=dome`, `type=smoke` adalah terkaan sistem ini tentang apa yang dinamai
sebuah kantor untuk family-nya, jadi jatuh ke family pertama di kategorinya
memang benar di situ. `fixture_type` datang dari daftar yang dilaporkan add-in
sendiri lewat `model_info` — dan untuk itu tidak ada yang namanya hampir cocok.
Selama ia diperlakukan sebagai tebakan, "modifikasi lampu downlight" yang
namanya meleset satu spasi memasang ACT_E_LIGHTING RECESSED, melaporkan sukses,
dan lampunya tidak berganti. Sekarang ia ditolak dengan menyebut family apa saja
yang ada.

**Nama file .rvt yang tampil diperiksa lagi, bukan dibaca sekali.** Berganti
file di Revit terjadi di luar website: tidak ada klik, tidak ada perintah, tidak
ada jawaban yang berubah bunyinya. Dulu `model_info` dibaca sekali per proyek
terpilih — dengan alasan yang benar, setiap pembacaan adalah satu baris antrean —
dan akibatnya panel tetap menyebut file yang lama sampai halamannya dimuat ulang,
sementara perintah berikutnya berangkat ke file yang sedang terbuka. Sekarang
dibaca lagi saat panelnya kembali terlihat atau dapat fokus, berkala satu menit
sekali selama terlihat, dan seketika saat sebuah hasil menyebut dokumen lain
(medan `document`, gratis: hasilnya sudah di tangan). Yang ikut basi bersamanya
dikosongkan di saat yang sama — daftar ruangan, daftar sheet, isi ruangan yang
sudah dihitung — dan pergantiannya dikatakan, karena dropdown yang tiba-tiba
kosong tanpa sebab terbaca sebagai kerusakan. Pemeriksaan yang tidak dijawab
TIDAK menghapus nama yang sudah benar: Revit yang sedang menghitung bukan Revit
yang tertutup, jadi yang tampil tetap nama terakhir yang dijawab, ditandai belum
dipastikan lagi. `model_info` sendiri dikeluarkan dari Riwayat dan dari daftar
"sedang berjalan" — tidak ada orang yang menjalankannya, dan lima puluh baris
riwayat yang terisi olehnya adalah riwayat tanpa satu pun perintah sungguhan.

**Armatur yang jatuh di luar batas ruangan dibuang, dan selisihnya disebut.**
Grid dibentangkan pada KOTAK ruangan; ruangan berbentuk L punya kotak yang
mencakup takik yang bukan miliknya. "Pasang 40 lampu di LOUNGE 5" pada ruangan
begitu meletakkan enam di antaranya di MEETING 2 — ikut terhitung sebagai beban
LOUNGE, dan ditumpuki lagi saat MEETING 2 sendiri dipasangi lampu. Ujinya milik
add-in — `Room.IsPointInRoom`, sudah dibangun, alasannya di
`docs/addin-dokumen-aktif-dan-batas-ruangan.md` — dan yang ada di sini adalah
pelaporannya. `devices_placed` adalah yang benar-benar berdiri di model, dan
`outside_boundary` yang dibuang, jadi ringkasannya berbunyi "34 perangkat
dipasang · ruangan LOUNGE 5 · 6 di luar batas ruangan". Tanpa medan kedua itu,
34 untuk permintaan 40 terbaca sebagai add-in yang gagal separuh jalan, dan yang
membacanya akan mengirimkan enam lagi. Nol tidak disebut, dan medan yang tidak
ada sama sekali juga tidak: add-in versi lama tidak pernah melihat batas
ruangan, dan "0 di luar batas" dari add-in yang tidak memeriksanya adalah
pernyataan yang tidak ada yang memeriksanya.

**Nama ruangan bersepasi dikutip di `command_text`.** Argumen bernama sudah
dikutip sejak awal; yang posisional tidak — dan di situlah nama ruangan berada.
`/delete_devices LOUNGE 5 what=all` terbaca sebagai ruangan "LOUNGE" dengan
sebuah "5" yang menggantung oleh parser mana pun yang memecah per spasi.
`command_json`-nya memang selalu benar, tapi teks itu yang dibaca orang di
Riwayat dan disalin ulang ke Telegram.

## Berapa lama asisten menjawab, dan apa yang memendekkannya

Yang paling besar sekarang bukan setelan model, melainkan tidak memanggilnya:
lihat "Kalimat perintah yang lugas tidak menunggu model sama sekali" di atas.

**DUA PENGUNGKIT HILANG saat pindah ke Chat Completions**, dan sebaiknya
diketahui sebelum ada yang mencari-cari kenapa jawabannya melambat:

- **Prompt caching.** `cache_control` milik Anthropic; Chat Completions tidak
  punya padanan yang bisa disetel dari sini. Katalog tool (dua puluh delapan
  tool dengan skema lengkapnya) dan seluruh aturan prompt dibayar penuh di
  setiap giliran. Urutan penyusunannya tetap dipertahankan — yang tidak berubah
  lebih dulu, daftar family dan ruangan di belakang — karena sebagian penyedia
  melakukan caching prefiks sendiri tanpa diminta, dan urutan itu yang
  membuatnya mungkin kalau memang ada. Kalau iya, angkanya masuk ke
  `cache_read_tokens` di `ai_events`; null di kolom itu sekarang berarti "tidak
  dilaporkan", bukan "tidak kena cache".
- **`effort`.** Juga milik Anthropic. Kedalaman berpikir model sekarang di luar
  kendali repo ini, jadi `AI_EFFORT` sudah tidak ada.

**Catatan riwayat dipendekkan.** 553 → 231 karakter per catatan, sampai dua
belas catatan per giliran. Lihat "Jawaban yang meniru catatan sistem" di atas —
pemendekannya bukan cuma soal biaya input, dan sejak caching hilang ia jadi
satu-satunya pengurangan token yang tersisa.

**Catatan riwayat dipendekkan.** 553 → 231 karakter per catatan, sampai dua
belas catatan per giliran. Lihat "Jawaban yang meniru catatan sistem" di atas —
pemendekannya bukan cuma soal biaya input.

**Satu pembacaan Revit yang dibuang.** Lihat "Modifikasi berangkat apa adanya"
di atas: sampai enam belas detik, di depan perintah yang paling sering diulang
justru karena hasilnya belum terlihat.

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
# WAJIB memuat `/v1` — SDK menambahkan `/chat/completions` di belakangnya.
AI_GATEWAY_BASE_URL=https://api.vikey.ai/v1
AI_MODEL=openai/gpt-5.6-luna
# Batas token jawaban. KOSONG = tidak dikirim sama sekali, dan itu bawaannya:
# penyedia yang berbeda menerima nama medan yang berbeda untuk batas ini
# (`max_tokens` vs `max_completion_tokens`), dan menebak yang salah tidak
# menghasilkan jawaban yang lebih pendek — ia menghasilkan 400 pada SETIAP
# permintaan.
AI_MAX_TOKENS=
AI_MAX_TOKENS_STANDARD=

# Hanya dipakai /api/files/upload (belum ada halaman yang memanggilnya —
# lihat "Yang belum ada").
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

`AI_GATEWAY_BASE_URL` menunjuk penyedia pihak ketiga. Pastikan kamu percaya
operatornya sebelum mengirim data proyek lewat sana. API key hanya boleh dibaca
di server, tidak pernah di browser.

**Mengganti penyedia bukan sekadar mengganti ketiga nilai itu.** Yang dipakai
sekarang Chat Completions (bentuk OpenAI, `/v1/chat/completions`); repo ini
sebelumnya memakai Anthropic Messages API (`/v1/messages`). Keduanya berbeda
seluruhnya — tool dideklarasikan sebagai `function` alih-alih `input_schema`,
argumennya kembali sebagai STRING JSON yang harus di-parse, `system` jadi sebuah
pesan alih-alih medan tersendiri, gambar jadi data URL alih-alih blok base64,
dan `finish_reason` menggantikan `stop_reason`. Mengarahkan `AI_GATEWAY_BASE_URL`
ke penyedia yang bicara protokol lain membuat SETIAP permintaan gagal, bukan
sebagian.

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
kelas akun, `0011_ai_events.sql` dan `0012_ai_events_step.sql` untuk telemetri
model bahasa, serta `0013_standard_sources.sql` untuk perpustakaan dokumen
standar.

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

## Eval: apakah perilaku modelnya masih seperti yang dirancang

Seluruh nilai aplikasi ini ada di dua prompt panjang, dan sampai sekarang tidak
ada satu pun tes yang menyentuh perilakunya. Yang diuji `npm test`: `asciiTable`,
`grid`, `families` — helper. Sementara riwayat repo ini penuh regresi perilaku:
model menulis perintah sebagai teks, `[diagram]` sebagai penanda, kata Sirilik
menyelip, `Family: Type` disalin utuh. Setiap perbaikan adalah aturan prompt
tanpa jaring.

`npm run eval` adalah jaringnya. **Bukan** bagian dari `npm test`, dan tidak jalan
di push.

### Dua perintah, dua arti

| | dijalankan | menjawab |
|---|---|---|
| `npm test` | setiap push (CI) | apakah **kodenya** benar |
| `npm run eval` | **manual saja** | apakah **perilaku modelnya** masih seperti yang dirancang |

Digabung, sifat yang paling berharga dari `npm test` hilang. Ia sekarang 371 tes
yang jalan dalam dua detik tanpa jaringan, dan merahnya **selalu** berarti ada
kode yang salah. Eval memanggil model sungguhan: berbiaya, butuh jaringan, dan
hasilnya tidak sepenuhnya sama dari satu jalannya ke jalannya berikutnya. Di
setiap PR ia akan sesekali merah tanpa sebab — dan CI yang begitu berhenti dibaca
dalam dua minggu, sesudah itu ia tidak menjaga apa pun.

### Manual saja, dan kenapa bukan berjadwal

`.github/workflows/eval.yml` hanya punya `workflow_dispatch` — Actions → **Eval**
→ Run workflow, atau `npm run eval` lokal. Tidak ada `schedule`.

Ia sempat berjadwal tiap malam, dan itu dicabut karena satu sebab yang bukan
biaya: **tanpa secret `AI_GATEWAY_API_KEY` terpasang, suite melewati dirinya
sendiri dan job-nya hijau.** Sebuah centang hijau tiap pagi yang tidak memeriksa
apa pun lebih buruk daripada tidak ada centang — ia melatih orang percaya ada
yang menjaga. Jadwal yang benar adalah jadwal yang dipasang **setelah**
secret-nya ada.

Kapan menjalankannya:

- **sebelum mengubah salah satu dari dua system prompt** — supaya kamu tahu apa
  yang berubah, bukan cuma bahwa sesuatu berubah;
- **sebelum menaikkan `AI_MODEL`** — ini sebab utama suite ini ada;
- saat sebuah laporan pengguna mengarah ke perilaku model, bukan ke kode.

Yang kedua perlu diulang: tidak ada versi model yang bisa dikunci dari sini —
yang menjawab ada di belakang gateway pihak ketiga yang katalognya bisa berubah
kapan saja — jadi pergeseran perilaku tidak akan datang bersama sebuah commit. Yang tetap memberi tahu tanpa perlu
dijalankan siapa pun: kolom `model_served` di `ai_events`, dan kueri nomor 6 di
`supabase/queries/ai_health.sql`. Eval adalah peringatan yang lebih awal;
telemetri adalah peringatan yang tidak bisa lupa dijalankan.

Menghidupkan jadwalnya kembali: kembalikan blok `schedule:` yang sudah
dituliskan sebagai komentar di workflow-nya — setelah secret-nya terpasang.

### Yang dipanggil adalah kode yang dipakai pengguna

Ini yang menentukan eval ini berarti atau tidak. Keputusan mode Electrical
dikeluarkan dari route-nya ke `web/lib/propose.ts`; yang tertinggal di route
adalah wewenang, batas laju, telemetri, dan bentuk HTTP (400 → 173 baris).
`/api/ai/electrical` dan eval memanggil **`propose()` yang sama**.

Alternatifnya dua, dan keduanya buruk. Memanggil route lewat HTTP menuntut sesi
login, baris proyek, dan Supabase yang hidup — perkakas yang lebih rapuh daripada
yang diamankannya, dan yang gagal karena hal-hal yang bukan soal kualitas
jawaban. Menyalin logikanya ke dalam eval berarti menguji implementasi paralel:
ia akan berbeda dari yang dipakai pada perubahan pertama, dan sejak saat itu
setiap "lulus" tidak berarti apa-apa. Untuk alasan yang sama, `systemPrompt` mode
Standar **diekspor** dari route-nya alih-alih disalin.

### Kasusnya

`web/evals/cases/electrical.json` — 13 kasus, masing-masing diturunkan dari satu
aturan yang benar-benar ada di `ELECTRICAL_SYSTEM_PROMPT`, hampir semuanya
ditulis karena kegagalannya pernah terjadi: `count` tanpa `grid` karangan,
`door_offset` yang tidak diisi kalau tidak disebut, "semua ruangan" yang
dimekarkan alih-alih ditanyakan balik, pertanyaan ber-nama-family yang disaring
alih-alih dijawab per kategori, nama ruangan meragukan yang **ditanyakan**,
permintaan terulang yang **dikirim lagi** alih-alih ditolak, dan hasil pembacaan
yang dipakai alih-alih dibaca ulang.

Setiap kasus punya kolom `why` yang menjelaskan kenapa ia ada — dan kolom itu
ikut dicetak saat kasusnya gagal, karena yang membaca kegagalan enam bulan dari
sekarang perlu tahu apa yang dijaga sebelum memutuskan mengubah prompt.

Menambah kasus: tulis yang paling spesifik yang bisa ditulis. Kasus yang menuntut
satu nilai argumen tertentu menangkap pergeseran; kasus yang cuma menuntut "ada
tool yang dipanggil" akan lulus selamanya dan tidak pernah memberi tahu apa pun.

`web/evals/standard.eval.ts` — enam kasus, dan yang menilai adalah **pendeteksi
yang sama** yang dipakai route: `redoReason()` untuk penanda `[diagram]`,
`strayWords()` untuk kata beraksara asing. Dipakai apa adanya, bukan ditulis
ulang: kalau ambangnya bergeser, eval ikut bergeser — kalau tidak, ia menjaga
aturan yang sudah tidak berlaku. Plus tiga yang khusus RAG: jawaban dari sumber
harus **menunjuk** `[1]`, sumber yang **tidak** memuat jawabannya tidak boleh
dikutip, dan tanpa sumber nomor pasal tidak dijual sebagai kepastian.

### Dua percobaan, gagal kalau keduanya gagal

Model bahasa tidak menghasilkan hal yang sama persis setiap kali. Percobaan kedua
hanya dijalankan kalau yang pertama gagal — jadi jalannya yang normal tetap satu
panggilan per kasus — dan kegagalan **kedua** percobaan dilaporkan bersama.
Kalau keduanya gagal dengan cara yang berbeda, itu keterangan tersendiri: bukan
satu aturan yang bergeser, melainkan model yang sedang tidak stabil di kasus itu.

### Kuncinya: env Vercel TIDAK berlaku di sini

Ini jebakan yang mudah kena, dan sekali kena akan terlihat seperti eval yang
lulus. **Env Vercel dan secret GitHub Actions adalah dua penyimpanan yang
berbeda.** `AI_GATEWAY_API_KEY` yang sudah terpasang di Vercel memberi jalan ke
aplikasinya saat berjalan — dan tidak terlihat sama sekali oleh
`.github/workflows/eval.yml`, yang membaca `${{ secrets.* }}` dari repo GitHub.

Jadi ia perlu dipasang **dua kali**, di dua tempat, untuk dua tujuan:

| Tempat | Untuk apa |
|---|---|
| Vercel → Environment Variables | aplikasinya menjawab pertanyaan pengguna |
| GitHub → Settings → Secrets and variables → **Actions** | eval nightly memeriksa perilakunya |

Yang wajib di Actions cuma `AI_GATEWAY_API_KEY`. `AI_GATEWAY_BASE_URL` dan
`AI_MODEL` hanya perlu kalau nilainya berbeda dari bawaan di `web/lib/llm.ts` —
kalau sama, biarkan kosong dan bawaannya yang dipakai.

**Menjalankan lokal:** `npm run eval` membaca `web/.env.local` (dan `.env`)
sendiri. Vitest tidak melakukannya — diuji, dan tanpa penanganan itu seluruh
suite dilewati walaupun kuncinya sudah ada di file yang dipakai `next dev`, tanpa
sebab yang kelihatan. Yang dikirim lewat perintah menang atas yang di file, jadi
satu jalannya dengan model lain tidak menuntut menyunting apa pun:

```bash
cd web
npm run eval                                  # pakai .env.local
AI_MODEL=claude-opus-5 npm run eval           # sekali jalan dengan model lain
```

### Tanpa kunci, ia melewati dirinya sendiri

`AI_GATEWAY_API_KEY` tidak ada → seluruh suite di-skip dengan peringatan, bukan
merah. Seorang kontributor tanpa kunci harus diberi tahu bahwa ia melewatinya.

**Jebakannya:** eval yang dilewati terlihat sama dengan eval yang lulus — job
GitHub Actions-nya hijau dua-duanya. Yang membedakan cuma baris peringatan di
log. Kalau secret-nya belum dipasang di Settings → Secrets and variables →
Actions, cari baris itu lebih dulu sebelum menyimpulkan perilakunya masih baik.

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
Dipisah karena **tidak ada versi yang bisa dikunci dari sini**: yang menjawab
ada di belakang gateway pihak ketiga, dan nama model yang sama bisa dilayani
build yang berbeda tanpa pemberitahuan. Karena hampir setiap aturan di kedua
prompt panjang itu di-tuning terhadap kebiasaan satu model tertentu,
penjagaannya jadi pengamatan, bukan pinning: pergantian model terlihat di kolom
itu, bukan di laporan pengguna.

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

**Membacanya:** `supabase/queries/ai_health.sql` — sembilan kueri untuk ditempel
di SQL editor, masing-masing menjawab satu pertanyaan: seberapa sering model
menulis perintah sebagai teks, berapa jawaban yang terpotong, sebaran kedalaman
rantai baca, berapa persen jawaban standar yang benar-benar bersumber, berapa
yang harus ditulis ulang, **model mana yang benar-benar melayani**, token dan
latensi p95 per hari, apa yang gagal, dan pemakaian per akun. Semuanya diuji
terhadap Postgres 16 sungguhan.

Bukan sebuah halaman, dan itu disengaja: yang membacanya satu-dua orang beberapa
kali sebulan, biasanya saat memutuskan apakah sebuah perubahan prompt memperbaiki
sesuatu. Dasbor untuk itu adalah kode yang dipelihara demi pemakaian yang jarang —
dan yang paling sering terjadi padanya adalah ia basi diam-diam sementara SQL
tetap benar.

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

## Perpustakaan dokumen standar, dan kutipan yang bisa diperiksa

Ini yang menyelesaikan bagian di bawah. Halaman Standar sekarang bisa menjawab
**dari dokumen** — dengan nomor pasal dan halaman yang diambil dari dokumennya,
bukan dari ingatan model — dan setiap kutipan bernomor `[1]`, `[2]` yang
pasangannya tampil di bawah jawaban. Yang bertanya bisa membuka dokumen aslinya
di halaman itu dan melihat sendiri.

**Korpusnya kosong sampai kamu mengisinya, dan itu bukan sementara.** SNI, PUIL,
IEC, dan NEC berhak cipta; repo ini tidak memuat satu pun dari mereka dan tidak
boleh memuatnya. Selama korpusnya kosong, halaman Standar bekerja persis seperti
sebelumnya — jawaban dari pengetahuan model, dengan keterangan bahwa nomor pasal
perlu dicek.

### Memasukkan dokumen

`POST /api/admin/standards`, **admin sistem saja**, diperiksa dengan service role.
Yang diterima teks, bukan PDF:

```bash
pdftotext -layout puil-2011.pdf puil-2011.txt   # periksa hasilnya dulu

curl -X POST https://<host>/api/ai/../api/admin/standards \
  -H 'Content-Type: application/json' \
  --cookie "$COOKIE" \
  -d "$(jq -n --rawfile text puil-2011.txt '{
        code: "PUIL 2011",
        title: "Persyaratan Umum Instalasi Listrik",
        edition: "2011",
        note: "Salinan kantor, lisensi BSN No. … — dipegang oleh …",
        text: $text }')"
```

`note` **wajib** dan tidak punya nilai bawaan: dari mana salinan ini dan atas
dasar apa ia ada di sini. Korpus standar tanpa catatan asal tidak bisa diaudit,
dan yang akan ditanyakan lebih dulu bukan soal teknis.

`pdftotext` menulis **form feed** antar halaman, dan `chunkDocument` membaca itu
sebagai nomor halaman — jadi "hal. 142" di kutipan adalah halaman 142 di PDF yang
dipegang orangnya. Sumber tanpa form feed tetap diterima; kutipannya menyebut
pasalnya saja.

PDF **tidak** diterima langsung, dan itu keputusan. Ekstraksi PDF punya dua
kegagalan yang tidak berbunyi seperti kegagalan: hasil pindaian tanpa lapisan
teks menghasilkan halaman kosong, dan ekstraksi kolom-ganda mengacak urutan
kalimat. Keduanya menghasilkan korpus yang tetap bisa dicari dan tetap bisa
dikutip — dengan kutipan yang menunjuk ke tempat yang salah. Untuk fitur yang
seluruh gunanya justru menghapus jawaban yang salah tapi terdengar yakin, itu
bukan langkah pertama yang benar. `pdftotext` di tanganmu, dengan hasilnya di
depan matamu, adalah langkah yang benar.

`GET` mendaftar isi korpus beserta jumlah potongan per dokumen;
`DELETE ?id=<uuid>` mengeluarkan sebuah dokumen (potongannya ikut lewat
`on delete cascade`). Memuat ulang dokumen yang sama (`code` + `edition` yang
sama) **mengganti** isinya: potongan lama dibuang seluruhnya lebih dulu, karena
ekstraksi yang diperbaiki menghasilkan jumlah potongan yang berbeda dan ekor
potongan lama tetap terindeks — kutipan dari versi yang sudah diganti,
berdampingan dengan yang baru, tanpa apa pun yang membedakannya.

### Kenapa full-text search, bukan vektor

Pencarian semantik butuh endpoint embeddings, dan belum tentu penyedia di
`AI_GATEWAY_BASE_URL` menyediakannya — kalau tidak, ia berarti **vendor kedua**:
kunci baru, egress baru, biaya baru. Itu keputusan pemilik sistem.

Untuk pertanyaan standar, FTS bukan pilihan kedua. Kueri di halaman itu penuh hal
yang harus cocok **persis**: "PUIL", "IEC 60364", "KHA", nomor pasal, nama tabel.
Nomor pasal ikut diindeks bersama isi potongannya, jadi "3.24.2.1" menemukan
pasalnya langsung.

Pencariannya (`search_standard_chunks`, migrasi 0013) punya **dua tahap**, dan
tahap kedua yang menyelamatkan sebagian besar pertanyaan nyata:
`websearch_to_tsquery` meng-AND-kan seluruh kata, jadi "berapa KHA kabel NYY 4x25
kalau dipasang di dalam conduit" menuntut kesembilan kata ada di satu potongan
yang sama — dan hasilnya nol. Nol dari pencarian tidak bisa dibedakan dari korpus
yang memang tidak memuatnya. Jadi kalau AND kosong, kueri yang sama dicoba
sebagai OR dan diperingkat. Keduanya diuji terhadap Postgres 16 sungguhan, bukan
dibaca ulang.

Batasnya nyata dan tidak disembunyikan: pertanyaan yang **tidak memakai satu pun
kata** dari dokumennya tidak akan ditemukan — "jarak kabel ke pipa air" terhadap
pasal berjudul "separasi utilitas". Menambahkan vektor nanti bersifat menambah:
satu kolom `embedding`, satu indeks, satu cabang lagi di fungsi itu.

### Yang menjaganya

- **Membaca** dibatasi RLS dengan pagar yang sama seperti halaman Standar itu
  sendiri (`access_class <> 'no_standard'`), dan fungsi pencariannya
  `security invoker` — jadi akun yang kelasnya tidak mencakup Standar tidak
  mendapat satu potongan pun, ditegakkan database, bukan oleh route yang mungkin
  lupa memeriksa. Diuji sebagai peran non-superuser.
- **Menulis** tidak punya policy sama sekali: anon key tidak bisa menyentuh dua
  tabel itu, termasuk dari kode yang belum ditulis. Satu-satunya jalan masuk
  `/api/admin/standards` dengan service role. Sebuah policy "boleh menulis kalau
  kamu admin" akan terlihat lebih rapi dan lebih buruk — ia memindahkan kunci ke
  sisi browser, untuk tabel yang isinya dipakai sebagai sumber jawaban teknis.
- **Sebuah potongan tidak pernah melintasi halaman.** Ditemukan oleh tesnya
  sendiri: tiga halaman pendek digabung jadi satu potongan, dan kutipannya
  menyebut "hal. 1" untuk kalimat yang ada di halaman tiga. Orangnya membuka
  halaman 1, tidak menemukan apa yang dikutip, dan yang ia simpulkan bukan
  "halamannya bergeser" melainkan bahwa sistem ini mengarang kutipan.
- **Nomor di jawaban dan nomor di daftar keluar dari satu fungsi.**
  `buildSources()` menghasilkan blok untuk model dan daftar untuk layar dalam satu
  perulangan, karena dua perulangan yang menghitung anggaran yang sama akan
  berbeda pada perubahan pertama — dan bentuk perbedaannya adalah `[2]` di kalimat
  menunjuk dokumen yang berbeda dari `[2]` di daftar.
- **Sumbernya di giliran pengguna, bukan di system prompt.** System prompt halaman
  ini ratusan baris dan sama untuk setiap pertanyaan; menyuntikkan hasil pencarian
  ke dalamnya berarti tidak ada dua permintaan yang punya awalan sama. Aturan
  *cara memakai* blok itu tetap di system prompt — ia memang tidak berubah.
- **Yang tersimpan di `standards_threads` tetap pertanyaannya apa adanya.** Blok
  sumber tidak ikut: ia hasil pencarian untuk pertanyaan itu saja.
- Kolom `ai_events.sources` mencatat berapa potongan yang benar-benar ikut. Itu
  satu-satunya angka yang mengatakan apakah perpustakaannya perlu diisi lebih
  banyak; tanpanya pertanyaan itu hanya bisa dijawab dari perasaan orang yang
  paling terakhir bertanya.

### Kalau sumbernya tidak memuat jawabannya

Model diperintahkan mengatakannya dalam satu kalimat, lalu menjawab dari
pengetahuan umumnya dengan aturan di bawah berlaku penuh. Yang **dilarang**
adalah menjawab dari ingatan lalu menempelkan `[1]` padanya: nomor kutipan yang
menunjuk sumber yang tidak mengatakannya adalah kebohongan yang mengundang orang
memeriksanya, lalu menyesatkan pemeriksaannya.

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

Seluruh bagian ini adalah **perilaku cadangan**, dan sekarang memang begitu
kedudukannya. Yang menyelesaikannya sudah ada di atas — perpustakaan dokumen
standar, dengan kutipan bernomor yang bisa diperiksa. Aturan di sini berlaku
untuk yang tidak terjawab olehnya: korpus yang belum diisi, dan pertanyaan yang
tidak ditemukan di dalamnya. Dua keadaan itu akan selalu ada, jadi aturan ini
tidak akan pernah bisa dihapus — yang berubah cuma seberapa sering ia dipakai,
dan `ai_events.sources` yang mengukurnya.

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
