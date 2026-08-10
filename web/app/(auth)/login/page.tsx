"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import { APP_NAME } from "@/lib/brand";
import BrandMark from "@/app/BrandMark";

type Mode = "signin" | "signup";

export default function LoginPage() {
  const { t } = useI18n();
  const router = useRouter();
  // Klien dibuat di dalam handler, bukan di sini: badan komponen ini ikut
  // dijalankan saat prerender, dan membuat klien di situ membuat build gagal
  // total begitu env var Supabase belum terpasang.
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Menyambung kembali sesi yang access token-nya sudah kedaluwarsa.
  //
  // Server Component tidak bisa menulis cookie, jadi token yang lewat masa
  // berlakunya membuat halaman dashboard menganggap orangnya belum login dan
  // melemparnya ke sini. Refresh token-nya masih ada di cookie: klien browser
  // menukarnya jadi sesi baru dan menuliskannya kembali, jadi yang dialami
  // pengguna cuma satu kedipan — bukan disuruh mengetik sandi lagi.
  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    let cancelled = false;

    (async () => {
      try {
        const { data } = await createClient().auth.getSession();
        if (!cancelled && data.session) {
          router.replace("/electrical");
          router.refresh();
        }
      } catch {
        // Tidak ada sesi untuk dipulihkan — form di bawah yang mengambil alih.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);

    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch (err) {
      setLoading(false);
      return setError(err instanceof Error ? err.message : String(err));
    }

    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setLoading(false);
      if (error) return setError(error.message);
      router.push("/electrical");
      router.refresh();
      return;
    }

    // full_name dititipkan ke user metadata; trigger handle_new_web_user
    // membacanya saat membuat baris `users` pasangannya.
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName || undefined } },
    });
    setLoading(false);
    if (error) return setError(error.message);

    // Kalau konfirmasi email menyala, belum ada sesi — jangan arahkan ke
    // dashboard, nanti ditendang balik oleh layout.
    if (!data.session) {
      setNotice(t("auth.checkEmail"));
      setMode("signin");
      return;
    }
    router.push("/electrical");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-5">
      {/* Satu kolom sempit, ditengahkan.
          Ini satu-satunya halaman yang dilihat orang sebelum masuk, dan yang
          dibutuhkannya cuma tiga hal: nama sistemnya, dua kolom, satu tombol. */}
      <form
        onSubmit={handleSubmit}
        className="glass-panel w-full max-w-[21rem] space-y-4 p-6 sm:p-7"
      >
        {/* Nama sistemnya lebih dulu, baru "Masuk".
            Sebelumnya halaman ini tidak menyebutkan sedang masuk ke apa — sebuah
            kotak sandi tanpa nama, yang pada tautan yang dikirim lewat pesan
            terlihat persis seperti halaman yang tidak pantas dipercaya.

            Tandanya kecil, 34 piksel, sebaris dengan namanya. Logo sebesar
            separuh kartu tidak menambah satu keterangan pun; yang perlu dikenali
            di layar sekecil telepon adalah namanya. */}
        <div className="flex items-center gap-2.5">
          <BrandMark size={34} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium leading-tight">{APP_NAME}</p>
            <p className="text-xs text-text-secondary">
              {mode === "signin" ? t("auth.login") : t("auth.register")}
            </p>
          </div>
        </div>

        {/* Terlihat sebelum tombol ditekan: tanpa ini, deploy yang env var-nya
            belum terpasang hanya memberi kegagalan tanpa sebab saat submit. */}
        {!isSupabaseConfigured() && (
          <p className="text-sm text-red-500">{t("auth.notConfigured")}</p>
        )}

        <div className="space-y-2">
          {mode === "signup" && (
            <input
              className="glass-input w-full"
              type="text"
              placeholder={t("auth.fullName")}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoComplete="name"
            />
          )}

          <input
            className="glass-input w-full"
            type="email"
            placeholder={t("auth.email")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
          <input
            className="glass-input w-full"
            type="password"
            placeholder={t("auth.password")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            minLength={6}
            required
          />
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}
        {notice && <p className="text-sm text-emerald-600">{notice}</p>}

        <button type="submit" disabled={loading} className="btn-accent w-full">
          {loading ? t("common.loading") : mode === "signin" ? t("auth.login") : t("auth.register")}
        </button>

        <button
          type="button"
          className="w-full text-center text-xs text-text-secondary hover:text-[var(--text-primary)]"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
            setNotice(null);
          }}
        >
          {mode === "signin" ? t("auth.needAccount") : t("auth.haveAccount")}
        </button>

        {mode === "signup" && (
          <p className="text-xs leading-relaxed text-text-secondary">{t("auth.accessNote")}</p>
        )}
      </form>
    </main>
  );
}
