"use client";

import { useRef, useState, useEffect } from "react";
import { injectEvent, stepWorld, BabelSettings } from "@/lib/api";
import { useLocale } from "@/lib/locale-context";

interface InjectEventProps {
  sessionId: string;
  settings: BabelSettings;
  disabled?: boolean;
}

export default function InjectEvent({ sessionId, settings, disabled }: InjectEventProps) {
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [flash, setFlash] = useState<"ok" | "err" | false>(false);
  const { t } = useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(flashTimerRef.current), []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim() || sending) return;

    setSending(true);
    try {
      await injectEvent(sessionId, content.trim());
      setContent("");
      setFlash("ok");
      clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setFlash(false), 600);
      // Auto-step so agents react to the injected event
      try {
        await stepWorld(sessionId, {
          model: settings.model || undefined,
          api_key: settings.apiKey || undefined,
          api_base: settings.apiBase || undefined,
        });
      } catch {
        // Step failed but injection succeeded — don't show error flash
      }
    } catch {
      setFlash("err");
      clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setFlash(false), 1200);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 px-4 py-3 border-t border-b-DEFAULT bg-surface-1" aria-label={t("inject")}>
      <span className="text-micro text-t-dim tracking-widest select-none shrink-0" aria-hidden="true">{"// INJECT"}</span>
      <div className="flex-1 relative">
        <input
          ref={inputRef}
          type="text"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={t("inject_placeholder")}
          aria-label={t("inject_placeholder")}
          maxLength={2000}
          disabled={disabled || sending}
          className={`w-full h-9 px-3 bg-void border text-detail text-t-DEFAULT normal-case tracking-normal focus:border-primary focus:outline-none hover:border-b-hover transition-[colors,box-shadow] disabled:opacity-40 disabled:cursor-not-allowed ${
            flash === "ok" ? "border-primary shadow-[0_0_12px_var(--color-primary-glow-strong)]" : flash === "err" ? "border-danger shadow-[0_0_12px_var(--color-danger-glow)]" : "border-b-DEFAULT"
          }`}
          style={flash === "err" ? { animation: "crt-glitch 300ms ease both" } : undefined}
        />
        {flash === "ok" && (
          <span className="absolute inset-0 bg-gradient-to-r from-primary/15 to-transparent animate-[transmission-sweep_500ms_cubic-bezier(0.16,1,0.3,1)_both] pointer-events-none" aria-hidden="true" />
        )}
        {sending && (
          <span className="absolute inset-0 bg-gradient-to-r from-primary/10 via-primary/20 to-primary/10 bg-[length:200%_100%] animate-[boot-sweep_700ms_cubic-bezier(0.16,1,0.3,1)_infinite] pointer-events-none" aria-hidden="true" />
        )}
      </div>
      <button
        type="submit"
        disabled={disabled || sending || !content.trim()}
        className={`h-9 px-4 text-micro font-medium tracking-wider border active:scale-[0.97] transition-[colors,box-shadow,transform] disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none ${
          content.trim()
            ? "bg-primary text-void border-primary hover:bg-transparent hover:text-primary hover:shadow-[0_0_16px_var(--color-primary-glow-strong)]"
            : "border-b-DEFAULT text-t-muted hover:border-primary hover:text-primary hover:shadow-[0_0_12px_var(--color-primary-glow)]"
        }`}
      >
        <span aria-live="polite">
          {sending ? t("sending") : flash === "err" ? t("inject_failed") : t("inject")}
        </span>
      </button>
    </form>
  );
}
