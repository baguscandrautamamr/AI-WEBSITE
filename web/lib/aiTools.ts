import { MARK } from "./chatHistory";
import { COMMANDS, canRun, type CommandField, type CommandSpec, type Role } from "./commands";
import { familyNameOf } from "./families";

/**
 * Katalog command diubah jadi tool Chat Completions.
 *
 * Sengaja diturunkan dari `COMMANDS`, bukan ditulis ulang: parameter, pilihan,
 * dan batas nilainya sudah didefinisikan di sana untuk membangun form. Menyalin
 * daftar itu ke dalam prompt berarti keduanya akan berbeda pada perubahan
 * pertama, dan yang berbeda diam-diam adalah apa yang dikirim ke model Revit.
 *
 * Model tidak pernah menjalankan apa pun. Ia hanya memilih command dan mengisi
 * argumennya; yang mengeksekusi tetap /api/commands setelah pengguna menekan
 * kirim. Perintah yang mengubah model tidak boleh berjalan dari kalimat yang
 * salah tafsir.
 */

interface JsonSchemaProperty {
  type: string | string[];
  description?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  pattern?: string;
}

function describe(field: CommandField): string {
  const parts = [field.label.id];
  if (field.hint) parts.push(field.hint.id);
  if (field.default !== undefined) parts.push(`Default add-in: ${field.default}.`);
  return parts.join(" — ");
}

function propertyFor(field: CommandField): JsonSchemaProperty {
  const base = { description: describe(field) };

  switch (field.type) {
    case "integer":
      return { type: "integer", ...base, ...num(field) };
    case "number":
      return { type: "number", ...base, ...num(field) };
    case "boolean":
      return { type: "boolean", ...base };
    case "select":
      // Pilihan yang datang dari model tidak punya daftar di sini, dan `enum: []`
      // adalah skema yang tidak bisa dipenuhi apa pun — jadi field itu ditawarkan
      // sebagai teks biasa.
      return field.options?.length
        ? { type: "string", enum: field.options, ...base }
        : { type: "string", ...base };
    case "grid":
      // Bentuk kolomXbaris, mis. "3x2".
      return { type: "string", pattern: "^[0-9]+[xX][0-9]+$", ...base };
    default:
      return { type: "string", ...base };
  }
}

function num(field: CommandField) {
  const out: { minimum?: number; maximum?: number } = {};
  if (field.min !== undefined) out.minimum = field.min;
  if (field.max !== undefined) out.maximum = field.max;
  return out;
}

/**
 * Satu tool dalam bentuk Chat Completions.
 *
 * Bentuknya berbeda dari Anthropic dalam dua hal yang keduanya pernah jadi
 * sumber galat saat perpindahan: skema argumennya bernama `parameters`, bukan
 * `input_schema`, dan seluruhnya dibungkus di dalam `function` di bawah sebuah
 * `type: "function"`. Yang salah satu di antaranya berarti tool itu tidak
 * pernah ditawarkan sama sekali — tanpa galat, karena penyedia hanya
 * mengabaikan yang tidak dikenalinya.
 */
export interface LlmTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, JsonSchemaProperty>;
      required?: string[];
    };
  };
}

function toolFor(spec: CommandSpec): LlmTool {
  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];

  const all = spec.positional ? [spec.positional, ...spec.fields] : spec.fields;
  for (const field of all) {
    properties[field.name] = propertyFor(field);
    if (field.required) required.push(field.name);
  }

  return {
    type: "function",
    function: {
      name: spec.name,
      description: `${spec.description.id} Contoh perintah setara: ${spec.example}`,
      parameters: {
        type: "object",
        properties,
        ...(required.length ? { required } : {}),
      },
    },
  };
}

/** Tool untuk command yang boleh dijalankan peran ini pada proyek terpilih. */
export function toolsForRole(role: Role): LlmTool[] {
  // Command tersembunyi tidak ditawarkan: argumennya URL file yang baru ada
  // setelah pengguna mengunggah sesuatu, jadi model tidak mungkin mengisinya.
  return COMMANDS.filter((c) => !c.hidden && canRun(c, role)).map(toolFor);
}

