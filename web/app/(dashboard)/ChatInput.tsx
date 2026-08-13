"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * Kolom tulis yang tingginya mengikuti isinya.
 *
 * Sebelumnya ini sebuah `<input>` satu baris: pertanyaan panjang — data,
 * rumus, beberapa langkah perhitungan — menggulung ke samping dan yang terlihat
 * hanya potongan terakhirnya. Kalimat yang tidak bisa dibaca ulang sebelum
 * dikirim adalah kalimat yang salah ketiknya baru ketahuan setelah jawabannya
 * datang.
 *
 * Tingginya tetap dibatasi `maxHeight`. Kolom yang tumbuh tanpa batas akan
 * mendorong seluruh percakapan ke luar layar pada tempelan yang panjang, jadi
 * sesudah batas itu isinya digulung di dalam kolomnya sendiri.
 */
export default function ChatInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled,
  // 18rem ≈ dua belas baris: cukup untuk soal yang menyertakan data dan
  // beberapa langkah hitungan. `45vh` yang menang di layar pendek — di telepon
  // dengan papan ketik terbuka, kolom setinggi 18rem tidak menyisakan ruang
  // untuk percakapan yang sedang dijawabnya.
  maxHeight = "min(45vh, 18rem)",
  className = "",
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  /** Batas tinggi sebelum isinya mulai digulung. */
  maxHeight?: string;
  /**
   * Kelas tambahan untuk BARISNYA, bukan untuk kolom teks di dalamnya.
   *
   * Dipakai halaman Standar untuk menyejajarkan kolom tulis dengan kolom baca
   * saat layar penuh: tanpa ini, percakapannya terpusat di tengah sementara
   * kolom tulisnya membentang dari tepi ke tepi di bawahnya.
   */
  className?: string;
  /** Tombol kirim — diletakkan sejajar baris terakhir. */
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // useLayoutEffect, bukan useEffect: tingginya dihitung sebelum browser
  // menggambar, supaya kolomnya tidak terlihat berkedip satu baris setiap kali
  // hurufnya bertambah.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // "auto" dulu — tanpa itu `scrollHeight` tidak pernah mengecil lagi, dan
    // kolom yang sudah tinggi tetap tinggi setelah teksnya dihapus.
    el.style.height = "auto";
    // `scrollHeight` tidak menghitung border, sementara tinggi yang dipasang
    // termasuk border (border-box). Selisihnya diukur, bukan ditebak.
    const border = el.offsetHeight - el.clientHeight;
    el.style.height = `${el.scrollHeight + border}px`;
  }, [value]);

  return (
    // items-end: tombol kirim tetap sejajar baris terakhir saat kolomnya
    // tumbuh, bukan melar setinggi kolom.
    <div className={`flex items-end gap-2 ${className}`}>
      <textarea
        ref={ref}
        rows={1}
        className="glass-input min-w-0 flex-1 resize-none overflow-y-auto"
        style={{ maxHeight }}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // isComposing: pada papan ketik yang menyusun aksara (IME), Enter
          // menutup pilihan kata — bukan mengirim kalimat yang belum jadi.
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
      {children}
    </div>
  );
}
