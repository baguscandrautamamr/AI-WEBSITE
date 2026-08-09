"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import id from "@/messages/id.json";
import en from "@/messages/en.json";

const dictionaries = { id, en } as const;
export type Locale = keyof typeof dictionaries;

type Ctx = { locale: Locale; t: (key: string) => string; setLocale: (l: Locale) => void };
const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>("id");

  const t = (key: string) => {
    const parts = key.split(".");
    let cur: any = dictionaries[locale];
    for (const p of parts) cur = cur?.[p];
    return cur ?? key;
  };

  return <I18nContext.Provider value={{ locale, t, setLocale }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n harus dipakai di dalam I18nProvider");
  return ctx;
}
