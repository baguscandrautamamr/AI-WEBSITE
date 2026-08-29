/**
 * Apakah yang diketik orang itu sebuah ID elemen Revit, dan bukan pertanyaan.
 *
 * Ini yang menggabungkan "tunjukkan elemen" ke dalam kolom tulis yang sama
 * dengan pertanyaan biasa. Kotak isian tersendiri sudah dicoba dan salah:
 * halaman Baca Model jadi punya DUA kolom yang menerima ketikan, bersebelahan,
 * dan yang satu diam saja terhadap kalimat sementara yang lain diam saja
 * terhadap angka. Yang mana yang dipakai harus diputuskan orangnya sebelum ia
 * mengetik — dan itu keputusan yang tidak pernah perlu diminta darinya, karena
 * bentuk ketikannya sendiri sudah menjawabnya.
 *
 * SYARATNYA SENGAJA SEMPIT. Yang dikenali hanya pesan yang SELURUHNYA angka,
 * atau beberapa angka yang dipisah koma/spasi. Satu kata saja di dalamnya —
 * "elemen 384210", "384210 itu apa" — dan ini bukan ID lagi, melainkan
 * pertanyaan yang jawabannya kalimat. Batas itu harus tegas: sebuah pertanyaan
 * yang salah dikenali sebagai ID tidak pernah sampai ke model, dan yang terlihat
 * orangnya adalah pertanyaan yang dijawab dengan memindahkan layar Revit.
 *
 * Sebaliknya juga dijaga: sebuah angka telanjang bukan pertanyaan yang berarti
 * apa pun untuk model — "384210" tanpa konteks tidak punya jawaban — jadi tidak
 * ada yang hilang dengan mengambilnya ke sini.
 *
 * Balikannya bentuk kanonik yang siap jadi argumen `ids`, atau null.
 */
export function elementIdsIn(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Pemisahnya koma ATAU spasi: "384210, 384215" dan "384210 384215" keduanya
  // cara wajar menyebut dua elemen, dan menuntut komanya berarti setengah dari
  // ketikan yang jelas maksudnya justru berakhir di model.
  const parts = trimmed.split(/[\s,]+/).filter((p) => p !== "");

  // Kosong sesudah dipecah — ketikan yang isinya cuma pemisah, seperti "," —
  // bukan ID. Dinyatakan sendiri karena `every` di bawah bernilai true untuk
  // daftar kosong, dan tanpa baris ini yang berangkat adalah `ids` kosong.
  if (!parts.length) return null;

  // Semuanya harus angka. Satu bagian yang bukan berarti ini kalimat.
  if (!parts.every((p) => /^\d+$/.test(p))) return null;

  // ElementId 0 adalah InvalidElementId di Revit, jadi ia bukan elemen mana
  // pun. Dibiarkan lewat ke sini berarti perintahnya berangkat lalu ditolak
  // add-in; ditahan di sini berarti pertanyaannya jatuh ke model, yang akan
  // mengatakan bahwa 0 bukan ID yang bisa ditunjukkan. Yang kedua lebih
  // menjelaskan.
  if (parts.some((p) => Number(p) === 0)) return null;

  // Batas atas yang longgar tapi ada. ElementId Revit muat di 32-bit; angka
  // dua puluh digit hampir pasti bukan ID melainkan sesuatu yang lain — nomor
  // seri, kode barang — dan menebaknya sebagai ID membuat layar Revit
  // berpindah untuk sesuatu yang tidak pernah dimaksudkan begitu.
  if (parts.some((p) => p.length > 12)) return null;

  // Duplikat dibuang, urutan ketiknya dipertahankan. Sama dengan yang
  // dilakukan `normalizeElementIds` di queue.ts — yang di sana tetap yang
  // menegakkannya untuk pengirim mana pun, ini hanya supaya teks yang tampil
  // di gelembung sudah sama dengan yang berangkat.
  return [...new Set(parts)].join(",");
}
