# Dokumen yang aktif, dan batas ruangan yang menahan armatur

Dua hal yang dilaporkan rusak dari pemakaian sungguhan, keduanya berakhir sebagai
gambar yang salah tanpa satu pun galat muncul di mana pun:

1. **Panel menyebut file .rvt yang lain.** Revit membuka
   `HBE-A-F_UTILITY BUILDING_bagus.utamaNWTTV.rvt`; panel di sebelahnya masih
   menulis `PROJECT TEST_bagus.utamaNWTTV`. Perintah berikutnya berangkat sambil
   yang mengirimnya membaca nama file yang bukan file itu.
2. **Armatur terpasang melewati batas ruangan.** `/place_lighting "LOUNGE 5"
   count=40 grid=5x8` menyebar empat puluh titik pada KOTAK ruangan, dan LOUNGE 5
   berbentuk L — sudut kotaknya jatuh di MEETING 2. Enam armatur berdiri di
   ruangan orang lain, ikut terhitung sebagai beban LOUNGE, dan tidak ada satu
   pun angka di hasilnya yang menyebutkan itu.

Yang pertama separuh diperbaiki di repo ini, separuh lagi di add-in. Yang kedua
seluruhnya di add-in — repo ini cuma bisa melaporkan angkanya dengan jujur.
Keduanya sudah dikerjakan; lihat tabel di bawah.

