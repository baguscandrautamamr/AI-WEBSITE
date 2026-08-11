"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { areaOfPath, canOpen, landingFor, type AccessClass } from "@/lib/access";
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
  children,
}: {
  access: AccessClass;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const pathname = usePathname();

  const area = areaOfPath(pathname);
  if (!area || canOpen(access, area)) return <>{children}</>;

  return (
    <div className="glass-panel space-y-3 p-6">
      <h1 className="text-lg font-medium">{t("access.deniedTitle")}</h1>
      <p className="text-sm text-text-secondary">
        {t(access === "standard_only" ? "access.standardOnly" : "access.noStandard")}
      </p>
      <Link href={landingFor(access)} className="btn-accent inline-block">
        {t("access.goHome")}
      </Link>
    </div>
  );
}
