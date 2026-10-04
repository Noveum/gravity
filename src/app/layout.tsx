import text from "@crm/i18n/translations/en.json";
import { publicOrigin } from "@crm/public-site/metadata";
import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  metadataBase: new URL(publicOrigin() ?? "http://localhost:3014"),
  title: `${text.brand} · ${text.brandSub}`,
  description: text.actionsSubtitle,
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script>{`try { const t = localStorage.getItem("gravity-theme") || "system"; document.documentElement.dataset.theme = t === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : t; document.documentElement.dataset.density = localStorage.getItem("gravity-density") || "comfortable"; } catch {}`}</script>
      </head>
      <body>{children}</body>
    </html>
  );
}