Seperti `docs/addin-electrical-commands.md`, yang ditulis di sini adalah
spesifikasinya: handler C#-nya hidup di
[`electrical_ai`](https://github.com/baguscandrautamamr/electrical_ai), di
`revit-addin/RevitCommandCenter.Electrical`, dan sebuah perubahan di sini tidak
mengubah apa pun di PC yang menjalankan Revit sampai DLL-nya diganti.

**Sisi add-in-nya sudah dibangun**, di branch `claude/dokumen-boundary-lampu-kx4mcv`
repo itu:

| Yang diminta | Di mana |
|---|---|
| Penyaringan batas ruangan untuk grid yang disebut | `Utils/RevitUtils.cs` — `GenerateCeilingGrid`, `CanTestBoundary` |
| Satu jalan untuk ketiga perangkat plafon | `Handlers/DevicePlacementHandler.cs` — `CeilingGridFor` |
| `outside_boundary` / `requested` / `boundary_checked` di balikan | `Models/DomainModels.cs` — `PlacementResultDto`, `CeilingGrid` |
| Angkanya dititipkan per eksekusi | `Handlers/ICommandHandler.cs` — `HandlerContext.ReportBoundary` |
| `document` di setiap balikan | `Queue/CommandProcessor.cs` — `WithDocument` |

Jadi dokumen ini sekarang dua hal sekaligus: apa yang diminta, dan mengapa —
bagiannya yang tidak bisa dibaca dari kode. Yang berubah dari rencana awal
disebutkan di tempatnya masing-masing di bawah, dan satu di antaranya cukup
besar untuk disebut di sini: **butir 1a ternyata sudah benar sejak awal.**
`CommandQueueWorker.Execute` sudah mengambil `app.ActiveUIDocument?.Document`
pada saat perintahnya dijalankan, bukan menyimpannya di sebuah field. Add-in
tidak pernah mengerjakan dokumen yang salah; yang salah cuma nama yang tampil di
panel, dan itu seluruhnya di sisi website.

---

## 1. Dokumen aktif

### Yang terjadi

Panel perintah menampilkan nama file .rvt dari jawaban `/model_info`. Sampai
sebelum perubahan ini, website membacanya **sekali** — pada saat proyeknya
terpilih — dengan alasan yang benar: setiap pembacaan adalah satu baris di
`commands_queue` yang harus diambil add-in satu per satu, dan membacanya berkala
berarti antrean yang penuh oleh pertanyaan yang jawabannya hampir selalu sama.

Alasan itu benar dan akibatnya tetap salah. Berganti file .rvt terjadi **di
Revit**, dan tidak ada satu pun kejadian di sisi website yang menandainya: tidak
ada klik, tidak ada perintah, tidak ada jawaban yang berubah bunyinya. Nama yang
tampil bertahan sampai halamannya dimuat ulang — dan yang menjadikannya mahal
bukan namanya, melainkan semua yang menggantung padanya: daftar ruangan di
dropdown, daftar sheet untuk print, dan isi ruangan yang sudah dihitung. Ketiganya
tetap tampil, tetap terlihat benar, dan semuanya milik file yang sudah tidak
terbuka.

### Yang sudah dikerjakan di sisi website

- `model_info` dibaca lagi **saat panelnya kembali terlihat atau dapat fokus**,
  dan **berkala satu menit sekali selama panelnya terlihat**. Berhenti sendiri
  saat tab-nya tidak terlihat, dan tidak pernah lebih rapat dari lima belas detik
  walau kedua pemicunya menyala bersamaan.
- Begitu namanya berganti, daftar ruangan, daftar sheet, dan isi ruangan yang
  sudah dibaca **dikosongkan**, dan pergantiannya **dikatakan** — satu baris yang
  menyebut nama file yang lama, karena dropdown yang tiba-tiba kosong tanpa sebab
  terbaca sebagai kerusakan.
- Pemeriksaan berkala yang tidak dijawab **tidak menghapus** nama yang sudah
  benar. Yang ditampilkan tetap nama terakhir yang dijawab, ditandai "belum
  dipastikan lagi", dengan tombol coba lagi di sebelahnya. Revit yang sedang
  menghitung sesuatu bukan Revit yang tertutup.
- Pembacaan yang menyerah menunggu **tidak mengantre baris kedua**. Antrean
  Revit satu jalur, jadi `model_info` yang duduk di belakang print 40 sheet
  menunggu belasan menit — jauh lebih lama daripada batas menunggunya. Barisnya
  tetap di antrean dan tetap akan dijalankan, jadi pemeriksaan berikutnya
  menyambung menunggu baris yang sama. Tanpa itu, satu print panjang meninggalkan
  belasan baris `model_info` yang dijalankan beruntun sesudahnya, semuanya dengan
  jawaban yang sama, semuanya menahan perintah berikutnya yang benar-benar
  diminta orangnya.
- `model_info` tidak lagi muncul di halaman Riwayat maupun di daftar "sedang
  berjalan". Tidak ada orang yang menjalankannya; halaman itu sendiri yang
  mengirimnya, dan lima puluh baris riwayat yang terisi olehnya adalah riwayat
  yang tidak memuat satu pun perintah yang benar-benar dikirim orangnya. Ia tetap
  dihitung sebagai bukti add-in hidup (`lastSeen`) — justru karena ia yang paling
  sering berjalan.

### Yang harus dipenuhi add-in

**a. Dokumen ditentukan saat perintahnya dijalankan, bukan saat add-in dimuat.**
**Sudah begitu** — `CommandQueueWorker.Execute` mengambilnya di dalam
`ExternalEvent`, sekali per perintah. Tidak ada yang perlu diubah; yang di bawah
adalah alasan mengapa itu benar, supaya ia tidak berubah nanti.

`OnStartup` berjalan sekali; dockable pane dibuat sekali; `Document` yang
disimpan di sebuah field pada salah satu dari keduanya akan tetap ada di field
itu setelah filenya ditutup. Yang berbahaya bukan pengecualian yang dilemparnya —
itu terlihat — melainkan yang tidak: sebuah `Document` yang masih valid untuk file
yang sudah tidak dilihat siapa pun tetap menjawab `Title` dengan nama lamanya, dan
tetap menerima transaksi.

Jadi setiap handler mengambilnya lagi, di dalam `Execute`:

```csharp
var uidoc = uiapp.ActiveUIDocument;          // null kalau tidak ada yang terbuka
if (uidoc == null) throw new InvalidOperationException(
    "tidak ada dokumen yang terbuka di Revit");
var doc = uidoc.Document;
```

Kalau add-in menyimpan sesuatu yang diturunkan dari dokumen — daftar family type,
daftar ruangan, daftar print setup — kuncinya harus dokumen itu
(`Document.GetHashCode()`, atau `PathName` untuk file yang sudah tersimpan), dan
isinya dibuang saat dokumennya berganti. Cache yang tidak berkunci dokumen adalah
bentuk lain dari bug yang sama: nama file yang benar, isi yang milik file lain.

**b. `model_info` harus murah, karena sekarang ia sering.** *(Belum dikerjakan —
ini soal ongkos, bukan soal benar.)*

Sekali per menit selama panelnya terlihat. Yang dikirimnya sekarang bukan cuma
judul: `family_types` dan `rooms` masing-masing sebuah `FilteredElementCollector`
atas seluruh model, dan pada file yang besar keduanya terasa.

Yang diminta: **simpan hasilnya per dokumen, dan buang saat dokumennya berganti
atau modelnya berubah.** `Application.DocumentChanged` sudah memberi tahu yang
kedua, `ViewActivated`/`DocumentOpened`/`DocumentClosing` yang pertama. Judul dan
path dibaca ulang setiap kali — keduanya gratis — jadi jawaban yang keluar tetap
menyebut dokumen yang benar-benar aktif walau daftar di dalamnya datang dari
cache.

Yang **tidak** diminta: kunci payload baru untuk pembacaan ringkas. Website
sengaja tidak mengirimkannya. Add-in yang menolak argumen yang tidak dikenalinya
akan menolak seluruh perintahnya, dan itu berarti fitur yang sekarang jalan
berhenti jalan di setiap PC yang DLL-nya belum diganti. Bentuk kawatnya tetap
persis seperti sebelumnya: `/model_info` tanpa argumen.

**c. Setiap hasil menyebut dokumen yang dikerjakannya.** *(Sudah dibangun:
`CommandProcessor.WithDocument`.)*

Satu medan, di balikan **setiap** perintah — baca maupun tulis:

```jsonc
{ "document": "HBE-A-F_UTILITY BUILDING_bagus.utamaNWTTV", /* … sisanya … */ }
```

Isinya `doc.Title`, sama persis dengan yang dikirim `model_info` sebagai `title`.
**Sama persis** itu syaratnya, bukan anjuran: website membandingkan keduanya
sebagai string, dan `doc.Title` yang di satu tempat berakhiran `.rvt` sementara di
tempat lain tidak akan terbaca sebagai dokumen yang berbeda pada setiap perintah.
Pilih satu — `doc.Title`, apa adanya — dan pakai di kedua tempat.

Ini pemicu ketiga, dan yang paling murah dari ketiganya: **nol baris antrean
tambahan**, karena yang dibacanya adalah hasil perintah yang memang sudah
diminta. Begitu nama itu tidak sama dengan yang tampil, yang tampil sudah pasti
salah — bukan mungkin salah, dan bukan salah semenit lagi. Website sudah membaca
medan ini (`CommandRunner`, efek "hasil perintah yang menyebut dokumen lain"), dan
diam saja kalau medannya tidak ada. Jadi add-in lama tidak rusak karenanya; ia
hanya tidak mendapat pemicu yang ketiga.

**d. Tidak ada dokumen terbuka adalah kegagalan yang menyebutkan dirinya.**

`"tidak ada dokumen yang terbuka di Revit"` — bukan jawaban kosong, dan bukan
judul terakhir yang masih tersimpan. Website menampilkan pesan gagal apa adanya,
dan itu satu-satunya keadaan yang membedakan "Revit tertutup" dari "add-in tidak
menjawab".

### Catatan tentang nama file yang berakhiran nama orang

`PROJECT TEST_bagus.utamaNWTTV` dan
`HBE-A-F_UTILITY BUILDING_bagus.utamaNWTTV` keduanya membawa nama pengguna di
belakangnya: itu bentuk baku **file lokal dari model workshared** —
`<nama central>_<username>.rvt`. Jangan dipangkas agar "lebih rapi". Justru
akhiran itu yang membedakan file lokal seseorang dari central-nya, dan di layar
yang sedang dipakai untuk memastikan perintah berangkat ke file yang benar, itu
bagian yang paling perlu terlihat.

---

## 2. Batas ruangan

### Yang terjadi

`/place_lighting "LOUNGE 5" count=40 grid=5x8 height=3` — empat puluh armatur,
dilaporkan empat puluh terpasang. Di denah, enam di antaranya berdiri di dalam
MEETING 2.

Sebabnya bukan grid-nya salah. Grid 5x8 memang jawaban yang tepat untuk empat
puluh titik (lihat `web/lib/grid.ts`), dan jaraknya memang seragam. Sebabnya
adalah **grid dibentangkan pada kotak ruangan, sementara ruangannya bukan
kotak**. LOUNGE 5 berbentuk L: `BoundingBox` sebuah ruangan berbentuk L mencakup
takik yang bukan miliknya, dan titik-titik yang jatuh di takik itu jatuh di
ruangan sebelah.

Yang membuatnya mahal: hasilnya melaporkan empat puluh, dan empat puluh itu
benar sebagai jumlah `FamilyInstance` yang dibuat. Yang tidak benar adalah
membacanya sebagai empat puluh armatur di LOUNGE 5. Bebannya masuk ke perhitungan
lux LOUNGE, panel schedule menghitungnya sebagai beban LOUNGE, dan MEETING 2
mendapat enam armatur yang tidak pernah diminta siapa pun — yang kemudian
ditumpuki lagi saat MEETING 2 sendiri dipasangi lampu.

### Yang harus dipenuhi add-in

Berlaku untuk **kedelapan** perintah `place_*` dan untuk `/modify_devices` yang
menata ulang, bukan untuk `place_lighting` saja. Ruangan berbentuk L tidak
berhenti berbentuk L untuk stop kontak.

**a. Setiap titik diuji terhadap ruangannya sendiri, bukan terhadap kotaknya.**

Revit sudah menyediakan ujinya, dan itu bukan yang harus ditulis sendiri dari
kurva batas:

```csharp
// room adalah Autodesk.Revit.DB.Architecture.Room (atau Mechanical.Space).
if (!room.IsPointInRoom(point)) { /* titik ini dibuang */ }
```

Tiga hal yang menentukan benar-tidaknya pemakaiannya:

1. **`IsPointInRoom` menguji volume, bukan denah.** Titiknya harus punya Z yang
   berada di dalam ruangan itu — di antara `Level.Elevation + room.BaseOffset`
   dan batas atasnya (`UnboundedHeight` atau `LimitOffset`). Titik plafon pada
   ketinggian 3 m di ruangan setinggi 2,8 m jatuh **di luar** ruangan, dan
   seluruh empat puluhnya akan dibuang — yang terbaca persis seperti perintah
   yang tidak melakukan apa-apa. Uji pada ketinggian yang PASTI di dalam
   ruangan — misalnya 1 m di atas lantainya — lalu pasang armaturnya pada
   ketinggian yang diminta. Yang diuji adalah "titik ini di dalam denah ruangan
   ini atau tidak"; ketinggian pemasangan adalah pertanyaan yang lain.
2. **Ruangan yang tidak tertutup tidak punya volume sama sekali.** `Area == 0`
   atau `Location == null` berarti ruangannya belum terkurung dinding. Di situ
   ujinya tidak bisa dijalankan, dan yang benar bukan membuang semua titiknya
   melainkan **mengatakannya**: pasang seperti sebelumnya, dan sebutkan di
   balikan (`"boundary_checked": false`) bahwa batasnya tidak bisa diperiksa.
   Itu masalah pemodelan yang bisa diperbaiki orangnya, dan diam-diam
   memasang nol armatur menyembunyikannya.
3. **Titik yang jatuh persis di garis batas.** Dua ruangan bersebelahan berbagi
   satu garis; sebuah titik di atasnya bisa terbaca masuk keduanya atau tidak
   masuk satu pun, tergantung pembulatan. Tarik masuk sedikit — periksa titiknya
   setelah digeser beberapa milimeter ke arah pusat ruangan — supaya jawabannya
   tidak bergantung pada digit terakhir.

**b. Titik yang di luar dibuang, dan tidak diganti.**

Jangan melebarkan grid untuk mengejar jumlahnya kembali ke empat puluh. Jarak
antar armatur adalah alasan grid itu dihitung sejak awal; menambah titik untuk
menutupi yang dibuang mengubah jaraknya, dan yang keluar adalah tata letak yang
tidak seragam di ruangan yang bentuknya justru sudah sulit. Empat puluh yang
diminta di ruangan berbentuk L memang berarti kurang dari empat puluh yang
terpasang. Itu jawaban yang benar, selama ia dikatakan.

Sama untuk `count` yang dihitung dari `lux_target`: yang dihitung adalah jumlah
untuk luas ruangannya, dan luas itu sudah luas yang sebenarnya — bukan luas
kotaknya. Yang dibuang oleh uji batas adalah selisih antara kotak dan ruangan,
dan itu bukan kekurangan yang perlu ditambal.

**c. Selisihnya ikut di balikan.**

```jsonc
{
  "kind": "place_lighting",
  "document": "HBE-A-F_UTILITY BUILDING_bagus.utamaNWTTV",
  "room": "LOUNGE 5",
  "devices_placed": 34,        // yang BENAR-BENAR ada di model sesudah ini
  "requested": 40,             // yang diminta
  "outside_boundary": 6,       // dibuang karena di luar batas ruangan
  "boundary_checked": true,    // false = ruangannya tidak tertutup, uji dilewati
  "grid": "5x8",
  "family_used": "ACT_E_DOWNLIGHT 22WATT : DOWNLIGHT 22 WATT"
}
```

`devices_placed` adalah jumlah yang benar-benar berdiri di model — 34, bukan 40.
Website merangkumnya jadi satu baris: **"34 perangkat dipasang · ruangan LOUNGE 5
· 6 di luar batas ruangan"** (`web/lib/resultSummary.ts`), dan itu tepat kalimat
yang membuat selisihnya punya sebab. Tanpa `outside_boundary`, "34" untuk
permintaan "40" terbaca sebagai add-in yang gagal separuh jalan, dan orang yang
membacanya akan mengirimkan enam lagi.

`outside_boundary: 0` **tidak** ditampilkan — tidak ada yang perlu dijelaskan.
Dan medan yang **tidak ada sama sekali** juga tidak ditampilkan, dengan sengaja:
add-in versi lama tidak pernah melihat batas ruangan, dan "0 di luar batas" dari
add-in yang tidak memeriksanya adalah pernyataan yang tidak ada yang
memeriksanya.

**d. Nol yang terpasang tetap jawaban, bukan galat.**

Grid yang seluruh titiknya jatuh di luar ruangan hampir selalu berarti salah satu
dari dua hal, dan keduanya layak dikatakan apa adanya: ruangannya sangat kecil
dibanding kotaknya, atau ketinggian ujinya salah (lihat butir a.1). Balikannya
tetap `devices_placed: 0` dengan `outside_boundary` yang menyebutkan seluruhnya —
sebuah galat "gagal memasang" tidak menyebutkan mana dari keduanya.

### Yang TIDAK diminta

**Jangan menghapus armatur yang sudah ada di ruangan lain.** Yang dibuang adalah
titik dari perintah ini, sebelum atau sesudah dibuat — bukan apa pun yang sudah
berdiri di model sebelum perintahnya berangkat. Sebuah perintah yang menghapus
armatur di MEETING 2 karena sedang mengerjakan LOUNGE 5 menghapus pekerjaan orang
lain, dan yang terbaca di layar hanya "34 dipasang".

Kalau titiknya lebih mudah dibuang setelah `FamilyInstance`-nya terlanjur dibuat
(mis. karena penempatannya lewat `NewFamilyInstance` per titik di dalam satu
transaksi), yang dihapus adalah **elemen yang baru saja dibuat perintah ini** dan
yang ID-nya dipegang sendiri — di dalam transaksi yang sama, sehingga satu Ctrl+Z
membatalkan seluruhnya sebagai satu langkah. Menguji titiknya lebih dulu tetap
lebih baik: yang tidak pernah dibuat tidak perlu dihapus, dan tidak sempat
tersambung ke sirkuit apa pun.

---

## Apa yang sudah, dan apa yang belum

| | Keadaan |
|---|---|
| 1a — dokumen diambil di dalam `Execute` | Sudah begitu sejak awal; yang ditulis di sini alasannya, bukan perubahannya. |
| 1b — `model_info` di-cache per dokumen | **Belum.** Soal ongkos, bukan soal benar: sampai dikerjakan, yang terjadi hanya Revit membaca ulang daftar family dan ruangan sekali semenit selama panelnya terlihat. Yang paling mudah salah kalau dikerjakan terburu-buru adalah kuncinya — cache yang tidak berkunci dokumen menghasilkan nama file yang benar dengan isi milik file lain, yaitu bug yang sama dalam bentuk lain. |
| 1c — `document` di setiap balikan | Sudah. |
| 2a–2c — uji batas ruangan pada grid | Sudah, untuk ketiga perangkat plafon (armatur, detektor, speaker) lewat satu jalan. |
| 2 pada perangkat dinding | **Tidak perlu.** Stop kontak, saklar, jack telepon dan LAN ditempatkan dari segmen batas ruangan itu sendiri (`RoomPerimeter`), jadi titiknya tidak pernah keluar dari ruangannya. Uji tambahan di situ hanya menambah cara baru untuk salah. |
