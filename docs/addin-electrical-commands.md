# Empat perintah baru untuk add-in `electrical_ai`

Sisi website-nya sudah selesai dan sudah masuk katalog
(`web/lib/commands.ts`). Dokumen ini spesifikasi yang harus dipenuhi handler
C# di repo [`electrical_ai`](https://github.com/baguscandrautamamr/electrical_ai),
di `revit-addin/RevitCommandCenter.Electrical`.

**Sampai handler-nya ada, keempat perintah ini berakhir `failed` dengan
"unknown command".** Bukan menggantung, bukan diam — tapi juga belum berguna.
Itu keadaan yang disengaja: katalognya lebih dulu supaya form, validasi, dan
tool AI-nya bisa diuji tanpa Revit, tapi urutan itu berarti ada jendela waktu
di mana tombolnya ada dan jawabannya belum.

## Dari mana ini datang, dan kenapa tidak bisa disalin begitu saja

Tiga perintah kelistrikan diport dari
[`MCP-SERVER-BAGUS`](https://github.com/baguscandrautamamr/MCP-SERVER-BAGUS)
(commit `3220145`). Yang keempat, `show_element`, diport dari
`OperateElementEventHandler.cs` di repo yang sama.

Repo itu menjangkau Revit lewat TCP `localhost:8080`; add-in ini dijangkau
lewat baris di tabel `commands_queue` yang diambil RPC `claim_next_command`.
Jadi yang bisa dipindahkan adalah **logika Revit API-nya**, bukan definisi
tool-nya: `server/src/tools/*.ts` di sana tidak punya padanan di sini, dan
`command.json` di sana tidak dibaca apa pun di sini.

Nama perintahnya sengaja dipertahankan persis (`get_electrical_loads`, bukan
`electrical_loads`), supaya nama kelas, kunci payload, dan file asalnya
berbaris satu-satu saat diport.

| Perintah | Sumber C# yang diport |
|---|---|
| `get_electrical_loads` | `commandset/Commands/MEP/GetElectricalLoadsCommand.cs` + `Services/MEP/GetElectricalLoadsEventHandler.cs` |
| `get_panel_schedule` | `commandset/Commands/MEP/GetPanelScheduleCommand.cs` + handler-nya |
| `check_circuit_balance` | `commandset/Commands/MEP/CheckCircuitBalanceCommand.cs` + handler-nya |
| `show_element` | `commandset/Services/OperateElementEventHandler.cs`, cabang `Select` dan `SelectionBox` |
| helper bersama | `commandset/Utils/ElectricalHelper.cs`, `commandset/Models/MEP/CircuitRecord.cs` |

`ElectricalHelper.cs` layak disalin hampir utuh. Isinya yang menentukan
benar-tidaknya angka di sini, dan tiga hal di dalamnya tidak akan terpikirkan
kalau ditulis ulang dari nol:

1. **Konversi satuan eksplisit.** `system.Voltage`, `ApparentLoad`, `TrueLoad`,
   `ApparentCurrent`, dan `Rating` semuanya dalam satuan internal Revit, bukan
   volt/VA/ampere. Harus lewat
   `UnitUtils.ConvertFromInternalUnits(x, UnitTypeId.Volts)` dan seterusnya.
   Melewatkan ini menghasilkan angka yang tetap terlihat masuk akal.
2. **Setiap pembacaan dibungkus try/catch.** Accessor sirkuit **melempar**
   kalau sirkuit itu belum punya panel atau belum punya beban tersambung. Satu
   sirkuit begitu cukup untuk menggagalkan seluruh kueri kalau tidak dibungkus.
   Yang benar: medan itu jadi `null`, barisnya tetap ikut.
3. **`ElementId.Value` vs `.IntegerValue`.** Berbeda antara Revit 2024+ dan
   sebelumnya; `ElectricalHelper.IdValue()` sudah menanganinya dengan
   `#if REVIT2024_OR_GREATER`.

## Kontrak yang berlaku untuk keempatnya

**Masuk.** Add-in membaca `command_type` (nama di tabel di bawah) dan
`command_json` (objek payload). Website sudah memvalidasi tipe, rentang, dan
pilihan `select` sebelum baris ini dibuat — jadi angka yang masuk pasti angka,
dan `select` pasti salah satu nilai yang terdaftar. Yang **belum** dijamin:
nama panel yang tidak ada di model. Itu urusan add-in.

Kunci yang nilainya kosong **tidak dikirim sama sekali** (lihat `coerce` di
`web/lib/queue.ts`), bukan dikirim sebagai `""` atau `null`. Jadi handler harus
memperlakukan "kunci tidak ada" sebagai "pakai bawaan", dan bawaannya harus
sama dengan yang tertulis di kolom Default di bawah.

**Keluar.** Balikan JSON. Tiga perintah kelistrikan **harus** memakai bentuk
`rows` / `total` / `shown` / `totals` / `groups`, karena bentuk itu sudah
dimengerti `summarizeResult` dan `digestResult` di website:

```jsonc
{
  "rows":   [ /* satu objek per baris; medannya per perintah */ ],
  "total":  128,        // seluruh yang cocok, BUKAN yang ditampilkan
  "shown":  50,         // panjang rows
  "totals": [ { "parameter": "Beban", "sum": 84213.5, "unit": "VA" } ],
  "groups": [ { "value": "PP-1", "count": 24 } ]
}
```

Memakai bentuk ini berarti **tidak ada satu baris pun yang perlu diubah di
website** untuk merangkum hasilnya: satu baris ringkasan di gelembung chat, dan
isi yang bisa dibaca model pada giliran berikutnya, keduanya datang gratis.
Bentuk lain tetap tampil sebagai tabel mentah, hanya tanpa ringkasan.

`total` dan `shown` harus dibedakan sungguhan. `limit` memotong `rows`, tapi
`totals` **wajib dihitung atas seluruh yang cocok** — total beban yang ikut
terpotong di baris ke-50 adalah angka yang salah, dan tidak ada apa pun di
layar yang akan menyebutkan bahwa ia salah.

**Gagal.** Tulis pesan yang menyebut yang dicari. `"panel \"PP-9\" tidak ada;
yang ada: PP-1, PP-2, LP-1"` menyelesaikan masalahnya; `"not found"` memulai
percakapan.

---

## 1. `get_electrical_loads`

Setiap sirkuit dengan beban, tegangan, arus, rating, dan panelnya.
Read-only — **tidak boleh** membuka transaksi.

### Payload

| Kunci | Tipe | Default | Arti |
|---|---|---|---|
| `panel` | string | *(semua)* | Cocok **sebagian** nama panel, **tidak peduli huruf besar-kecil**. `"pp-1"` harus kena `"PP-1 LANTAI 2"`. |
| `system_type` | string | `all` | Salah satu: `all`, `power`, `lighting`, `data`, `telephone`, `security`, `fire_alarm`, `nurse_call`, `communication`, `controls`. |
| `detail` | string | `summary` | `summary` = `rows` kosong, hanya `totals` + `groups`. `list` = satu baris per sirkuit. |
| `limit` | int | 200 | Hanya dikirim saat `detail=list`. Memotong `rows`, **bukan** `totals`. |
| `include_element_ids` | bool | `false` | Hanya dikirim saat `detail=list`. |

`system_type` dipetakan ke `Autodesk.Revit.DB.Electrical.ElectricalSystemType`.
Pemetaannya **milik add-in** — website sengaja tidak mengenal nama enum Revit:

| Nilai payload | `ElectricalSystemType` |
|---|---|
| `power` | `PowerCircuit` |
| `data` | `Data` |
| `telephone` | `Telephone` |
| `security` | `Security` |
| `fire_alarm` | `FireAlarm` |
| `nurse_call` | `NurseCall` |
| `communication` | `Communication` |
| `controls` | `Controls` |
| `all` | tanpa penyaringan |

`lighting` **tidak punya padanan enum** — Revit tidak memisahkan sirkuit
penerangan dari `PowerCircuit`. Perlakukan `lighting` sebagai `PowerCircuit`
yang `LoadName`/`Name`-nya mengandung "light"/"lamp"/"lampu", dan **sebutkan di
`note`** bahwa penyaringannya berdasarkan nama, bukan jenis sistem. Penyaringan
berbasis nama yang tidak diumumkan adalah jumlah yang salah tanpa sebab yang
terlihat.

### Baris (`detail=list`)

```jsonc
{
  "id": 384210,               // ElementId sirkuit — dipakai /show_element
  "circuit_number": "1",
  "panel": "PP-1",
  "panel_id": 380011,
  "system_type": "PowerCircuit",
  "load_name": "Lighting L2 Zone A",
  "voltage": 230.0,           // V
  "apparent_load_va": 1840.0, // VA
  "true_load_w": 1748.0,      // W
  "current_a": 8.0,           // A
  "rating_a": 16.0,           // A — rating breaker
  "power_factor": 0.95,
  "poles": 1,
  "start_slot": 3,
  "phases": ["B"],            // diturunkan; lihat perintah 3
  "element_count": 12,
  "element_ids": [391002]     // hanya kalau include_element_ids=true
}
```

Medan yang accessor-nya melempar diisi `null`, **bukan** `0`. Bedanya
menentukan: `0` VA berarti sirkuit tanpa beban, `null` berarti Revit tidak mau
menjawab — dan hanya yang kedua yang layak diselidiki.

### Wajib ada di balikan

- `totals`: minimal `Beban (VA)` dan `Beban (W)`, atas **seluruh** yang cocok.
- `groups`: `{ "value": "<nama panel>", "count": <jumlah sirkuit> }`.
- `unassigned_circuits` (int): sirkuit yang `PanelName`-nya `null`. Angka ini
  yang menjelaskan kenapa total per panel tidak menjumlah ke total model.
- `note` (string, opsional): dipakai untuk peringatan `lighting` di atas.

`total: 0` adalah jawaban yang sah dan harus dikirim sebagai jawaban, bukan
galat: model yang armaturnya ada tapi belum disirkuitkan memang nol.

---

## 2. `get_panel_schedule`

Isi tiap panel. **Membaca** data panel — tidak membuat view Panel Schedule.

### Payload

| Kunci | Tipe | Default | Arti |
|---|---|---|---|
| `panel` | string | *(semua)* | Cocok sebagian nama, tidak peduli huruf besar-kecil. |
| `detail` | string | `summary` | `summary` = satu baris per panel. `list` = direktori sirkuit, urut `start_slot`. |
| `include_empty` | bool | `true` | Panel tanpa sirkuit ikut. |
| `limit` | int | 50 | Jumlah panel. |

Setiap `Electrical Equipment` dihitung sebagai calon panel — termasuk yang
belum berisi apa pun. Panel kosong yang tidak muncul terbaca sebagai panel yang
tidak ada, dan itu kesalahan yang lebih mahal daripada satu baris berlebih.

### Baris — `detail=summary` (satu per panel)

```jsonc
{
  "id": 380011,
  "panel": "PP-1",
  "distribution_system": "400/230 Wye",
  "mains_a": 100.0,
  "mounting": "Surface",
  "circuit_count": 24,
  "used_slots": 30,
  "max_slots": 42,            // null kalau family panelnya tidak punya
  "free_slots": 12,           // null kalau max_slots null — JANGAN ditebak
  "connected_load_va": 41250.0
}
```

`max_slots` dibaca dari parameter family panel (`LookupInt`). Kalau family-nya
tidak mengeksposnya, `max_slots` dan `free_slots` **keduanya `null`**. Menebak
42 karena "panel biasanya 42" menghasilkan sisa slot yang salah pada panel yang
justru paling perlu diperiksa.

### Baris — `detail=list` (satu per sirkuit, plus barisan panelnya)

Medannya sama dengan `get_electrical_loads`, ditambah `slot_label` (`"3"`, atau
`"3,5,7"` untuk breaker 3 pole) dan diurutkan menaik menurut `start_slot`. Slot
kosong di antara dua sirkuit **ikut sebagai baris** dengan
`"circuit_number": null` dan `"load_name": "(kosong)"` — slot kosong yang tidak
digambar adalah slot yang tidak terlihat saat mencari ruang untuk sirkuit baru.

### Wajib ada di balikan

- `unassigned_circuit_count` (int) — sirkuit tanpa panel.
- `totals`: `Beban tersambung (VA)` atas seluruh panel yang cocok.

---

## 3. `check_circuit_balance`

Sebaran beban tiga fasa per panel.

### Ini yang paling mudah dipercaya terlalu cepat

**Beban per fasa tidak dibaca dari Revit. Revit tidak menyimpannya.** Ia
diturunkan, dan asumsinya harus ikut dikirim di setiap balikan:

- Beban semu tiap sirkuit dibagi **rata** ke fasa yang ditempati breaker-nya.
  Beban nyata yang tidak rata antar fasa pada satu breaker 3-pole tidak
  terlihat di sini.
- Fasa awal disimpulkan dari nomor slot dengan mengandaikan susunan panelboard
  **baku A-A-B-B-C-C**: slot 1–2 fasa A, 3–4 fasa B, 5–6 fasa C, 7–8 kembali A.
  Rumusnya `((slot - 1) / 2) % 3` (`ElectricalHelper.PhaseIndexForSlot`).

Panel yang slotnya **tidak** disusun begitu menghasilkan angka yang salah tanpa
satu pun galat muncul di mana pun. Karena itu `assumption` di bawah **wajib**,
bukan opsional: satu-satunya hal yang membedakan angka ini dari hasil ukur
adalah kalimat yang menyebutkan bahwa ia bukan hasil ukur.

### Payload

| Kunci | Tipe | Default | Arti |
|---|---|---|---|
| `panel` | string | *(semua)* | Cocok sebagian nama. |
| `tolerance` | number | 10 | Persen. Fasa terberat yang lebih dari sekian persen di atas rata-rata ditandai. |
| `limit` | int | 50 | Jumlah panel. |

### Baris (satu per panel)

```jsonc
{
  "id": 380011,
  "panel": "PP-1",
  "phase_a_va": 14200.0,
  "phase_b_va": 13980.0,
  "phase_c_va": 9870.0,
  "average_va": 12683.3,
  "max_deviation_pct": 22.2,   // (terberat - rata2) / rata2 * 100
  "balanced": false,           // max_deviation_pct <= tolerance
  "heaviest_phase": "A",
  "lightest_phase": "C",
  "circuit_count": 24
}
```

Panel satu fasa dilewati, dan **jumlah yang dilewati ikut dilaporkan**
(`single_phase_skipped`). Panel yang hilang dari daftar tanpa keterangan
terbaca sebagai panel yang seimbang.

### Wajib ada di balikan

- `assumption` (string) — kalimat penuh, bukan kode. Misalnya:
  `"Beban per fasa diturunkan, bukan dibaca dari Revit: beban semu tiap sirkuit dibagi rata ke fasa yang ditempati breaker-nya, dan fasa awal disimpulkan dari nomor slot dengan mengandaikan susunan panelboard baku A-A-B-B-C-C."`
- `tolerance_pct` (number) — nilai yang benar-benar dipakai.
- `single_phase_skipped` (int).
- `groups`: `{ "value": "seimbang" | "tidak seimbang", "count": n }`.

---

## 4. `show_element`

Menunjukkan elemen di layar Revit. Dipakai kotak isian di halaman Baca Model:
orang mengetik ID, add-in membuka view 3D dan menyorotnya.

### Payload

| Kunci | Tipe | Default | Arti |
|---|---|---|---|
| `ids` | string | **wajib** | Satu ID, atau beberapa dipisah koma: `"384210"` atau `"384210,384215"`. |
| `view` | string | `3d` | `3d` = pindah ke view 3D. `current` = biarkan view aktif. |

`ids` sudah dinormalkan website (`normalizeElementIds` di `web/lib/queue.ts`):
sudah dipangkas spasinya, sudah dipastikan bilangan bulat positif, duplikatnya
sudah dibuang, urutannya dipertahankan. Add-in cukup memecahnya per koma.

### Yang harus dilakukan

Diport dari cabang `Select` di `OperateElementEventHandler.cs`:

1. Kalau `view=3d`: cari `View3D` yang bukan template dan tidak terkunci —
   `FilteredElementCollector(doc).OfClass(typeof(View3D))`, utamakan yang
   namanya mengandung `{3D}` atau `Default 3D`. Set `uidoc.ActiveView`.
2. `uidoc.Selection.SetElementIds(ids)`
3. `uidoc.ShowElements(ids)` — inilah yang menggeser layar ke elemennya.

### Yang TIDAK boleh dilakukan

**Jangan port cabang `SelectionBox`.** Ia memasang section box, dan section box
itu **transaksi** — ia tersimpan di dokumen dan mengubah apa yang dilihat orang
lain yang membuka view 3D yang sama, sesudahnya. Perintah ini berkelompok
`read` dan boleh dijalankan `viewer`, dan halaman Baca Model menyatakan dengan
tegas bahwa tidak ada perintah di sana yang membuka transaksi Revit. Satu
perintah yang melanggarnya membuat pernyataan itu tidak benar lagi untuk semua
perintah lainnya.

Jadi: **tanpa transaksi sama sekali.** `ActiveView`, `Selection`, dan
`ShowElements` ketiganya tidak menuntut satu pun.

### Balikan

Bentuk `rows`/`total` tidak berlaku di sini — tidak ada yang dibaca.

```jsonc
{
  "shown": [384210, 384215],
  "not_found": [999999],
  "view": "{3D}"
}
```

ID yang tidak ada di model masuk `not_found` dan **bukan** galat, selama ada
setidaknya satu yang ketemu: menyorot dua dari tiga elemen lalu melaporkan
kegagalan total membuat orangnya mengetik ulang ketiganya. Kalau tidak ada satu
pun yang ketemu, barulah gagal, dengan menyebut ID yang dicari.

Kalau `view=3d` tapi model tidak punya `View3D` sama sekali: buat satu
(`View3D.CreateIsometric` dengan `ViewFamilyType` 3D) — itu **memang**
transaksi, jadi lakukan hanya kalau benar-benar tidak ada, dan sebutkan di
balikan (`"view_created": true`). Model tanpa view 3D langka; gagal total di
situ berarti kotak isiannya tidak berguna pada model yang justru paling awal.

---

## Urutan pengerjaan yang disarankan

1. `ElectricalHelper.cs` + `CircuitRecord.cs` — semua yang lain bergantung ke sini.
2. `show_element` — paling kecil, dan langsung terasa: kotak isiannya sudah ada
   di halaman Baca Model dan sekarang masih akan menjawab "unknown command".
3. `get_electrical_loads` — `get_panel_schedule` memakai kembali `BuildRecord`-nya.
4. `get_panel_schedule`.
5. `check_circuit_balance` — paling akhir, karena asumsinya paling menuntut
   pemeriksaan terhadap panel sungguhan.

Sesudah handler-nya jalan, perbarui `docs/COMMANDS.md` di repo `electrical_ai`
— itu sumber yang disalin `web/lib/commands.ts`, dan keduanya sudah berbeda
sejak dokumen ini ditulis.