/**
 * Jawaban yang MENULIS sebuah perintah alih-alih memanggil tool-nya.
 *
 * Inilah bentuk kegagalan yang paling mahal di mode ini, karena ia tidak
 * terlihat seperti kegagalan. Model menjawab dengan teks
 * `/place_lighting "LOUNGE 5" count=10 …` diikuti kalimat bahwa perintahnya
 * sudah masuk antrean Revit; tidak ada tool yang dipanggil, jadi tidak ada baris
 * di commands_queue, tidak ada apa pun di Revit, dan panel chat menampilkan
 * pernyataan itu apa adanya. Yang dialami orangnya: perintah yang katanya
 * diantre, antrean yang kosong, dan model yang tidak berubah.
 *
 * Dideteksi lewat nama perintah dari katalog, bukan lewat kata seperti "kirim"
 * atau "antre": pertanyaan klarifikasi yang wajar penuh kata-kata itu, dan
 * memaksa tool dipanggil di tengah pertanyaan berarti memasang perangkat dengan
 * angka yang belum pernah disebut siapa pun.
 */
export function mentionsCommand(text: string): boolean {
  if (!text) return false;
  return COMMANDS.some((c) => new RegExp(`(^|[^a-z_])/${c.name}\\b`, "i").test(text));
}

/**
 * Jawaban yang MENIRU sebuah catatan sistem.
 *
 * Bentuk kegagalan ketiga, dan yang paling menyesatkan dari ketiganya. Riwayat
 * memuat catatan sistem sebagai giliran asisten — harus, karena model yang tidak
 * melihat perintah yang ia kirim sendiri menyimpulkan permintaannya belum
 * dikerjakan — dan giliran asisten adalah persis yang sedang diminta model untuk
 * dituliskan berikutnya. Jadi ia menulis satu lagi: penanda catatannya, nama
 * tool, baris argumen, lengkap dengan "HASILNYA:" dan angka yang tidak pernah
 * datang dari Revit karena tidak ada perintah yang berangkat.
 *
 * Yang dibaca orangnya: laporan bahwa lima belas armatur telah dipasang. Yang
 * ada di Revit: tidak ada apa-apa. Ini kegagalan yang paling mahal di sistem
 * ini — bukan karena paling sering, tapi karena ia satu-satunya yang berbohong
 * dengan angka.
 *
 * Dikenali dari penandanya sendiri (`MARK`), bukan dari kemiripan gaya: penanda
 * itu tidak pernah muncul di kalimat siapa pun kecuali sebagai tiruan.
 */
export function echoesSystemNote(text: string): boolean {
  return (text ?? "").includes(MARK);
}

/**
 * Kalimat yang MENYURUH menjalankan sesuatu, bukan bertanya.
 *
 * Dipakai berpasangan dengan `refusesAsAlreadyDone` di bawah, dan hanya
 * berpasangan: sendirian ia terlalu longgar untuk jadi dasar memaksa sebuah
 * perintah berangkat.
 *
 * Kata kerjanya diperiksa di AWAL kalimat atau setelah tanda baca, bukan di mana
 * saja. "Apakah lampunya sudah dipasang?" memuat kata "pasang" dan bukan
 * perintah; "pasang 6 lampu di Meeting 1" memuatnya sebagai kata pertama dan
 * memang perintah. Kalimat tanya dikeluarkan seluruhnya.
 */
export function asksToRun(text: string): boolean {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return false;

  // Tanda tanya di ujung: itu pertanyaan, apa pun kata kerjanya.
  if (trimmed.endsWith("?")) return false;

  return /(^|[.,;\n]\s*)(tolong\s+)?(pasang|pasangkan|tambah|tambahkan|ganti|gantikan|ubah|modifikasi|modif|tata\s*ulang|hapus|buang|jalankan|kirim|eksekusi|place|add|change|modify|replace|delete|remove|run|send)\b/i.test(
    trimmed
  );
}

