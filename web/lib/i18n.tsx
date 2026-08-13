"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import id from "@/messages/id.json";
import en from "@/messages/en.json";
import { DEFAULT_LOCALE, type Locale } from "@/lib/locale";

const dictionaries: Record<Locale, unknown> = { id, en };

// Diteruskan supaya yang sudah mengimpor `Locale` dari sini tidak perlu ikut
// berpindah. Sumbernya sekarang `lib/locale`, yang bisa dibaca route handler
// tanpa menyeret React dan kedua kamus ke bundel server.
export type { Locale };

const STORAGE_KEY = "locale";

type Ctx = { locale: Locale; t: (key: string) => string; setLocale: (l: Locale) => void };
const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  // Render pertama selalu bahasa bawaan — sama di server dan di browser, jadi
  // tidak ada hydration mismatch. Pilihan yang tersimpan dipasang setelahnya.
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "id" || saved === "en") setLocaleState(saved);
  }, []);

  // Tanpa ini pilihan bahasa hilang setiap kali halaman dimuat ulang, dan
  // pengguna berbahasa Inggris harus menekan tombolnya lagi setiap kunjungan.
  const setLocale = (next: Locale) => {
    setLocaleState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  };

  // Kunci yang berhenti di tengah sarang mengembalikan kuncinya sendiri, bukan
  // objek. Yang memanggil `t()` menaruh hasilnya langsung ke JSX, dan sebuah
  // objek di sana bukan teks yang aneh — itu halaman yang gagal dirender.
  const t = (key: string) => {
    const parts = key.split(".");
    let cur: any = dictionaries[locale];
    for (const p of parts) cur = cur?.[p];
    return typeof cur === "string" ? cur : key;
  };

  return <I18nContext.Provider value={{ locale, t, setLocale }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n harus dipakai di dalam I18nProvider");
  return ctx;
}
