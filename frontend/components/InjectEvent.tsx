"use client";

import { useRef, useState, useEffect } from "react";
import { injectEvent, stepWorld, BabelSettings } from "@/lib/api";
import { useLocale } from "@/lib/locale-context";
import { ExpandableInput } from "./ui";

interface InjectEventProps {
  sessionId: string;
  settings: BabelSettings;
  disabled?: boolean;
}

export default function InjectEvent({ sessionId, settings, disabled }: InjectEventProps) {
  const [content, setContent] = useState("");
  const [processing, setProcessing] = useState(false);
  const [flash, setFlash] = useState<"ok" | "err" | false>(false);
  const { t } = useLocale();
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const queueRef = useRef<string[]>([]);
  const processingRef = useRef(false);

  useEffect(() => () => clearTimeout(flashTimerRef.current), []);

  async function processQueue() {
    if (processingRef.current || disabled) return;
    processingRef.current = true;
    setProcessing(true);

    try {
      while (queueRef.current.length > 0) {
        const nextContent = queueRef.current.shift();
        if (!nextContent) continue;

        try {
          await injectEvent(sessionId, nextContent);
          setFlash("ok");
          clearTimeout(flashTimerRef.current);
          flashTimerRef.current = setTimeout(() => setFlash(false), 400);
          // Auto-step so agents react to the injected event.
          try {
            await stepWorld(sessionId, {
              model: settings.model || undefined,
              api_key: settings.apiKey || undefined,
              api_base: settings.apiBase || undefined,
            });
          } catch {
            // Step failed but injection succeeded — keep the input usable.
          }
        } catch {
          setFlash("err");
          clearTimeout(flashTimerRef.current);
          flashTimerRef.current = setTimeout(() => setFlash(false), 1200);
        }
      }
    } finally {
      processingRef.current = false;
      setProcessing(false);
      inputRef.current?.focus();
    }
  }

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (disabled) return;

    const trimmed = content.trim();
    if (!trimmed) return;

    queueRef.current.push(trimmed);
    setContent("");
    inputRef.current?.focus();
    void processQueue();
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2 px-4 py-3 border-t border-b-DEFAULT bg-surface-1" aria-label={t("inject")}>
      <span
        className="inline-flex h-9 items-center text-micro text-t-dim tracking-widest select-none shrink-0"
        aria-hidden="true"
      >
        {"// INJECT"}
      </span>
      <div className="flex-1 relative">
        <ExpandableInput
          inputRef={inputRef}
          value={content}
          onValueChange={setContent}
          placeholder={t("inject_placeholder")}
          aria-label={t("inject_placeholder")}
          maxLength={2000}
          disabled={disabled}
          className={`w-full h-9 px-3 bg-void border text-detail text-t-DEFAULT normal-case tracking-normal focus:border-primary focus:outline-none hover:border-b-hover transition-[colors,box-shadow] disabled:opacity-40 disabled:cursor-not-allowed ${
            flash === "ok" ? "border-primary shadow-[0_0_12px_var(--color-primary-glow-strong)]" : flash === "err" ? "border-danger shadow-[0_0_12px_var(--color-danger-glow)]" : "border-b-DEFAULT"
          }`}
          style={flash === "err" ? { animation: "crt-glitch 300ms ease both" } : undefined}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSubmit();
            }
          }}
        />
      </div>
      <button
        type="submit"
        disabled={disabled || !content.trim()}
        title={disabled ? t("sim_running_hint") : !content.trim() ? t("inject_empty_hint") : undefined}
        className={`h-9 px-4 text-micro font-medium tracking-wider border active:scale-[0.97] transition-[colors,box-shadow,transform] disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none shrink-0 ${
          content.trim()
            ? "bg-primary text-void border-primary hover:bg-transparent hover:text-primary hover:shadow-[0_0_16px_var(--color-primary-glow-strong)]"
            : "border-b-DEFAULT text-t-muted hover:border-primary hover:text-primary hover:shadow-[0_0_12px_var(--color-primary-glow)]"
        }`}
      >
        <span aria-live="polite">
          {flash === "err" ? t("inject_failed") : !content.trim() && processing ? t("sending") : t("inject")}
        </span>
      </button>
    </form>
  );
}
