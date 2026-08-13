import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, tooManyRequests } from "@/lib/rateLimit";
import { anthropic, MODEL } from "@/lib/anthropic";
import { guardArea } from "@/lib/access";
import {
  attachmentNote,
  checkImages,
  imageOnlyQuestion,
  type ImageInput,
  type ImageType,
} from "@/lib/imageInput";
import { asLocale, type Locale } from "@/lib/locale";
import {
  applyFixes,
  fitHistory,
  parseFixes,
  redoReason,
  scrubLeaks,
  strayWords,
} from "@/lib/history";

export const runtime = "nodejs";

/** Pertanyaan soal standar; yang lebih panjang dari ini bukan pertanyaan lagi. */
const MAX_QUESTION_CHARS = 4_000;

/** 20 pertanyaan per menit per user. */
const QUESTIONS_PER_MINUTE = 20;

/**
 * Aturan bahasa jawaban, satu paragraf, ditentukan pilihan bahasa antarmuka.
 *
 * Ini yang dulu tidak tersambung ke mana pun. Pilihan bahasa hidup di
 * localStorage dan hanya mengatur tulisan di tombol; permintaan yang berangkat
 * ke sini tidak membawanya, jadi prompt-nya menebak sendiri — dan tebakannya
 * "hampir selalu Bahasa Indonesia". Akibatnya antarmuka berbahasa Inggris
 * menampilkan jawaban Indonesia, dan tidak ada satu pun cara mengubahnya dari
 * dalam aplikasi.
 *
 * Bahasa penanya tetap menang kalau ia memang mengetik dalam bahasa lain:
 * seseorang yang memilih English lalu bertanya dalam Bahasa Indonesia sedang
 * menyatakan maksudnya dengan cara yang lebih jelas daripada sebuah tombol yang
 * mungkin ditekan berbulan-bulan lalu.
 */
const LANGUAGE_RULE: Record<Locale, string> = {
  id: `BAHASA. Bahasa jawabanmu adalah BAHASA INDONESIA — itu bahasa yang dipilih
penggunanya di antarmuka. Kalau ia justru bertanya dalam bahasa lain, ikuti
bahasa pertanyaannya. SELURUH jawabanmu memakai huruf Latin.`,
  en: `LANGUAGE. Answer in ENGLISH — that is the language the user selected in the
interface. If they ask in another language, follow the language of their
question instead. Your entire answer must use the Latin alphabet.

Everything below is written in Indonesian because it is an internal instruction
to you. It says nothing about what language to answer in — those rules are about
drawings, tables, and formatting, and they apply the same in English.`,
};

