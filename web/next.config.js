// Tidak ada plugin PWA di sini lagi.
//
// `next-pwa@5.6.0` dulu membungkus config ini. Paket itu berhenti dipelihara
// sebelum App Router ada dan menyuntikkan plugin dari salinan webpack-nya
// sendiri ke setiap compiler — termasuk compiler edge, yang membuat mock
// `__dirname` milik Next hilang dan setiap URL membalas 500
// MIDDLEWARE_INVOCATION_FAILED (lihat README). Penggantinya `public/sw.js`
// yang ditulis tangan dan didaftarkan `app/ServiceWorker.tsx`: tidak menyentuh
// proses build sama sekali.
//
// Tidak ada konfigurasi `images`: `next/image` tidak dipakai di mana pun, dan
// yang ada sebelumnya memakai `images.domains` yang sudah deprecated. Kalau
// nanti butuh, pakai `remotePatterns`.
module.exports = {
  reactStrictMode: true,
};
