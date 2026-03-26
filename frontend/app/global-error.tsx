"use client";

import { useEffect, useState } from "react";
import type { Locale } from "@/lib/i18n";

const LABELS: Record<string, Record<Locale, string>> = {
  system_error: { cn: "// 系统错误", en: "// SYSTEM ERROR" },
  unexpected: { cn: "发生了意外错误", en: "An unexpected error occurred" },
  retry: { cn: "重试", en: "RETRY" },
  home: { cn: "首页", en: "HOME" },
};

function t(key: string, locale: Locale) {
  return LABELS[key]?.[locale] ?? key;
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [locale, setLocale] = useState<Locale>("cn");

  useEffect(() => {
    try {
      const stored = localStorage.getItem("babel_locale");
      if (stored === "en" || stored === "cn") setLocale(stored);
    } catch { /* SSR / no localStorage */ }
  }, []);

  return (
    <html lang={locale === "cn" ? "zh-CN" : "en"}>
      <body className="m-0 bg-void text-t-DEFAULT font-mono">
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6">
          <div className="text-micro tracking-widest text-t-dim uppercase">
            {t("system_error", locale)}
          </div>
          <div className="text-detail text-danger max-w-[400px] text-center normal-case tracking-normal">
            {error.message || t("unexpected", locale)}
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={reset}
              className="h-9 px-5 text-micro font-mono tracking-wider uppercase bg-primary text-void border border-primary cursor-pointer hover:bg-transparent hover:text-primary hover:shadow-[0_0_16px_var(--color-primary-glow-strong)] active:scale-[0.97] transition-[colors,box-shadow,transform]"
            >
              {t("retry", locale)}
            </button>
            <a
              href="/"
              className="h-9 px-5 text-micro font-mono tracking-wider uppercase bg-transparent text-t-muted border border-surface-3 cursor-pointer inline-flex items-center no-underline hover:border-primary hover:text-primary active:scale-[0.97] transition-[colors,transform]"
            >
              {t("home", locale)}
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