const systemPrompt = (locale: Locale) => `Kamu Revit Command Center. Kalau ditanya siapa kamu — atau
disapa tanpa pertanyaan — sebut nama itu dalam satu kalimat, lalu tawarkan apa
yang bisa kamu bantu di halaman ini. Jangan menyebut nama model atau perusahaan
yang membuatmu.

Di halaman ini kamu menjawab pertanyaan seputar standar
dan regulasi kelistrikan (SNI, PUIL, IEC, NEC, dsb.) untuk kebutuhan desain MEP.
Jawab singkat, akurat, dan sebutkan nomor standar jika relevan. Kamu TIDAK pernah
mengeksekusi apa pun di Revit — kamu murni memberi informasi.

${LANGUAGE_RULE[locale]}

Istilah teknis Inggris justru dipertahankan, jangan diterjemahkan paksa: busbar,
bonding braid, load break switch, earthing, dan semacamnya memang dipakai begitu
di lapangan, dan menerjemahkannya membuat jawabannya lebih sulit dibaca, bukan
lebih mudah.

Yang DILARANG adalah menyisipkan kata dari bahasa lain di tengah kalimat —
Sirilik, Mandarin, Jepang, Korea, Arab. Ini bukan aturan gaya. Kalimat seperti
"Mau saya bantu hitung количество flexible bonding braid" sudah benar-benar
sampai ke layar pengguna, dan ia tidak punya cara menebak apa arti kata itu:
satu kata asing membuat seluruh jawaban tidak bisa dipercaya. Kalau sebuah kata
terasa lebih pas dalam bahasa lain, tulis padanannya dalam bahasa jawaban.

Lambang satuan tetap ditulis sebagaimana mestinya — Ω, μF, cos φ, ΔV. Itu
lambang teknis, bukan kata asing.

GAMBAR YANG DILAMPIRKAN. Pengguna bisa melampirkan foto atau tangkapan layar —
papan nama panel, gambar kerja, tabel di buku standar, tampilan alat ukur. Baca
yang benar-benar terlihat, sebutkan angka dan tulisan yang terbaca apa adanya,
lalu kaitkan dengan standarnya.

Yang tidak terbaca dikatakan tidak terbaca. Foto papan nama yang buram atau
angka yang terpotong adalah hal biasa, dan menebak satu angka di situ lebih
berbahaya daripada memintanya difoto ulang — angka itu dipakai orang untuk
memilih pengaman.

Riwayat percakapan hanya menyimpan KETERANGAN bahwa ada gambar, bukan gambarnya.
Jadi kalau giliran sebelumnya menyebut "[N gambar dilampirkan]" dan sekarang
tidak ada gambar apa pun, kamu memang sudah tidak bisa melihatnya: katakan itu
dan minta gambarnya dikirim ulang, jangan mengarang isinya dari ingatan.

DIAGRAM. Kalau — dan hanya kalau — pengguna meminta gambar, diagram, sketsa, atau
denah, ada DUA bentuk jawaban, dan memilih yang benar menentukan rapi-tidaknya
hasilnya:
- sekumpulan HAL SEJENIS (jenis stop kontak, simbol, tipe kabel, kelas
  peralatan) → blok kode berbahasa \`cards\`, lihat KISI KARTU di bawah;
- sesuatu yang BERBENTUK, yang bagian-bagiannya punya hubungan ruang (denah,
  potongan, diagram satu garis, skema pembumian) → satu blok kode berbahasa
  \`svg\` berisi SVG yang utuh (diawali <svg ...> dan diakhiri </svg>).

JANGAN PERNAH menulis penanda sebagai pengganti gambar — bukan [diagram], bukan
[gambar], bukan [image], bukan "(diagram menyusul)". Tidak ada yang mengisi
penanda itu di belakangmu: yang tampil di layar pengguna persis huruf-huruf itu,
di bawah judul yang menjanjikan sebuah gambar, dan tidak ada apa-apa lagi. Kalau
kamu memutuskan menggambar, gambarnya harus benar-benar ada di jawaban yang sama.
Kalau tidak jadi menggambar, jangan menyebut ada gambar.

Kamu TIDAK punya tool apa pun. Jangan menulis [TOOL_CALL], nama fungsi, atau
objek JSON seperti {"name": ..., "input": ...} — semua itu akan tampil sebagai
teks di layar pengguna, bukan dijalankan. SVG-nya ditulis langsung sebagai isi
blok kode, dengan baris baru yang sungguhan; JANGAN mengubahnya menjadi string
berisi \\n dan \\", dan jangan membungkusnya di dalam nilai sebuah field.

Aturan SVG:
- WAJIB ada viewBox, dan JANGAN setel width/height dalam piksel — biar ia
  menyesuaikan lebar layar. Pembacanya sering memakai HP.
- Bentuk viewBox mendatar dan tidak terlalu tinggi: rasio antara 4:3 dan 16:9,
  mis. viewBox="0 0 800 500". Gambar yang jangkung terpotong di layar telepon.
- SELURUH isi harus berada di dalam viewBox, dengan margin minimal 20 unit di
  keempat sisinya. Tidak boleh ada garis atau teks yang menyentuh atau melewati
  tepinya — itu penyebab paling sering gambar terlihat terpotong.
- Dan sebaliknya: isinya harus MENGISI viewBox itu. viewBox yang jauh lebih lebar
  daripada gambarnya menyisakan ruang kosong di kanan, dan sisa garis tepi yang
  tidak bertemu apa pun di sana terbaca sebagai gambar yang rusak. Kalau setelah
  digambar ternyata separuh kanannya kosong, kecilkan viewBox-nya — jangan
  ditambahi hiasan untuk mengisi.
- Jangan menggambar bingkai dekoratif mengelilingi seluruh gambar. Ia tidak
  menambah keterangan apa pun, dan ia justru bagian yang paling sering tidak
  bertemu dengan isinya.
- TIDAK ADA BATAS ELEMEN, dan jangan menahan diri demi ukuran. Gambar yang baik
  jauh lebih berharga daripada gambar yang pendek: pakai elemen sebanyak yang
  memang diperlukan supaya gambarnya lengkap, terbaca, dan benar. Yang membatasi
  bukan jumlahnya, melainkan apakah setiap elemen menerangkan sesuatu.
- Yang tetap dibuang: yang tidak menerangkan apa-apa. Tanpa komentar <!-- -->,
  tanpa id dan class, tanpa hiasan yang cuma mengisi ruang. Bukan demi ringkas —
  melainkan karena gambar teknik yang penuh hal tak berarti lebih sulit dibaca.
- JANGAN menyalin ke dalam gambar apa yang sudah kamu tulis di teks jawaban, dan
  jangan menulis paragraf di dalam gambar. Gambar untuk yang berbentuk, teks
  untuk yang berupa kalimat. Untuk permintaan gambar, teks jawabannya cukup
  beberapa baris — gambarnya yang jadi jawaban.
- Panel keterangan HANYA kalau ada yang benar-benar perlu dijelaskan di dalam
  gambar, bukan kolom yang selalu ada. Legenda tiga baris lebih baik jadi tiga
  label di sebelah simbolnya masing-masing.
- TIDAK BOLEH ADA YANG BERTUMPUK. Sebelum menulis setiap <rect> dan <text>,
  pastikan kotak batasnya tidak beririsan dengan apa pun yang sudah digambar.
  Ini kesalahan yang paling sering terjadi dan paling merusak: legenda menimpa
  panel, label menimpa garis, teks menimpa teks.
- Teks harus berdiri di atas latar kosong. Kalau sebuah label harus berada dekat
  garis, geser labelnya menjauh dan tarik garis penunjuk tipis — jangan
  menuliskannya di atas garisnya.
- Label yang panjang dipendekkan atau dipecah jadi dua <text> bertingkat, bukan
  dibiarkan melebar menembus elemen di sebelahnya.
- Kalau ruang tidak cukup, LEBARKAN viewBox-nya — jangan perkecil hurufnya dan
  jangan dirapatkan. Kanvas tidak ada harganya; huruf 9 px dan garis yang
  berdesakan ada harganya, dan yang membayar pembacanya.
- Gambar yang baik punya susunan: judul di kiri atas, isi utamanya di tengah,
  keterangan di tempat yang tetap. Tebal-tipis garis dipakai untuk membedakan
  yang utama dari yang penunjang, bukan seragam semua.
- font-size minimal 12 (pada viewBox setinggi ~500). Huruf yang lebih kecil
  tidak terbaca di HP.
- Pakai stroke dan fill dengan warna eksplisit yang terbaca di atas putih. Jangan
  mengandalkan CSS luar.
- DILARANG: <script>, <image>, <foreignObject>, atribut href, dan event handler
  seperti onclick. Semua itu dibuang sebelum digambar, dan diagram yang
  bergantung padanya akan tampil rusak.
- Setiap angka pada gambar harus angka yang sama dengan yang kamu sebut di teks
  jawaban. Gambar yang tidak cocok dengan perhitungannya lebih buruk daripada
  tidak ada gambar.
- Beri label dimensi (mis. "40 m", "Rp = 107 m") sebagai <text>, bukan hanya
  garis tanpa keterangan.

KISI KARTU. Kalau yang diminta adalah SEKUMPULAN HAL SEJENIS — jenis stop
kontak, simbol pada denah, kelas peralatan, tipe kabel, ukuran tray — JANGAN
menggambarnya sebagai SVG. Pakai blok \`cards\`, dan halaman ini yang menata
letaknya.

Alasannya jujur saja: menaruh sembilan kartu sebagai SVG berarti menghitung
belasan koordinat sambil menulis, tanpa pernah melihat hasilnya, dan satu saja
yang meleset menghasilkan dua kartu yang saling menimpa. Itu sudah terjadi
berkali-kali. Dengan blok ini kamu tidak menghitung apa pun: kolom, letak,
tinggi, dan jarak dihitung program, dan hasilnya selalu seragam.

Bentuknya — satu kartu satu baris, empat kolom dipisah tanda \`|\`:

\`\`\`cards
judul: Jenis Socket Outlet Internasional
catatan: Tampang depan, IEC 60906-1
Type A | US / Jepang | 100-127 V, 15 A | <circle cx="50" cy="50" r="34" fill="none" stroke="#0f172a" stroke-width="3"/><rect x="41" y="36" width="6" height="16" fill="#0f172a"/><rect x="53" y="36" width="6" height="16" fill="#0f172a"/>
Type C | Eropa / Indonesia | 220-250 V, 2,5 A | <circle cx="50" cy="50" r="34" fill="none" stroke="#0f172a" stroke-width="3"/><circle cx="40" cy="46" r="5" fill="#0f172a"/><circle cx="60" cy="46" r="5" fill="#0f172a"/>
\`\`\`

Aturannya:
- Kolom 1 NAMA, kolom 2 keterangan, kolom 3 keterangan kecil, kolom 4 gambar
  simbolnya. Kolom 2 dan 3 boleh dikosongkan; kolom 4 juga.
- Simbolnya digambar dalam kotak "0 0 100 100" MILIKNYA SENDIRI — titik tengahnya
  (50,50) — dan itu satu-satunya koordinat yang perlu kamu pikirkan. Halaman ini
  yang mengecilkan dan menaruhnya di tempatnya.
- Isi kolom 4 hanya bentuk: circle, rect, ellipse, line, path, polygon, polyline,
  text. Tanpa <g>, tanpa <svg>, semuanya dalam SATU baris.
- Nama yang panjang dipendekkan sendiri oleh halaman ini, tapi yang pendek tetap
  lebih terbaca: "NEMA L6-20R", bukan "NEMA L6-20R twist-lock 250 V".
- Paling banyak 16 kartu — batas tata letaknya, bukan batas hemat.
- Simbolnya digambar sungguhan, bukan kotak kosong berisi singkatan. Bentuk yang
  bisa dikenali sekilas itu seluruh gunanya kartu ini ada.
- Jangan menulis judul/catatan yang mengulang kalimat yang sudah kamu tulis di
  luar blok.

SVG tetap dipakai untuk yang benar-benar BERBENTUK: denah, potongan, diagram
satu garis, skema pembumian, radius proteksi. Itu gambar yang bagian-bagiannya
punya hubungan ruang; kisi kartu bukan.

JANGAN MENGGAMBAR DENGAN KARAKTER. Tidak ada tabel yang dibuat dari \`|\` dan
\`-\`, tidak ada kotak dari \`+---+\`, tidak ada garis dari \`│ ─ ┌ └ ═\`, dan
tidak ada diagram ASCII di dalam blok kode. Alasannya bukan selera:

- Tabel begitu HARUS dilebarkan dengan spasi yang dihitung sendiri, dan satu
  baris yang isinya lebih panjang dari perkiraanmu membuat seluruh sisi kanannya
  bergerigi. Itu tidak bisa diperbaiki pembacanya, dan tidak bisa diperbaiki
  siapa pun setelah terkirim.
- Blok kode tidak melipat baris; yang lebih lebar dari layar harus digeser ke
  samping. Di telepon, tabel ASCII selebar 70 karakter berarti membaca sambil
  menggeser, baris demi baris.

Yang dipakai sebagai gantinya, dan keduanya sudah dirender rapi oleh halaman ini:

- data bertabel  → TABEL MARKDOWN biasa (\`| Kolom | Kolom |\` dengan baris
  \`|---|---|\`). Lebarnya diatur browser, dan di layar sempit ia menggulir di
  dalam kotaknya sendiri.
- gambar/denah/skema → SVG, dengan aturan di atas.

Blok kode (\`\`\`) hanya untuk hal yang memang kode atau nilai harfiah — rumus,
nama parameter, potongan konfigurasi. Bukan untuk tata letak.

Kalau pengguna tidak meminta gambar, jawab dengan teks dan tabel seperti biasa —
jangan menyisipkan diagram atas inisiatif sendiri.`;

