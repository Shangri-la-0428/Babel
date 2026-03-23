"use client";

import { useLocale } from "@/lib/locale-context";
import { TransKey } from "@/lib/i18n";

const LINKS: { href: string; labelKey: TransKey; key: string }[] = [
  { href: "/", labelKey: "home", key: "home" },
  { href: "/create", labelKey: "create", key: "create" },
  { href: "/assets", labelKey: "assets", key: "assets" },
];

interface NavProps {
  activePage: "home" | "create" | "assets";
  showSettings?: boolean;
  onToggleSettings?: () => void;
}

export default function Nav({ activePage, showSettings, onToggleSettings }: NavProps) {
  const { locale, toggle, t } = useLocale();

  return (
    <nav aria-label="Main navigation" className="flex items-center justify-between h-14 px-6 border-b border-b-DEFAULT shrink-0">
      {activePage === "home" ? (
        <span className="font-sans text-subheading font-bold tracking-widest text-primary">BABEL</span>
      ) : (
        <a href="/" className="font-sans text-subheading font-bold tracking-widest text-primary hover:drop-shadow-[0_0_8px_var(--color-primary-glow-strong)] transition-[filter]">BABEL</a>
      )}
      <div className="flex items-center gap-6">
        {LINKS.map((link) =>
          link.key === activePage ? (
            <span key={link.key} className="text-micro text-primary tracking-widest" aria-current="page">
              {t(link.labelKey)}
            </span>
          ) : (
            <a key={link.key} href={link.href} className="text-micro text-t-muted tracking-widest hover:text-t-DEFAULT transition-colors">
              {t(link.labelKey)}
            </a>
          )
        )}
        {onToggleSettings && (
          <button
            onClick={onToggleSettings}
            aria-expanded={showSettings}
            className={`text-micro tracking-widest transition-colors ${
              showSettings ? "text-primary" : "text-t-muted hover:text-t-DEFAULT"
            }`}
          >
            {t("settings")}
          </button>
        )}
        <button
          onClick={toggle}
          className="text-micro text-t-dim tracking-wider border border-surface-3 px-3 py-1 hover:text-t-DEFAULT hover:border-b-hover transition-colors"
          title={t("lang_switch")}
          aria-label={t("lang_switch")}
        >
          {locale === "cn" ? "EN" : "中"}
        </button>
      </div>
    </nav>
  );
}
