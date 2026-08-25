import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isGlobalAdmin } from "@/lib/access";
import { chunkDocument } from "@/lib/standards";

export const runtime = "nodejs";

/**
 * Korpus dokumen standar: memasukkan, mendaftar, menghapus.
 *
 * ADMIN SISTEM SAJA, dan diperiksa dengan service role — bukan dengan peran
 * yang dikirim browser. Isi tabel ini dipakai sebagai SUMBER jawaban teknis
 * yang dipakai orang memilih pengaman; korpus yang bisa disunting siapa pun
 * yang login adalah korpus yang kutipannya tidak berarti apa-apa.
 *
 * Itu juga sebabnya penulisannya lewat sini dan bukan lewat RLS: migrasi 0013
 * sengaja TIDAK memberi policy insert/update/delete kepada anon key, jadi
 * satu-satunya jalan masuk adalah route ini.
 *
 * HAK CIPTA. SNI, PUIL, IEC, dan NEC berhak cipta. Route ini tidak bisa
 * memeriksa apa pun soal itu, dan tidak berpura-pura bisa: `note` wajib diisi,
 * dan yang ditulis di situ adalah dari mana salinan ini dan atas dasar apa ia
 * ada di sini. Sebuah korpus standar tanpa catatan asal adalah korpus yang
 * tidak bisa diaudit — dan yang akan ditanyakan lebih dulu bukan soal teknis.
 */

/** Sebuah dokumen; yang lebih besar dari ini bukan satu dokumen lagi. */
const MAX_TEXT_CHARS = 4_000_000;

/** Batas atas potongan per dokumen — jaring, bukan target. */
const MAX_CHUNKS = 8_000;

async function requireGlobalAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  const service = createServiceClient();
  if (!(await isGlobalAdmin(service, user.id))) {
    return {
      error: NextResponse.json(
        { error: "hanya admin sistem yang boleh mengelola dokumen standar" },
        { status: 403 }
      ),
    };
  }

  return { userId: user.id, service };
}

const str = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

/**
 * POST — satu dokumen masuk, dipotong, disimpan.
 *
 * Yang diterima TEKS, bukan PDF. Itu batas yang disengaja pada langkah ini:
 * ekstraksi PDF punya dua kegagalan yang tidak berbunyi seperti kegagalan —
 * PDF hasil pindaian tanpa lapisan teks menghasilkan halaman kosong, dan
 * ekstraksi kolom-ganda mengacak urutan kalimat. Keduanya menghasilkan korpus
 * yang tetap bisa dicari dan tetap bisa dikutip, dengan kutipan yang menunjuk
 * ke tempat yang salah. Untuk fitur yang seluruh gunanya justru menghapus
 * jawaban yang salah tapi terdengar yakin, itu bukan langkah pertama yang
 * benar.
 *
 * Jalannya sekarang: `pdftotext -layout dokumen.pdf dokumen.txt`, lihat
 * hasilnya, lalu kirim teksnya. `pdftotext` menulis FORM FEED antar halaman,
 * dan chunkDocument membaca itu sebagai nomor halaman — jadi kutipannya menyebut
 * halaman yang sama dengan halaman di PDF yang dipegang orangnya.
 */
