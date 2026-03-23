"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { Locale, TransKey, detectLocale, setLocale as persistLocale, t as translate } from "./i18n";

interface LocaleCtx {
  locale: Locale;
  toggle: () => void;
  t: (key: TransKey, ...args: string[]) => string;
}

const Ctx = createContext<LocaleCtx>({
  locale: "cn",
  toggle: () => {},
  t: (key) => key,
});

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(detectLocale);

  const toggle = useCallback(() => {
    setLocale((prev) => {
      const next = prev === "cn" ? "en" : "cn";
      persistLocale(next);
      return next;
    });
  }, []);

  const t = useCallback((key: TransKey, ...args: string[]) => translate(key, locale, ...args), [locale]);

  return <Ctx.Provider value={{ locale, toggle, t }}>{children}</Ctx.Provider>;
}

export function useLocale() {
  return useContext(Ctx);
}
