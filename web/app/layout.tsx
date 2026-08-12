import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import { I18nProvider } from "@/lib/i18n";
import { APP_NAME } from "@/lib/brand";
import ServiceWorker from "./ServiceWorker";
import "./globals.css";

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Platform AI untuk kontrol Revit khusus electrical",
  manifest: "/manifest.json",
};

export const viewport = {
  themeColor: "#0071e3",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          <I18nProvider>{children}</I18nProvider>
        </ThemeProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
