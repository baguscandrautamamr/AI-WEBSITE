/**
 * Tanda pengenal aplikasi ini, seukuran tanda pengenal.
 *
 * Ikon PNG di `public/icons` adalah untuk layar utama telepon: di dalam halaman
 * ia selalu berupa gambar yang harus diunduh, dan pada ukuran kecil ia selalu
 * terlihat lunak. Ini SVG sebaris — tajam pada ukuran berapa pun, tanpa satu pun
 * permintaan jaringan, dan warnanya mengikuti aksen tema.
 *
 * Kilatnya menempati sekitar 56% sisi ubinnya. Itu bukan angka selera: ikon
 * lamanya memakai hampir seluruh bidang tanpa ruang kosong sama sekali, dan pada
 * pratinjau tautan atau di daftar aplikasi ia jadi satu blok biru dengan kilat
 * yang tampak terlalu besar untuk kotaknya.
 */
export default function BrandMark({ size = 32 }: { size?: number }) {
  const bolt = Math.round(size * 0.56);

  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, borderRadius: size * 0.28 }}
      className="inline-flex shrink-0 items-center justify-center bg-accent shadow-[0_1px_2px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.28)]"
    >
      <svg
        viewBox="0 0 24 24"
        width={bolt}
        height={bolt}
        fill="#fff"
        role="presentation"
        focusable="false"
      >
        <path d="M13.9 2 5.4 13.7h4.9L9.1 22l8.5-11.7h-4.9z" />
      </svg>
    </span>
  );
}
