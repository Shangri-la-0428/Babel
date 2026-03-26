"use client";

import { useLocale } from "@/lib/locale-context";

export default function PageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // useLocale is safe here — error.tsx is inside the layout,
  // so LocaleProvider is still mounted.
  const { t } = useLocale();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-void">
      <div className="text-micro text-t-dim tracking-widest">{"// ERROR"}</div>
      <div className="text-detail text-danger normal-case tracking-normal max-w-md text-center">
        {error.message || t("failed_load")}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="h-9 px-5 text-micro font-medium tracking-wider bg-primary text-void border border-primary hover:bg-transparent hover:text-primary hover:shadow-[0_0_16px_var(--color-primary-glow-strong)] active:scale-[0.97] transition-[colors,box-shadow,transform]"
        >
          {t("retry")}
        </button>
        <a
          href="/"
          className="h-9 px-5 text-micro font-medium tracking-wider border border-b-DEFAULT text-t-muted hover:border-primary hover:text-primary active:scale-[0.97] transition-[colors,transform] inline-flex items-center"
        >
          {t("home")}
        </a>
      </div>
    </div>
  );
}