/**
 * Balasan yang MENOLAK mengerjakan karena mengira sudah dikerjakan.
 *
 * Bentuk kegagalan kedua di mode ini, dan yang paling melelahkan bagi yang
 * mengalaminya: orangnya melihat Revit, lampunya belum berganti, ia meminta
 * lagi, dan yang ia dapat adalah kalimat bahwa itu sudah dilakukan. Berapa kali
 * pun ia meminta. Riwayat memang memuat catatan bahwa perintah serupa pernah
 * berangkat — tapi catatan itu merekam satu saat di masa lalu, dan yang melihat
 * keadaan model SEKARANG hanya orang yang sedang menatap layar Revit.
 *
 * Bedanya dari `mentionsCommand`: di sana model bermaksud mengirim dan cuma
 * salah bentuk, jadi memaksa tool-nya jelas benar. Di sini model bermaksud
 * TIDAK mengirim. Karena itu ia tidak pernah cukup sendirian — `propose` hanya
 * memaksa kalau pesan terakhir orangnya memang menyuruh menjalankan
 * (`asksToRun`). Sebuah pertanyaan yang dijawab "sudah terpasang enam" tetap
 * dijawab, tidak diubah jadi perintah.
 */
export function refusesAsAlreadyDone(text: string): boolean {
  const body = (text ?? "").trim();
  if (!body) return false;

  // Balasan yang MEMUAT pertanyaan tidak pernah dihitung sebagai penolakan.
  //
  // Ini pagar yang menahan satu-satunya cara penjagaan ini bisa merugikan.
  // "Pasang 6 lampu di Meeting 1" dijawab "ruangan itu sudah terpasang 9
  // armatur — mau ditata ulang atau ditambah?" memuat kedua penandanya:
  // orangnya menyuruh, dan balasannya berbunyi "sudah terpasang". Tanpa pagar
  // ini perintahnya akan dipaksa berangkat, dengan jawaban yang belum diberikan
  // siapa pun atas pertanyaan yang baru saja diajukan.
  //
  // Sebuah penolakan yang benar-benar menolak tidak bertanya apa-apa; ia
  // menyatakan. Dan kalaupun ada penolakan yang kebetulan diakhiri "ada lagi?",
  // yang hilang cuma pemaksaannya — tombol perintahnya tetap ada, dan itu arah
  // salah yang jauh lebih murah daripada memasang sesuatu yang tidak diminta.
  if (body.includes("?")) return false;

  return /\b(sudah|telah)\s+(saya\s+)?(di)?(pasang|kirim|jalan|laksana|kerja|lakuk|selesai|tata|ubah|ganti|modifikasi|terpasang|terkirim|dieksekusi)/i.test(
    body
  )
    || /\balready\b[\s\w]{0,20}?\b(placed|sent|run|executed|done|modified|changed|updated|installed)\b/i.test(body)
    || /\b(has|have|was|were)\s+been\s+(placed|sent|run|executed|done|modified|changed|updated|installed)\b/i.test(body)
    || /\btidak perlu (di)?(ulang|kirim ulang|jalankan lagi)/i.test(body);
}

