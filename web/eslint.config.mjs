import next from "eslint-config-next/core-web-vitals";

// Flat config: ESLint 9 tidak lagi membaca `.eslintrc.json`, dan `next lint`
// sendiri sudah dihapus di Next 16 — jadi CI memanggil `eslint` langsung.
// eslint-config-next v16 sudah menerbitkan flat config, jadi tidak perlu
// lapisan kompatibilitas apa pun.
const config = [
  {
    ignores: [".next/**", "public/sw.js", "next-env.d.ts"],
  },

  ...(Array.isArray(next) ? next : [next]),

  {
    rules: {
      // Diturunkan jadi peringatan, bukan dimatikan.
      //
      // Aturan ini baru ikut sejak eslint-config-next 16 dan menandai pola yang
      // sudah ada di sini sejak awal: memilih proyek pertama begitu daftarnya
      // datang, mengosongkan daftar ruangan saat proyek berganti, dan membaca
      // pilihan bahasa dari localStorage setelah mount. Yang terakhir memang
      // harus di dalam efek — render pertama wajib sama antara server dan
      // browser, kalau tidak hydration-nya bentrok.
      //
      // Sisanya bisa diubah jadi nilai turunan, tapi itu menyentuh alur state
      // CommandRunner — halaman utama aplikasi ini — dan pekerjaan itu layak
      // punya PR sendiri yang bisa diuji di preview, bukan menumpang di sini.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
];

export default config;
