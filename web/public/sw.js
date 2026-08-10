/*
 * Service worker, ditulis tangan.
 *
 * Sebelumnya file ini dihasilkan `next-pwa@5.6.0` — paket yang berhenti
 * dipelihara sebelum App Router ada, dan yang menyuntikkan plugin dari salinan
 * webpack-nya sendiri ke setiap compiler. Itu tersangka utama crash
 * MIDDLEWARE_INVOCATION_FAILED yang membuat setiap URL membalas 500 (lihat
 * README), dan selama ia terpasang, `middleware.ts` tidak bisa dihidupkan lagi.
 *
 * Yang dibutuhkan aplikasi ini dari sebuah service worker cuma dua: bisa
 * dipasang di layar utama HP, dan aset statisnya tidak diunduh ulang setiap
 * kali. Keduanya muat dalam file ini, tanpa satu pun dependensi build — jadi
 * upgrade Next berikutnya tidak bisa merusaknya.
 */

// Dinaikkan bersama setiap perubahan pada berkas statis yang disimpan di sini.
// manifest.json termasuk yang disimpan, dan nama aplikasinya ada di dalamnya —
// tanpa versi baru, telepon yang sudah memasang aplikasi ini akan terus
// menyebutnya dengan nama yang lama.
const VERSION = "v4";
const STATIC_CACHE = `electrical-ai-static-${VERSION}`;

/** Aset ber-hash dari Next dan ikon PWA: isinya tidak pernah berubah per URL. */
function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.json"
  );
}

self.addEventListener("install", (event) => {
  // Tidak ada yang di-precache: daftar aset akan berubah setiap build, dan
  // daftar yang basi berarti halaman putih setelah deploy. Cache diisi dari
  // lalu lintas yang benar-benar terjadi.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Cache versi lama dibuang, kalau tidak ia menumpuk selamanya di HP orang.
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("electrical-ai-") && !name.endsWith(VERSION))
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Hanya origin sendiri. Supabase, Cloudinary, dan gateway AI dibiarkan lewat
  // apa adanya — semuanya memakai autentikasi dan tidak ada yang boleh disimpan.
  if (url.origin !== self.location.origin) return;

  // /api/ TIDAK PERNAH di-cache. Di situlah status perintah dipolling; jawaban
  // "pending" yang tersimpan berarti halaman menunggu selamanya sesuatu yang
  // sebenarnya sudah selesai.
  if (url.pathname.startsWith("/api/")) return;

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
  }

  // Halaman TIDAK di-cache sama sekali.
  //
  // Setiap halaman dashboard dirender di server dengan sesi orang yang membuka
  // — nama proyeknya, perannya, isi riwayatnya. Menyimpannya berarti satu
  // salinan halaman milik seseorang tersimpan di perangkat itu, dan orang
  // berikutnya yang memakai browser yang sama bisa menerimanya kembali saat
  // jaringannya putus. Untung dari halaman yang tetap terbuka saat offline
  // tidak sebanding dengan itu; aset statis yang ber-hash tetap di-cache dan
  // itulah yang membuat aplikasi ini terasa cepat.
});

/** URL-nya sudah menentukan isinya, jadi yang tersimpan selalu benar. */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}
