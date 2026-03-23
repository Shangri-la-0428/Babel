"use client";

import { useRef, useState } from "react";
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim() || sending) return;

    setSending(true);
    try {
      await injectEvent(sessionId, content.trim());
      setContent("");
      setFlash("ok");
      setTimeout(() => setFlash(false), 600);
      // Auto-step so agents react to the injected event
      await stepWorld(sessionId, {
        model: settings.model || undefined,
        api_key: settings.apiKey || undefined,
        api_base: settings.apiBase || undefined,
      });
    } catch {
      setFlash("err");
      setTimeout(() => setFlash(false), 1200);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 px-4 py-3 border-t border-b-DEFAULT bg-surface-1" aria-label={t("inject")}>
      <input
        ref={inputRef}
        type="text"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={t("inject_placeholder")}
        aria-label={t("inject_placeholder")}
        disabled={disabled || sending}
        className={`flex-1 h-9 px-3 bg-void border text-detail text-t-DEFAULT normal-case tracking-normal focus:border-primary focus:outline-none hover:border-b-hover transition-[colors,box-shadow] disabled:opacity-30 ${
          flash === "ok" ? "border-primary shadow-[0_0_12px_var(--color-primary-glow-strong)]" : flash === "err" ? "border-danger shadow-[0_0_12px_var(--color-danger-glow)]" : "border-b-DEFAULT"
        }`}
      />
      <button
        type="submit"
        disabled={disabled || sending || !content.trim()}
        className="h-9 px-4 text-micro tracking-wider border border-b-DEFAULT text-t-muted hover:border-primary hover:text-primary hover:shadow-[0_0_12px_var(--color-primary-glow)] active:scale-[0.97] transition-[colors,box-shadow,transform] disabled:opacity-30 disabled:pointer-events-none"
      >
        <span aria-live="polite">
          {sending ? t("sending") : flash === "err" ? t("inject_failed") : t("inject")}
        </span>
      </button>
    </form>
  );
}
