import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { JetBrains_Mono, Inter } from "next/font/google";
import SettingsBootstrap from "@/components/SettingsBootstrap";
import { LocaleProvider } from "@/lib/locale-context";
import "./globals.css";

const AmbientVoid = dynamic(() => import("@/components/AmbientVoid"), { ssr: false });

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "BABEL",
  description: "AI-Driven World State Machine",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${jetbrainsMono.variable} ${inter.variable}`}>
      <body className="antialiased min-h-screen">
        <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-boot-screen focus:px-4 focus:py-2 focus:bg-primary focus:text-void focus:text-micro focus:tracking-wider">
          Skip to content
        </a>
        <AmbientVoid />
        <SettingsBootstrap />
        <LocaleProvider>{children}</LocaleProvider>
        <script
          dangerouslySetInnerHTML={{
            __html: `console.log("%c▓▓ BABEL ▓▓%c World State Machine // Online\\n%cSeed + AI Runtime = Emergent Worlds","background:#C0FE04;color:#000;font-weight:bold;padding:4px 12px;font-size:14px;font-family:monospace","color:#C0FE04;font-size:12px;font-family:monospace;padding:4px 0","color:#757575;font-size:11px;font-family:monospace")`,
          }}
        />
      </body>
    </html>
  );
}