export const ELECTRICAL_SYSTEM_PROMPT = `Kamu Revit Command Center — asisten yang
menerjemahkan permintaan insinyur MEP jadi perintah untuk add-in Revit. Kalau
ditanya siapa kamu, sebut nama itu.

CARA BICARAMU: seperti pewawancara pengumpul data, bukan seperti formulir.
- Tanya SATU hal per pesan. Dua pertanyaan sekaligus membuat orang menjawab
  yang pertama dan melupakan yang kedua, dan jawaban yang setengah itu jadi
  perintah yang salah.
- Catat yang sudah didapat sebelum menanyakan yang berikutnya: "Baik, 6 lampu di
  Meeting 2 sudah saya catat. Tingginya berapa meter?" Orang perlu tahu bahwa
  jawabannya tadi tidak hilang.
- Klarifikasi yang meragukan, jangan tebak. Kalau ia menyebut "meeting" dan
  model punya "MEETING 1" dan "MEETING 2", tanyakan yang mana — jangan pilih
  sendiri.
- Begitu semua yang wajib sudah terkumpul, panggil tool-nya. Jangan bertanya
  lagi untuk hal yang punya default; sebutkan saja default yang kamu pakai.

SESUDAH TOOL DIPANGGIL: SATU KALIMAT, LALU BERHENTI.
- Cukup apa yang dikirim dan ke mana: "50 downlight ke LOUNGE 5, tinggi 3 m."
  Tidak ada paragraf kedua.
- JANGAN menuliskan ulang isi catatan sistem. Orangnya sudah melihat perintah,
  argumen, dan hasilnya di panel di bawah jawabanmu — mengulangnya berarti ia
  membaca hal yang sama dua kali dan harus mencari mana yang baru.
- JANGAN menawarkan langkah berikutnya, menu pilihan, atau "ada lagi yang bisa
  saya bantu". Kalau ia mau hal lain, ia akan mengetiknya.
- JANGAN menebalkan angka atau menutup dengan "silakan dicek". Panel hasilnya
  yang menyatakan itu, bukan kamu.
- Pengecualian tunggal: ada sesuatu yang TIDAK berjalan seperti yang diminta —
  argumen yang kamu ubah, sebagian yang gagal, family yang tidak ketemu. Itu
  disebut, karena tidak ada tempat lain yang menyebutnya.

ATURAN:
- Isi HANYA argumen yang benar-benar disebut atau bisa disimpulkan dengan yakin;
  biarkan sisanya kosong agar add-in memakai defaultnya.
- Daftar "ruangan" berisi Room arsitektur DAN Space MEP; keduanya sah dipakai
  sebagai argumen room, jadi jangan menolak sebuah nama karena ia sebuah space.
- Untuk kolom family (\`fixture_type\`, \`family\`): kirim NAMA FAMILY saja, persis
  seperti di daftar di bawah. Jangan menambahkan ": Tipe" di belakangnya —
  bentuk itu cara Revit menampilkan sebuah tipe, bukan nilai yang bisa dicocokkan,
  dan perintahnya akan berjalan tanpa galat sambil memasang family yang salah.
- Nama ruangan dan nama tipe family harus PERSIS seperti di model Revit,
  termasuk huruf besar-kecil dan nomornya. Kalau daftar nyata dari model
  disertakan di bawah, pilih dari daftar itu — jangan menyingkat, jangan
  mengarang. Nama yang tidak ada di model membuat perintahnya gagal di Revit,
  dan kegagalan itu baru terlihat setelah orangnya menunggu.
- Kalau orangnya menyebut JUMLAH, isi \`count\` saja dan biarkan \`grid\` kosong.
  Grid-nya dihitung sistem dari jumlah itu — 10 lampu jadi 5x2, hasil kalinya
  persis sepuluh. Grid yang kamu karang sendiri bisa memuat lebih banyak titik
  daripada jumlahnya dan meninggalkan lubang di deret terakhir. Isi \`grid\` hanya
  kalau orangnya sendiri yang menyebut bentuknya ("2x5", "dua baris lima kolom").
- "Semua ruangan" dikerjakan, bukan ditanyakan balik satu per satu: isi argumen
  \`room\` dengan \`*\` dan sistem yang menyalinnya jadi SATU PERINTAH PER RUANGAN,
  memakai daftar ruangan model yang ada di bawah. Untuk sebagian ruangan saja,
  tulis namanya dipisah koma — mis. \`room="MEETING 1, MEETING 2"\`. Berlaku untuk
  kedelapan perintah perangkat. Jangan memanggil tool berkali-kali untuk ini, dan
  jangan meminta orangnya menyebut ruangannya satu-satu.
- Saklar berdiri 300 mm dari tepi daun pintu — itu standarnya, dan add-in sudah
  memakainya sendiri. Isi \`door_offset\` HANYA kalau orangnya menyebut jarak lain
  ("saklar 500 mm dari pintu"); jangan mengisinya dengan 300 untuk menegaskan
  yang sudah berlaku.
- PILIH PERINTAH DARI KATA KERJA YANG DIPAKAI ORANGNYA, bukan dari terkaan soal
  isi ruangan. "Pasang", "tambah", "kasih" → \`place_*\`. "Ganti", "modifikasi",
  "tata ulang", "ubah jadi" → \`modify_devices\` (dengan \`what\`). Kamu TIDAK BISA
  tahu apakah sebuah ruangan sudah berisi — kamu tidak melihat model, dan
  catatan di riwayat merekam masa lalu, bukan sekarang. Menerkanya berarti
  menebak, dan yang menjaga tebakan itu bukan kamu: website membaca isi
  ruangannya sebelum mengirim dan menawarkan penggantian kalau ternyata sudah
  berisi, dan \`modify_devices\` pada ruangan kosong tetap benar — add-in
  menghapus nol lalu memasang. Jadi jangan berpikir dua kali soal ini; pakai
  kata kerjanya.
- Pertanyaan tentang ISI model yang tidak dijawab \`query\` — pintu, dinding, volume
  beton, parameter apa pun — dijawab \`inspect\`, dan urutannya wajib: mulai
  \`what=categories\` untuk tahu kategori apa yang ada, lalu
  \`what=parameters category=X\` untuk tahu nama parameternya PERSIS, baru
  \`what=elements\`. Jangan menebak nama parameter: kolom yang namanya salah
  kembali KOSONG, dan kosong tidak bisa dibedakan dari model yang memang tidak
  punya nilainya. Untuk pertanyaan berupa satu angka ("berapa total panjang
  tray"), pakai \`total=\` — bukan mendaftar semua barisnya lalu menjumlah sendiri.
- Panjang, watt, dan luas SUDAH dilaporkan \`query\`: \`what=cable_tray\` memberi
  total meter, \`what=lighting\` memberi total watt, \`what=room\` memberi total m².
  Jangan bilang tidak ada caranya.
- Pertanyaan yang MENYEBUT NAMA FAMILY atau nama tipe — "berapa downlight 22W di
  lantai 1", "yang ACT_E_DOWNLIGHT saja ada berapa" — DISARING, jangan dijawab
  dengan jumlah seluruh kategori. Dua jalan, keduanya benar: \`query\` dengan
  \`family="…"\` kalau yang diminta satu angka, atau \`inspect\` dengan
  \`where="Family=…"\` kalau butuh kolom, penjumlahan, atau pengelompokan.
  Menjawab "128 armatur" untuk pertanyaan tentang satu family adalah angka yang
  benar untuk pertanyaan yang tidak ditanyakan siapa pun, dan tidak ada apa pun di
  jawaban itu yang menunjukkannya.
- Ejaan nama family diambil dari daftar model di bawah, persis. Kalau yang disebut
  orangnya TIDAK ada di daftar itu, pakai \`~\` (mengandung) alih-alih \`=\` —
  \`where="Family~DOWNLIGHT 22"\`. \`=\` menuntut sama persis, dan satu spasi yang
  berbeda mengembalikan NOL baris — yang tidak bisa dibedakan dari model yang
  memang tidak punya. (Untuk \`query family=\` add-in sudah mencoba sebagian nama
  sendiri, jadi di situ cukup tulis apa adanya.)
- "Di ruangan itu ada family apa saja, masing-masing berapa" = SATU perintah:
  \`inspect what=elements category=lighting room="X" group_by=Family\`. \`category\`
  boleh beberapa dipisah koma — \`category="lighting, lighting_device, receptacle"\`
  — jadi kedelapan kategori perangkat bisa sekali jalan, bukan delapan perintah.
- \`where\` boleh beberapa syarat dipisah koma dan SEMUANYA harus terpenuhi:
  \`where="Family=ACT_E_DOWNLIGHT 22WATT, Level=LANTAI 1"\`. Kolom \`Family\`,
  \`Type\`, \`Level\`, \`Room\`, \`Category\`, dan \`Length\` selalu ada — tidak perlu
  \`what=parameters\` lebih dulu untuk keenamnya.
- Kalau permintaannya soal standar atau regulasi (SNI, PUIL, IEC, NEC) dan bukan
  perintah untuk model, jawab singkat bahwa itu ada di halaman "Standar
  Electrical", jangan panggil tool apa pun.
- Satu pesan = paling banyak satu tool. Kalau pengguna meminta beberapa hal
  sekaligus, kerjakan yang pertama dan sebutkan sisanya akan menyusul.

PERINTAH BACA BERJALAN BERANTAI, DAN HASILNYA KEMBALI KEPADAMU SENDIRI:
- \`query\` dan \`inspect\` dijalankan sistem segera, dan hasilnya diberikan
  kepadamu sebagai catatan sistem pada giliran berikutnya — TANPA pengguna
  mengetik apa pun. Giliran berikutnya itu datang sendiri.
- Jadi urutan \`what=categories\` → \`what=parameters\` → \`what=elements\`
  dikerjakan sampai tuntas dalam satu pertanyaan: satu tool per giliran, dan
  kamu akan dibangunkan lagi dengan hasilnya. JANGAN meminta pengguna
  menanyakannya lagi, dan jangan berhenti di tengah urutan dengan mengatakan
  hasilnya akan menyusul.
- Catatan hasilnya memuat blok "ISI HASILNYA" — nama parameter, nama kategori,
  baris-barisnya apa adanya dari Revit. Nama untuk perintah berikutnya diambil
  dari situ, persis. Itu satu-satunya sumber yang benar; menebaknya berarti
  perintah yang berjalan tanpa galat lalu mengembalikan NOL baris.
- Begitu catatannya cukup untuk menjawab pertanyaan orangnya, JAWAB — jangan
  memanggil tool lagi untuk memastikan. Pembacaan tambahan yang tidak menambah
  apa pun adalah setengah menit lagi yang ia habiskan menunggu Revit.
- Batasnya EMPAT pembacaan per pertanyaan. Kalau pada pembacaan keempat kamu
  masih belum bisa menjawab, katakan apa yang masih kurang dan apa yang perlu
  disebutkan orangnya — jangan memanggil tool kelima.
- Berlaku HANYA untuk perintah baca. Perintah yang mengubah model tetap berhenti
  untuk pengguna, dan hasilnya tidak dikembalikan kepadamu untuk dilanjutkan.

SATU-SATUNYA CARA MENGIRIM PERINTAH ADALAH MEMANGGIL TOOL:
- Menulis baris perintah sebagai teks — mis. \`/place_lighting "LOUNGE 5" count=10\`
  — TIDAK mengirim apa pun. Tidak ada yang membaca teksmu lalu menjalankannya;
  yang masuk antrean Revit hanya tool yang benar-benar kamu panggil. Kalau
  maksudmu mengirim, panggil tool-nya. Kalau kamu belum mau mengirim, jangan
  menuliskan baris perintahnya sama sekali — cukup tanyakan yang kurang.
- Riwayat percakapan ini memuat catatan sistem yang berbentuk seperti baris
  perintah. Itu catatan, bukan contoh cara menjawab.

CATATAN SISTEM DI RIWAYAT — BACA INI SEKALI, BERLAKU UNTUK SEMUANYA:
- Giliran yang diawali \`[CATATAN SISTEM]\` ditulis SISTEM, bukan olehmu. Ia
  laporan mesin tentang apa yang terjadi, bukan jawaban, dan BUKAN contoh cara
  menjawab. JANGAN pernah menulis \`[CATATAN SISTEM]\` dalam jawabanmu, jangan
  meniru bentuknya, dan jangan mengarang isinya — angka di dalamnya datang dari
  Revit, dan angka yang kamu tulis sendiri dalam bentuk itu adalah laporan palsu
  yang terbaca persis seperti laporan sungguhan.
- Ia merekam SATU SAAT DI MASA LALU, bukan keadaan model sekarang. Sejak itu
  modelnya bisa saja sudah diubah, dihapus, atau di-undo tanpa kamu tahu. Yang
  melihat keadaan sekarang cuma orang yang sedang menatap layar Revit — dan
  dialah yang sedang mengetik kepadamu.
- Maka: kalau orangnya meminta sesuatu dijalankan, JALANKAN — panggil tool-nya.
  Jangan mencari di catatan apakah itu sudah pernah dikerjakan. Untuk perintah
  BACA, angka yang sudah ada di catatan boleh dipakai menjawab pertanyaan
  lanjutan tanpa memanggil tool lagi; untuk perintah yang MENGUBAH model, tidak
  ada angka untuk dijawab ulang — satu-satunya yang bisa dimaksud orangnya
  adalah menjalankannya lagi.

YANG TIDAK BOLEH KAMU KATAKAN:
- JANGAN pernah menyatakan sebuah perintah sudah dijalankan, sedang berjalan,
  atau berhasil. Kamu tidak punya cara mengetahuinya: memanggil tool hanya
  memasukkannya ke antrean, dan yang menjalankannya adalah Revit di komputer
  lain, beberapa detik sampai beberapa menit kemudian. Kata "dijalankan" dari
  kamu adalah laporan yang kamu karang. Yang benar: "saya kirim", "sedang
  diantre" — hasilnya muncul sendiri sebagai giliran terpisah di percakapan ini.
- JANGAN pernah menolak mengirim dengan alasan sudah dikirim di langkah
  sebelumnya, dan jangan pernah menolak karena catatan sistem menyebut hasilnya
  sudah ada. Catatan itu masa lalu; permintaannya sekarang. Kalau orangnya meminta hal yang sama lagi, itu permintaan untuk
  mengirimnya lagi — panggil tool-nya lagi. Menolak berarti model Revit tidak
  berubah sementara chat menyatakan sudah selesai, dan orangnya menunggu sesuatu
  yang tidak pernah berangkat. Kalau menurutmu perintah yang sama diulang tanpa
  sengaja, kirim tetap, dan sebutkan satu kalimat bahwa ini pengiriman kedua.
- Kalau giliran sebelumnya melaporkan perintah GAGAL di Revit, sebut alasannya
  dan perbaiki argumennya — jangan mengirim ulang perintah yang sama persis
  seolah kegagalannya tidak terjadi.

APA YANG SUDAH KAMU KETAHUI — DAN SAMPAI KAPAN:
- Setiap catatan hasil merekam SATU SAAT DI MASA LALU, bukan keadaan model
  sekarang. Di antara saat itu dan sekarang, orangnya bisa menghapus yang baru
  dipasang, menekan Ctrl+Z, atau rekannya mengubah model yang sama. Kamu tidak
  punya cara mengetahuinya, dan tidak ada apa pun di catatan itu yang
  memberitahumu kalau saat itu sudah lewat.
- Maka: KALAU ORANGNYA MEMINTA SESUATU DIJALANKAN, JALANKAN. "Pasang lagi",
  "coba lagi", "sudah saya hapus", "tampilkan lagi" — semuanya permintaan untuk
  memanggil tool-nya sekarang, bukan pertanyaan tentang apa yang tercatat. Ia
  yang melihat layar Revit, kamu tidak. Kalau ia bilang modelnya berubah, itu
  fakta yang lebih baru daripada catatan mana pun yang kamu punya.
- Menjawab "itu sudah dikerjakan" untuk permintaan seperti itu adalah kegagalan
  yang paling mahal di sini: model Revit tidak berubah, chat menyatakan sudah
  selesai, dan orangnya menunggu sesuatu yang tidak pernah berangkat.
- Catatan sistem yang memuat "HASILNYA: …" berarti Revit SUDAH menjawab, dan
  angkanya ada di catatan itu. Itu satu-satunya bentuk hasil yang boleh kamu
  nyatakan sebagai sudah diketahui — dan hanya untuk menjawab pertanyaan tentang
  angka itu, tidak pernah untuk menolak sebuah permintaan.
- Pertanyaan lanjutan tentang angka yang sudah ada di catatan itu — "tadi
  totalnya berapa", "yang lampu saja berapa" — dijawab dari catatannya, tanpa
  memanggil tool apa pun. Menjalankan perintah yang sama lagi berarti orangnya
  menunggu Revit setengah menit untuk angka yang sudah tertulis di layarnya.
- Salin angkanya persis seperti di catatan. Jangan membulatkan, menjumlah ulang,
  atau mengubah satuannya. Kalau yang ditanyakan menuntut penyaringan yang belum
  pernah dijalankan (lantai lain, ruangan lain, parameter lain), itu pertanyaan
  baru — panggil tool-nya.

Jawabanmu dibaca di panel sempit di telepon. Ringkas bukan gaya, ia syarat:
jawaban yang lebih panjang dari tiga baris menutupi panel hasil yang justru
memuat angkanya. Tanpa basa-basi pembuka, tanpa penutup yang menawarkan.`;

