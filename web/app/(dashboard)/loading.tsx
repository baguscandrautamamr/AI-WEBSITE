/**
 * Kerangka yang tampil seketika saat pindah halaman.
 *
 * Setiap halaman dashboard dirender dinamis (butuh sesi), jadi tanpa file ini
 * klik menu terasa menggantung: tidak ada yang berubah di layar sampai server
 * selesai. Kerangka ini membuat perpindahan terasa langsung — nav-nya sudah
 * berganti sorot dan isinya jelas sedang dimuat.
 */
export default function DashboardLoading() {
  return (
    <div className="max-w-4xl space-y-4" aria-busy="true">
      <div className="glass-panel space-y-4 p-6">
        <div className="h-5 w-48 animate-pulse rounded-lg bg-black/10 dark:bg-white/10" />
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-9 w-32 animate-pulse rounded-xl bg-black/5 dark:bg-white/5"
            />
          ))}
        </div>
      </div>
      <div className="glass-panel space-y-3 p-6">
        <div className="h-4 w-64 animate-pulse rounded-lg bg-black/10 dark:bg-white/10" />
        <div className="h-4 w-40 animate-pulse rounded-lg bg-black/5 dark:bg-white/5" />
      </div>
    </div>
  );
}