export async function POST(req: Request) {
  const gate = await requireGlobalAdmin();
  if (gate.error) return gate.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "body harus JSON" }, { status: 400 });
  }

  const code = str(body.code, 120);
  const title = str(body.title, 300);
  // '' berarti "tanpa edisi", bukan NULL — lihat komentar kolomnya di migrasi
  // 0013: ON CONFLICT (code, edition) menuntut kolom yang tidak nullable.
  const edition = str(body.edition, 60);
  const note = str(body.note, 2_000);
  const text = typeof body.text === "string" ? body.text : "";

  if (!code) return NextResponse.json({ error: "`code` wajib diisi — mis. \"PUIL 2011\"" }, { status: 400 });
  if (!title) return NextResponse.json({ error: "`title` wajib diisi" }, { status: 400 });

  // Wajib, dan sengaja tidak punya nilai bawaan. Sebuah catatan asal yang
  // terisi sendiri adalah catatan asal yang tidak pernah dibaca siapa pun.
  if (!note) {
    return NextResponse.json(
      {
        error:
          "`note` wajib diisi: dari mana salinan dokumen ini, dan atas dasar apa ia " +
          "boleh ada di sini. Korpus standar tanpa catatan asal tidak bisa diaudit.",
      },
      { status: 400 }
    );
  }

  if (!text.trim()) return NextResponse.json({ error: "`text` wajib diisi" }, { status: 400 });
  if (text.length > MAX_TEXT_CHARS) {
    return NextResponse.json(
      { error: `dokumen terlalu besar (maksimal ${MAX_TEXT_CHARS} karakter)` },
      { status: 400 }
    );
  }

  const chunks = chunkDocument(text);

  if (chunks.length === 0) {
    return NextResponse.json(
      { error: "tidak ada teks yang bisa dipotong dari dokumen ini" },
      { status: 400 }
    );
  }
  if (chunks.length > MAX_CHUNKS) {
    return NextResponse.json(
      { error: `dokumen ini jadi ${chunks.length} potongan (batas ${MAX_CHUNKS}) — pecah per bagian` },
      { status: 400 }
    );
  }

  const { service, userId } = gate;

  // Dokumennya di-upsert pada (code, edition): memuat ulang sebuah dokumen
  // adalah hal yang wajar — ekstraksi yang diperbaiki, bagian yang tadinya
  // terlewat — dan yang tidak wajar adalah dua salinan edisi yang sama hidup
  // berdampingan lalu dikutip bergantian.
  const { data: doc, error: docError } = await service
    .from("standard_docs")
    .upsert(
      { code, title, edition, note, added_by: userId },
      { onConflict: "code,edition" }
    )
    .select("id")
    .maybeSingle();

  if (docError || !doc) {
    console.error("[api/admin/standards] gagal menyimpan dokumen", docError);
    return NextResponse.json(
      { error: docError?.message ?? "gagal menyimpan dokumen" },
      { status: 500 }
    );
  }

  const docId = (doc as { id: string }).id;

  // Potongan lama dibuang LEBIH DULU, seluruhnya.
  //
  // Bukan di-upsert per `ord`: ekstraksi yang diperbaiki menghasilkan jumlah
  // potongan yang berbeda, dan upsert meninggalkan ekor potongan lama dengan
  // ord yang lebih besar. Ekor itu tetap terindeks dan tetap bisa dikutip —
  // kutipan dari versi dokumen yang sudah diganti, berdampingan dengan yang
  // baru, tanpa apa pun yang membedakannya.
  const { error: clearError } = await service
    .from("standard_chunks")
    .delete()
    .eq("doc_id", docId);

  if (clearError) {
    console.error("[api/admin/standards] gagal mengosongkan potongan lama", clearError);
    return NextResponse.json({ error: clearError.message }, { status: 500 });
  }

  // Dimasukkan bertahap: satu insert berisi ribuan baris melewati batas ukuran
  // request PostgREST, dan yang gagal begitu gagal seluruhnya.
  const BATCH = 500;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const rows = chunks.slice(i, i + BATCH).map((chunk) => ({
      doc_id: docId,
      ord: chunk.ord,
      heading: chunk.heading,
      page: chunk.page,
      content: chunk.content,
    }));

    const { error } = await service.from("standard_chunks").insert(rows);

    if (error) {
      console.error("[api/admin/standards] gagal menyimpan potongan", error);
      // Dokumen yang separuh terisi lebih buruk daripada dokumen yang tidak
      // ada: ia bisa dicari, dan yang tidak ditemukan di dalamnya terbaca
      // sebagai standar yang tidak mengatur hal itu. Jadi sisanya dibuang.
      await service.from("standard_chunks").delete().eq("doc_id", docId);
      return NextResponse.json(
        { error: `gagal menyimpan potongan (${error.message}) — dokumen dibatalkan` },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({
    ok: true,
    docId,
    chunks: chunks.length,
    pages: chunks.some((c) => c.page !== null)
      ? Math.max(...chunks.map((c) => c.page ?? 0))
      : null,
  });
}

/** GET — dokumen apa saja yang ada di korpus, beserta jumlah potongannya. */
export async function GET() {
  const gate = await requireGlobalAdmin();
  if (gate.error) return gate.error;

  const { data, error } = await gate.service
    .from("standard_docs")
    .select("id, code, title, edition, note, created_at, standard_chunks(count)")
    .order("code");

  if (error) {
    console.error("[api/admin/standards] gagal membaca daftar", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const docs = (data ?? []).map((row) => {
    const doc = row as Record<string, unknown> & {
      standard_chunks?: { count?: number }[];
    };
    return {
      id: doc.id,
      code: doc.code,
      title: doc.title,
      edition: doc.edition,
      note: doc.note,
      created_at: doc.created_at,
      chunks: doc.standard_chunks?.[0]?.count ?? 0,
    };
  });

  return NextResponse.json({ docs });
}

/**
 * DELETE — sebuah dokumen keluar dari korpus, beserta potongannya.
 *
 * Potongannya ikut lewat `on delete cascade` di migrasi 0013, bukan lewat dua
 * penghapusan di sini: penghapusan kedua yang gagal meninggalkan potongan tanpa
 * dokumen, dan potongan tanpa dokumen tidak bisa dikutip tapi tetap bisa
 * ditemukan pencarian.
 */
export async function DELETE(req: Request) {
  const gate = await requireGlobalAdmin();
  if (gate.error) return gate.error;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "`id` wajib diisi" }, { status: 400 });

  const { error } = await gate.service.from("standard_docs").delete().eq("id", id);

  if (error) {
    console.error("[api/admin/standards] gagal menghapus dokumen", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