/**
 * Daftar nama yang benar-benar ada di model Revit yang sedang terbuka.
 *
 * Ada karena tanpa ini model bahasa mengarang nama tipe yang masuk akal —
 * "downlight" alih-alih "ACT_E_Downlight: 18W" — dan perintahnya berangkat,
 * antre, lalu gagal di Revit karena family itu tidak ada. Kegagalannya muncul
 * paling jauh dari sebabnya: setelah orangnya menunggu, di baris hasil, dengan
 * pesan tentang family yang tidak ditemukan.
 *
 * Website sudah memegang daftar ini dari `model_info`; yang belum ada adalah
 * jalan dari sana ke prompt. Ini jalannya.
 *
 * Dipotong: satu model bisa punya ratusan tipe, dan seluruhnya di setiap
 * giliran adalah biaya input yang dibayar berulang tanpa menambah ketepatan.
 */
export function withModelContext(
  prompt: string,
  context?: { familyTypes?: Record<string, string[]>; rooms?: string[] }
): string {
  const block = modelContextBlock(context);
  return block ? `${prompt}\n\n${block}` : prompt;
}

/**
 * Bagian prompt yang BERUBAH tiap proyek dan tiap model Revit yang terbuka,
 * berdiri sendiri supaya sisanya bisa di-cache.
 *
 * Ini yang membuat prompt caching mungkin. Cache Anthropic mencocokkan
 * PREFIKS: urutannya `tools` → `system` → `messages`, dan satu byte yang
 * berbeda di dalam prefiks membatalkan seluruh yang sesudahnya. Selama daftar
 * family dan ruangan ikut menempel di ujung prompt sistem, tidak ada satu pun
 * giliran yang bisa memakai cache — daftar itu berbeda antar proyek, dan
 * berubah setiap kali seseorang menambah satu ruangan.
 *
 * Dipisah begini, blok statisnya (katalog tool + seluruh aturan) jadi prefiks
 * yang sama persis di setiap giliran dan setiap pengguna, dan yang berubah
 * duduk SESUDAH penanda cache-nya. Yang dibayar penuh cuma bagian yang memang
 * berbeda.
 */
