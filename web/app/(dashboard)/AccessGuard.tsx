"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { areaOfPath, canOpen, canOpenArea, landingFor, type AccessClass } from "@/lib/access";
import { useI18n } from "@/lib/i18n";

/**
 * Halaman yang tidak termasuk kelas akun ini tidak digambar.
 *
 * Menyaring menu saja tidak cukup: menu itu daftar tautan, dan sebuah alamat
 * tetap bisa diketik di address bar, dibuka dari bookmark, atau dikirim orang
 * lain lewat chat. Yang menyaring menu hanya menghilangkan jalan yang mudah.
 *
 * Kelasnya datang dari layout — sebuah Server Component yang membacanya dari
 * database dengan sesi si pemanggil sendiri — bukan dari state di browser. Jadi
 * yang bisa diubah dari devtools hanyalah apa yang TERLIHAT, dan itu memang
 * bukan penjaganya: yang menjaga adalah pemeriksaan di setiap route API, karena
 * di situlah data dan biaya berada. Komponen ini menjaga supaya orang tidak
 * berhadapan dengan halaman yang setiap tombolnya akan ditolak.
 *
 * Tidak mengalihkan, melainkan menjelaskan. Sebuah pengalihan otomatis membuat
 * alamat yang diketik seseorang lenyap tanpa sebab yang terbaca, dan yang
 * mengetiknya biasanya justru sedang mencari tahu apakah ia punya akses.
 */
export default function AccessGuard({
  access,
  granted,
  children,
}: {
  access: AccessClass;
  /** Admin sudah memasukkan akun ini ke sebuah proyek. */
  granted: boolean;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const pathname = usePathname();

  const area = areaOfPath(pathname);
  if (!area || canOpenArea({ access, granted }, area)) return <>{children}</>;

  /**
   * Dua sebab penolakan, dua kalimat.
   *
   * Kelasnya memang mencakup halaman ini tapi akunnya belum diberi proyek — itu
   * hal yang berbeda dari kelas yang tidak mencakupnya, dan yang harus dilakukan
   * orangnya juga berbeda: bukan minta kelasnya diubah, melainkan minta
   * dimasukkan ke sebuah proyek. Satu kalimat untuk keduanya akan menyuruh
   * separuh pembacanya menanyakan hal yang salah.
   */
  const waiting = canOpen(access, area) && !granted;

  return (
    <div className="glass-panel space-y-3 p-6">
      <h1 className="text-lg font-medium">
        {t(waiting ? "access.waitingTitle" : "access.deniedTitle")}
      </h1>
      <p className="text-sm text-text-secondary">
        {t(
          waiting
            ? "access.waiting"
            : access === "standard_only"
              ? "access.standardOnly"
              : "access.noStandard"
        )}
      </p>
      {/* Tautan "ke halaman yang bisa dibuka" hanya kalau memang ada satu.
          Akun yang menunggu tidak punya, dan tombol yang mengembalikannya ke
          halaman ini lagi cuma memutar orangnya di tempat. */}
      {!waiting && (
        <Link href={landingFor(access)} className="btn-accent inline-block">
          {t("access.goHome")}
        </Link>
      )}
    </div>
  );
}
