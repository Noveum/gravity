import text from "@crm/i18n/translations/en.json";
import { publicOrigin } from "@crm/public-site/metadata";
import type { Metadata } from "next";
import { appearanceBootScript } from "@/components/appearance-boot";
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
        <script>{appearanceBootScript}</script>
      </head>
      <body>{children}</body>
    </html>
  );
}