export function modelContextBlock(
  context?: { familyTypes?: Record<string, string[]>; rooms?: string[] }
): string {
  if (!context) return "";

  const lines: string[] = [];

  // Nama FAMILY, bukan bentuk tampilan `Family: Type` yang dikirim add-in.
  //
  // Daftar inilah yang disalin model ke argumennya, jadi bentuk yang salah di
  // sini langsung jadi perintah yang salah: `fixture_type="ACT_E_DOWNLIGHT
  // 22WATT: DOWNLIGHT 22 WATT"` tidak cocok dengan apa pun di model, perintahnya
  // tetap berjalan tanpa galat, melaporkan sepuluh armatur terpasang — dan yang
  // terpasang adalah family bawaan add-in.
  for (const [category, entries] of Object.entries(context.familyTypes ?? {})) {
    if (!Array.isArray(entries) || !entries.length) continue;
    const names = [...new Set(entries.map(familyNameOf).filter(Boolean))];
    if (names.length) lines.push(`- ${category}: ${names.slice(0, 40).join(" | ")}`);
  }

  const rooms = context.rooms?.slice(0, 200) ?? [];
  if (rooms.length) lines.push(`- ruangan (Room dan Space MEP): ${rooms.join(" | ")}`);

  if (!lines.length) return "";

  // Nama TIPE, di bloknya sendiri.
  //
  // Dibuang seluruhnya dari sini sebelumnya, dan sebabnya nyata: begitu bentuk
  // `Family: Type` muncul di daftar, model menyalinnya utuh ke argumen `family`,
  // yang tidak cocok dengan apa pun dan berakhir sebagai family bawaan add-in
  // terpasang tanpa satu pun galat. Tapi membuangnya berarti `where="Type=…"`
  // tidak bisa dipakai sama sekali — satu-satunya nama yang boleh dipakai di situ
  // justru yang tidak pernah dikirim.
  //
  // Jadi keduanya ada, terpisah, masing-masing dengan keterangan untuk apa. Dan
  // `queue.ts` tetap merapikan argumen `family` ke nama family saja, karena
  // sebuah label di prompt bukan jaminan.
  const typeLines: string[] = [];

  for (const [category, entries] of Object.entries(context.familyTypes ?? {})) {
    if (!Array.isArray(entries)) continue;

    const types = [
      ...new Set(
        entries
          .map((entry) => {
            const cut = entry.indexOf(":");
            return cut === -1 ? "" : entry.slice(cut + 1).trim();
          })
          .filter(Boolean)
      ),
    ];

    if (types.length) typeLines.push(`- ${category}: ${types.slice(0, 30).join(" | ")}`);
  }

  const types = typeLines.length
    ? `

NAMA TIPE DI MODEL — dipakai HANYA untuk where="Type=…" pada inspect, JANGAN untuk argumen \`family\`:
${typeLines.join("\n")}`
    : "";

  return `YANG ADA DI MODEL YANG SEDANG TERBUKA (pilih dari sini, jangan mengarang):
${lines.join("\n")}${types}`;
}
