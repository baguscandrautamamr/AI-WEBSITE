"use client";

import { useRef } from "react";
import { useI18n } from "@/lib/i18n";
import {
  IMAGE_TYPES,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  type ImageType,
} from "@/lib/imageInput";

/** Satu gambar yang sudah siap dikirim, plus bentuk kecilnya untuk ditampilkan. */
export interface Attachment {
  id: string;
  name: string;
  /** `data:image/jpeg;base64,…` — untuk <img>, bukan untuk dikirim. */
  preview: string;
  media_type: ImageType;
  /** base64 murni, yang benar-benar berangkat ke model. */
  data: string;
}

/**
 * Sisi panjang gambar setelah dikecilkan.
 *
 * Foto telepon zaman ini 4000 piksel lebih dan berukuran 5–10 MB. Dikirim apa
 * adanya, ia ditolak batas ukuran — dan kalaupun lolos, tiap piksel di atas
 * batas resolusi model dibayar tanpa menambah apa pun yang terbaca. 1600 cukup
 * untuk membaca papan nama panel dan tulisan di gambar kerja.
 */
const MAX_EDGE = 1600;

/** Mutu JPEG hasil pengecilan. Di bawah ini, tulisan kecil mulai berbulu. */
const QUALITY = 0.85;

/**
 * Mengecilkan gambar di browser, sebelum satu byte pun dikirim.
 *
 * Di sini, bukan di server: yang paling mahal dari sebuah foto 8 MB adalah
 * perjalanannya lewat jaringan telepon, dan itu sudah terjadi kalau
 * pengecilannya menunggu sampai di server.
 *
 * Hasilnya selalu JPEG. PNG hasil tangkapan layar pun ikut — sebuah tangkapan
 * layar 2 MB menjadi ratusan kilobyte tanpa ada tulisan yang jadi tidak
 * terbaca, dan yang dibaca model adalah gambarnya, bukan berkasnya.
 */
async function shrink(file: File): Promise<{ preview: string; data: string }> {
  const bitmap = await createImageBitmap(file);

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);

  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas tidak tersedia");

  // Latar putih dulu: PNG dan WebP boleh transparan, dan transparansi yang
  // diratakan ke JPEG menjadi HITAM — tangkapan layar bertulisan gelap berubah
  // jadi kotak hitam yang tidak terbaca siapa pun, model termasuk.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const preview = canvas.toDataURL("image/jpeg", QUALITY);
  return { preview, data: preview.slice(preview.indexOf(",") + 1) };
}

/**
 * Tombol lampirkan gambar, dan deretan gambar yang sudah dipilih.
 *
 * Dipisah dari halaman Standar karena isinya bukan urusan percakapan: membaca
 * berkas, mengecilkannya, dan menolak yang tidak bisa dibaca model.
 */
export function AttachButton({
  disabled,
  count,
  onAdd,
  onError,
}: {
  disabled?: boolean;
  count: number;
  onAdd: (items: Attachment[]) => void;
  onError: (message: string) => void;
}) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);

  const full = count >= MAX_IMAGES;

  async function pick(files: FileList | null) {
    if (!files || files.length === 0) return;

    const room = MAX_IMAGES - count;
    if (files.length > room) {
      onError(t("standard.imageMax").replace("{n}", String(MAX_IMAGES)));
    }

    const accepted: Attachment[] = [];

    for (const file of Array.from(files).slice(0, room)) {
      if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) {
        onError(t("standard.imageType"));
        continue;
      }

      try {
        const { preview, data } = await shrink(file);

        // Diperiksa SESUDAH dikecilkan, bukan sebelum: yang menentukan bukan
        // besar berkas aslinya melainkan apa yang benar-benar dikirim, dan
        // menolak foto 6 MB yang akan menjadi 300 KB itu menolak tanpa sebab.
        if (Math.floor((data.length * 3) / 4) > MAX_IMAGE_BYTES) {
          onError(t("standard.imageTooBig"));
          continue;
        }

        accepted.push({
          id: `${file.name}-${Date.now()}-${accepted.length}`,
          name: file.name,
          preview,
          media_type: "image/jpeg",
          data,
        });
      } catch {
        onError(t("standard.imageUnreadable").replace("{name}", file.name));
      }
    }

    if (accepted.length > 0) onAdd(accepted);

    // Dikosongkan supaya berkas yang SAMA bisa dipilih lagi setelah dihapus —
    // tanpa ini, input file tidak memicu change untuk nilai yang tidak berubah.
    if (input.current) input.current.value = "";
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept={IMAGE_TYPES.join(",")}
        multiple
        className="hidden"
        onChange={(e) => pick(e.target.files)}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={disabled || full}
        title={full ? t("standard.imageMax").replace("{n}", String(MAX_IMAGES)) : t("standard.attach")}
        aria-label={t("standard.attach")}
        className="glass-input shrink-0 px-3 py-2 text-base leading-none disabled:opacity-40"
      >
        📎
      </button>
    </>
  );
}

/** Gambar-gambar yang menunggu dikirim, masing-masing bisa dibatalkan. */
export function AttachmentStrip({
  items,
  onRemove,
}: {
  items: Attachment[];
  onRemove: (id: string) => void;
}) {
  const { t } = useI18n();

  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <div key={item.id} className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL dari
              berkas pengguna; next/image butuh URL yang bisa diambil server. */}
          <img
            src={item.preview}
            alt={item.name}
            className="h-16 w-16 rounded-xl object-cover"
          />
          <button
            type="button"
            onClick={() => onRemove(item.id)}
            aria-label={t("standard.imageRemove")}
            title={t("standard.imageRemove")}
            className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full bg-black/70 text-xs leading-5 text-white"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
