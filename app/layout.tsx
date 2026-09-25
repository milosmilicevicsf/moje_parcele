import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Moje parcele · Teren",
  description: "Granice parcele, GPS položaj i mapa za teren bez mreže.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="sr-Latn">
      <body className="antialiased">{children}</body>
    </html>
  );
}