/** Sama dengan MAX_TURNS di src/services/standards.ts repo electrical_ai. */
const MAX_TURNS = 8;

/**
 * Riwayat sebagai konteks model — utuh, diagram dan semuanya.
 *
 * Dulu diagramnya dibuang di sini demi menghemat token. Itu dicabut: tagihannya
 * dihitung per permintaan, bukan per token, jadi tidak ada yang dihemat — dan
 * penanda yang ditinggalkannya justru dua kali membuat model berhenti
 * menggambar, karena riwayat dibaca sebagai contoh jawabannya sendiri.
 *
 * Yang tersisa cuma menyapu sisa penanda lama dari jawaban yang telanjur
 * tersimpan, dan sebuah batas ukuran sebagai jaring pengaman.
 */
function asContext(turns: Turn[]) {
  return fitHistory(turns.map((t) => ({ ...t, text: scrubLeaks(t.text) })))
    .filter((t) => t.text.length > 0)
    .map((t) => ({ role: t.role, content: t.text }));
}

interface Turn {
  role: "user" | "assistant";
  text: string;
}

// Mode Standard: TIDAK PERNAH menulis ke commands_queue.
//
// Riwayat percakapan disimpan di `standards_threads` — tabel yang sama yang
// dipakai bot Telegram (migrasi 0007), dengan bentuk baris
// `{ role, text }` dan RLS `standards_threads_self` (user_id = auth.uid()).
// Jadi satu orang yang bertanya di Telegram lalu melanjutkan di website
// menemukan percakapan yang sama, bukan dua utas terpisah.
export async function POST(req: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Halaman ini satu-satunya yang tidak punya proyek untuk dijadikan pagar:
  // standards mode dirancang bekerja tanpa proyek, jadi sebelum kelas akun ada,
  // "sudah login" adalah seluruh syaratnya — termasuk untuk akun yang belum
  // pernah diberi proyek apa pun.
  const gate = await guardArea(supabase, user.id, "standard");
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: 403 });

  let message: unknown;
  let rawImages: unknown;
  let rawLanguage: unknown;
  try {
    ({ message, images: rawImages, language: rawLanguage } = await req.json());
  } catch {
    return NextResponse.json({ error: "body harus JSON" }, { status: 400 });
  }

  // Bahasa antarmuka si penanya. Yang tidak dikenali — termasuk yang tidak
  // dikirim sama sekali, seperti dari `curl` atau versi halaman yang lebih lama
  // yang masih ada di cache — jatuh ke Indonesia, persis perilaku sebelumnya.
  const locale = asLocale(rawLanguage);

  // Diperiksa DI SINI, bukan hanya di halaman. Halaman memang mengecilkan
  // gambarnya lebih dulu, tapi yang menentukan bukan halaman: sebuah `curl`
  // bisa mengirim apa saja, dan yang dibayar per gambar adalah kami.
  const checked = checkImages(rawImages);
  if (!checked.ok) return NextResponse.json({ error: checked.reason }, { status: 400 });
  const images = checked.images;

  // Gambar saja, tanpa satu kata pun, adalah pertanyaan yang sah — "ini apa?"
  // memang tidak perlu diketik kalau gambarnya sudah ada. Yang tidak sah adalah
  // permintaan yang benar-benar kosong.
  if (typeof message !== "string" || (!message.trim() && images.length === 0)) {
    return NextResponse.json({ error: "`message` wajib diisi" }, { status: 400 });
  }

  if (message.length > MAX_QUESTION_CHARS) {
    return NextResponse.json(
      { error: `pertanyaan terlalu panjang (maksimal ${MAX_QUESTION_CHARS} karakter)` },
      { status: 400 }
    );
  }

  const limit = rateLimit(`ai:standard:${user.id}`, QUESTIONS_PER_MINUTE, 60_000);
  if (!limit.ok) return tooManyRequests(limit);

  const question = message.trim() || imageOnlyQuestion(locale);

  const { data: thread } = await supabase
    .from("standards_threads")
    .select("turns")
    .eq("user_id", user.id)
    .maybeSingle();

  // Utas ini dipakai bersama bot Telegram, jadi bentuk barisnya ditentukan dua
  // penulis, bukan satu. Yang tidak berbentuk giliran dibuang: satu baris rusak
  // seharusnya tidak membuat pertanyaan berikutnya ditolak gateway dengan 400.
  const previous: Turn[] = (Array.isArray(thread?.turns) ? thread!.turns : []).filter(
    (t: unknown): t is Turn =>
      Boolean(t) &&
      typeof t === "object" &&
      ((t as Turn).role === "user" || (t as Turn).role === "assistant") &&
      typeof (t as Turn).text === "string" &&
      (t as Turn).text.trim().length > 0
  );

  // Jawaban dikirim bertahap, bukan sebagai satu blok di akhir.
  //
  // Pertanyaan standar dijawab beberapa paragraf, dan menunggu seluruhnya
  // selesai berarti belasan detik layar diam. Isinya sama; yang berubah adalah
  // orangnya bisa mulai membaca kalimat pertama sementara sisanya masih ditulis.
  //
  // Bentuknya NDJSON — satu objek JSON per baris — bukan teks polos: dengan
  // teks polos, kegagalan di tengah aliran tidak bisa dibedakan dari jawaban,
  // dan status HTTP sudah terlanjur terkirim sebelum kegagalannya diketahui.
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (chunk: object) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(chunk)}\n`));

      let reply = "";

      /**
       * Isi sebuah giliran: teks saja, atau gambar-gambar lalu teksnya.
       *
       * Gambar diletakkan SEBELUM teks, dan itu bukan selera: pada urutan
       * sebaliknya model menjawab pertanyaannya lebih dulu lalu baru melihat
       * gambarnya — yang berarti jawabannya disusun tanpa hal yang ditanyakan.
       */
      type Block =
        | { type: "text"; text: string }
        // `media_type` bertipe sempit, bukan string: SDK-nya menuntut salah satu
        // dari empat format yang memang bisa dibaca, dan itu pemeriksaan yang
        // lebih baik terjadi saat kompilasi daripada sebagai 400 dari gateway.
        | { type: "image"; source: { type: "base64"; media_type: ImageType; data: string } };

      function asked(text: string, withImages: ImageInput[] = []): Block[] | string {
        if (withImages.length === 0) return text;
        return [
          ...withImages.map(
            (image): Block => ({
              type: "image",
              source: { type: "base64", media_type: image.media_type, data: image.data },
            })
          ),
          { type: "text", text },
        ];
      }

      /** Satu panggilan, dialirkan potongan demi potongan sambil dikumpulkan. */
      async function ask(
        messages: { role: "user" | "assistant"; content: string | Block[] }[]
      ) {
        let text = "";

        const response = anthropic.messages.stream({
          model: MODEL,
          // Ruangnya dilonggarkan, bukan dihemat: tagihan dihitung per
          // permintaan, jadi batas yang ketat tidak membeli apa pun dan hanya
          // memotong gambar di tengah tag — yang menghasilkan gambar RUSAK,
          // bukan gambar pendek. Gambar berdimensi yang lengkap memang memakan
          // ribuan token sendiri, dan sekarang ia boleh.
          max_tokens: 32_000,
          system: systemPrompt(locale),
          messages,
        });

        for await (const event of response) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta" &&
            event.delta.text
          ) {
            text += event.delta.text;
            send({ t: event.delta.text });
          }
        }

        return text;
      }

      try {
        const history = asContext(previous);
        reply = await ask([...history, { role: "user", content: asked(question, images) }]);

        // Sekali saja, dan hanya untuk kegagalan yang sudah pasti.
        //
        // Yang diminta gambar dan yang datang tulisan "[diagram]", atau kalimat
        // Indonesia yang tiba-tiba menyisipkan satu kata Rusia — dua-duanya
        // bukan jawaban kurang lengkap melainkan jawaban yang tidak bisa
        // dipakai, dan pengguna tidak punya cara tahu bahwa mengulang
        // pertanyaannya sendiri akan berhasil. Diulang di sini, dengan
        // kegagalannya diperlihatkan kembali kepada model supaya percobaan kedua
        // bukan lemparan dadu yang sama.
        const redo = redoReason(reply, question, locale);
        if (redo) {
          console.warn("[api/ai/standard] jawaban ditulis ulang:", redo.notice);

          // Yang sudah telanjur tampil di layar dibuang dulu; kalau tidak, hasil
          // percobaan kedua tersambung di belakang jawaban yang gagal itu.
          send({ reset: true, why: redo.notice });

          reply = await ask([
            ...history,
            // Gambarnya ikut lagi: percobaan kedua tanpa gambar adalah
            // percobaan menjawab pertanyaan yang berbeda.
            { role: "user", content: asked(question, images) },
            { role: "assistant", content: reply },
            { role: "user", content: redo.instruction },
          ]);
        }

        /**
         * Kata beraksara asing DITAMBAL, bukan dijadikan alasan menulis ulang.
         *
         * Ini pelajaran dari laporan berulang. Menulis ulang seluruh jawaban demi
         * satu kata berarti pengguna menonton jawaban yang sudah selesai dihapus
         * dan ditulis lagi hampir sama — dua kali ia melaporkannya sebagai bug,
         * dan memang begitu bentuknya di layar. Sisa jawabannya tidak salah; yang
         * salah satu kata.
         *
         * Jadi yang diminta cuma padanannya, dalam satu panggilan kecil, lalu
         * kata itu diganti di tempatnya — di layar lewat {fix}, di simpanan lewat
         * applyFixes. Jawabannya tetap yang pertama, dan tidak ada yang ditulis
         * dua kali.
         */
        const stray = strayWords(reply, question);
        if (stray) {
          console.warn("[api/ai/standard] kata beraksara asing:", stray.words.join(", "));

          try {
            const asked = await anthropic.messages.create({
              model: MODEL,
              max_tokens: 300,
              system:
                "Kamu penerjemah kata tunggal. Balas HANYA daftar `asli => padanan`, " +
                "satu per baris, tanpa kalimat pembuka dan tanpa penjelasan. Padanannya " +
                "wajib huruf Latin.",
              messages: [
                {
                  role: "user",
                  // Padanannya diminta dalam bahasa JAWABAN, bukan selalu
                  // Indonesia. Menambal kata Sirilik di tengah jawaban Inggris
                  // dengan sebuah kata Indonesia hanya menukar satu kata yang
                  // tidak terbaca dengan kata lain yang juga tidak terbaca.
                  content:
                    locale === "en"
                      ? `The following words appeared in the middle of an English answer and ` +
                        `its reader cannot read them. Give the most accurate English ` +
                        `equivalent for each, in an electrical-engineering context:\n` +
                        stray.words.join("\n")
                      : `Kata-kata berikut muncul di tengah jawaban berbahasa Indonesia dan tidak ` +
                        `terbaca pembacanya. Beri padanan Bahasa Indonesia yang paling tepat untuk ` +
                        `konteks teknik kelistrikan:\n${stray.words.join("\n")}`,
                },
              ],
            });

            const said = asked.content
              .map((block) => (block.type === "text" ? block.text : ""))
              .join("");

            const fixes = parseFixes(said, stray.words);

            if (fixes.length > 0) {
              reply = applyFixes(reply, fixes);
              send({
                fix: fixes,
                why:
                  locale === "en"
                    ? `${stray.script} words in this answer were replaced with their equivalents.`
                    : `Kata beraksara ${stray.script} pada jawaban ini diganti padanannya.`,
              });
            }
          } catch (err) {
            // Gagal menambal bukan alasan menahan jawaban yang sudah terbaca.
            // Katanya tetap tidak terbaca, dan itu lebih baik daripada layar
            // yang kosong.
            console.error("[api/ai/standard] gagal mencari padanan", err);
          }
        }
      } catch (err) {
        console.error("[api/ai/standard] gateway call failed", err);
        send({
          e:
            locale === "en"
              ? "the standards assistant cannot be reached right now"
              : "asisten standar sedang tidak bisa dihubungi",
        });
        controller.close();
        return;
      }

      if (!reply) {
        send({
          e:
            locale === "en"
              ? "the assistant returned no answer"
              : "asisten tidak mengembalikan jawaban",
        });
        controller.close();
        return;
      }

      const all: Turn[] = [
        ...previous,
        // Gambarnya TIDAK ikut tersimpan — lihat `attachmentNote`. Yang
        // tertinggal keterangannya, supaya giliran berikutnya tahu ada gambar
        // yang sudah tidak bisa dilihat lagi, bukan mengarang isinya.
        {
          role: "user",
          text:
            images.length > 0
              ? `${question}\n\n${attachmentNote(images.length, locale)}`
              : question,
        },
        // Disimpan UTUH, termasuk diagramnya. Tabel inilah yang dibaca ulang
        // saat halaman dibuka; menyimpan penandanya di sini berarti gambarnya
        // hilang begitu aplikasi dimuat lagi. Penghematan tokennya terjadi di
        // asContext(), saat pesan untuk model disusun.
        { role: "assistant", text: reply },
      ];

      // chat_id dibiarkan apa adanya untuk baris yang sudah ada; utas dari
      // website tidak punya chat Telegram, dan kolomnya memang nullable.
      const { error: saveError } = await supabase
        .from("standards_threads")
        .upsert(
          { user_id: user.id, turns: all.slice(-MAX_TURNS), updated_at: new Date().toISOString() },
          { onConflict: "user_id" }
        );

      // Gagal menyimpan tidak boleh menelan jawaban yang sudah terbaca — user
      // tetap dapat jawabannya, hanya kehilangan konteks di pertanyaan berikutnya.
      if (saveError) console.error("[api/ai/standard] gagal menyimpan utas", saveError);

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      // Tanpa ini sebagian proxy menahan aliran sampai penuh, yang membuang
      // seluruh gunanya.
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

// GET — utas yang tersimpan, supaya halaman Standard tidak mulai kosong setiap
// kali dibuka ulang padahal server masih mengingat percakapannya.
export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const gate = await guardArea(supabase, user.id, "standard");
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: 403 });

  const { data, error } = await supabase
    .from("standards_threads")
    .select("turns")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const turns: Turn[] = Array.isArray(data?.turns) ? (data!.turns as Turn[]) : [];
  return NextResponse.json({ turns });
}

// DELETE — mengosongkan utas.
//
// Barisnya dikosongkan, bukan dihapus: `standards_threads` juga dipakai bot
// Telegram, dan barisnya membawa `chat_id` serta `started_at` yang bukan milik
// website. Yang diminta orang saat menekan "hapus chat" adalah percakapannya
// hilang, bukan catatan bahwa ia pernah punya utas.
//
// Klien sesi, jadi RLS `standards_threads_self` yang menentukan baris mana yang
// tersentuh — tidak mungkin mengosongkan utas orang lain dari sini.
export async function DELETE() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const gate = await guardArea(supabase, user.id, "standard");
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: 403 });

  const { error } = await supabase
    .from("standards_threads")
    .update({ turns: [], updated_at: new Date().toISOString() })
    .eq("user_id", user.id);

  if (error) {
    console.error("[api/ai/standard] gagal mengosongkan utas", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
