"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { chatWithOracle, getOracleHistory, OracleMessage, BabelSettings } from "@/lib/api";
import { useLocale } from "@/lib/locale-context";
import { DecodeText } from "./ui";
import { OracleWaveform } from "./OracleWaveform";
import { OracleParticles } from "./OracleParticles";

interface OracleDrawerProps {
  sessionId: string;
  settings: BabelSettings;
  open: boolean;
  onClose: () => void;
  tick: number;
}

const SUGGESTIONS = [
  "oracle_suggest_summary",
  "oracle_suggest_tension",
  "oracle_suggest_inject",
  "oracle_suggest_predict",
] as const;

export default function OracleDrawer({
  sessionId,
  settings,
  open,
  onClose,
  tick,
}: OracleDrawerProps) {
  const { t } = useLocale();
  const [messages, setMessages] = useState<OracleMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [sendCount, setSendCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const latestMsgId = useRef<string | null>(null);
  const sendControllerRef = useRef<AbortController | null>(null);
  const focusTimer = useRef<ReturnType<typeof setTimeout>>();
  const receivedTimer = useRef<ReturnType<typeof setTimeout>>();
  const prevLoadingRef = useRef(false);
  const [waveformState, setWaveformState] = useState<"idle" | "thinking" | "received">("idle");

  // Load conversation history on mount
  useEffect(() => {
    if (!sessionId || historyLoaded) return;
    const controller = new AbortController();
    getOracleHistory(sessionId, 50, controller.signal)
      .then((history) => {
        if (!controller.signal.aborted) {
          // Guard: don't overwrite in-progress messages from optimistic sends
          setMessages((prev) => prev.length > 0 ? prev : history);
          setHistoryLoaded(true);
        }
      })
      .catch(() => { /* history load is best-effort */ });
    return () => { controller.abort(); };
  }, [sessionId, historyLoaded]);

  // Abort in-flight send on unmount + cleanup focus timer
  useEffect(() => {
    return () => {
      sendControllerRef.current?.abort();
      clearTimeout(focusTimer.current);
      clearTimeout(receivedTimer.current);
    };
  }, []);

  // Manage inert attribute — prevents keyboard focus into hidden drawer
  useEffect(() => {
    const el = drawerRef.current;
    if (!el) return;
    if (open) {
      el.removeAttribute("inert");
    } else {
      el.setAttribute("inert", "");
    }
  }, [open]);

  // Auto-scroll on new messages
  useEffect(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [messages, loading]);

  // Focus input when drawer opens
  useEffect(() => {
    if (open) {
      clearTimeout(focusTimer.current);
      focusTimer.current = setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [open]);

  // Track loading → waveform state (idle → thinking → received → idle)
  useEffect(() => {
    if (loading) {
      setWaveformState("thinking");
    } else if (prevLoadingRef.current) {
      setWaveformState("received");
      clearTimeout(receivedTimer.current);
      receivedTimer.current = setTimeout(() => setWaveformState("idle"), 1500);
    }
    prevLoadingRef.current = loading;
  }, [loading]);

  // ESC to close
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && open) {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  const handleSend = useCallback(async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || loading) return;
    setInput("");
    setError(null);

    // Abort any previous in-flight request
    sendControllerRef.current?.abort();
    const controller = new AbortController();
    sendControllerRef.current = controller;

    // Trigger transmission sweep
    setSendCount((c) => c + 1);

    // Optimistic user message
    const userMsg: OracleMessage = {
      id: `tmp-u-${Date.now()}`,
      role: "user",
      content: msg,
      tick,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await chatWithOracle(sessionId, msg, {
        model: settings.model || undefined,
        api_key: settings.apiKey || undefined,
        api_base: settings.apiBase || undefined,
        signal: controller.signal,
      });
      const oracleMsg: OracleMessage = {
        id: res.message_id,
        role: "oracle",
        content: res.reply,
        tick,
        created_at: new Date().toISOString(),
      };
      latestMsgId.current = res.message_id;
      setMessages((prev) => [...prev, oracleMsg]);
    } catch {
      // Check our own signal — fetchWithTimeout converts AbortError to
      // Error("Request timed out"), so name-based checks are unreliable.
      if (!controller.signal.aborted) {
        setError(t("oracle_failed"));
      }
    } finally {
      // Only clear loading if this is still the active request
      if (sendControllerRef.current === controller) {
        setLoading(false);
        sendControllerRef.current = null;
      }
    }
  }, [input, loading, sessionId, settings, tick, t]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    handleSend();
  }, [handleSend]);

  const handleDismissError = useCallback(() => setError(null), []);

  return (
    <div
      ref={drawerRef}
      className={`fixed right-0 top-14 bottom-14 w-[420px] z-overlay flex flex-col bg-void border-l border-info/30 transition-transform duration-200 ease-out-expo oracle-scan-edge ${
        loading ? "animate-oracle-border-pulse oracle-scan-thinking" : ""
      } ${
        open ? "translate-x-0" : "translate-x-full pointer-events-none"
      }`}
      role="complementary"
      aria-label={t("oracle")}
      aria-hidden={!open}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-info/15 bg-surface-1 shrink-0">
        <span className="text-micro text-info tracking-widest drop-shadow-[0_0_8px_rgba(14,165,233,0.3)]">{t("oracle_label")}</span>
        <div className="flex items-center gap-3">
          <span className="text-micro text-info/40 tracking-wider tabular-nums">
            {t("oracle_at_tick")} {String(tick).padStart(3, "0")}
          </span>
          <button
            onClick={onClose}
            className="text-micro text-t-muted hover:text-t-DEFAULT transition-colors tracking-wider"
            aria-label={t("close")}
          >
            {t("close")}
          </button>
        </div>
      </div>

      {/* Signal Waveform */}
      <OracleWaveform state={waveformState} open={open} />

      {/* Messages + Particle Field */}
      <div className="flex-1 min-h-0 relative">
        <OracleParticles thinking={loading} open={open} />
        <div ref={scrollRef} className="h-full overflow-y-auto p-4 flex flex-col gap-4 relative z-[1]" aria-live={historyLoaded ? "polite" : "off"} aria-relevant="additions">
        {messages.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full gap-5">
            {/* Signal lock label — flanked by gradient rules */}
            <div className="flex items-center gap-3 w-full max-w-[320px] opacity-0 animate-fade-in">
              <div className="flex-1 h-px bg-gradient-to-r from-transparent to-info/20" />
              <div className="text-sm text-info tracking-widest drop-shadow-[0_0_16px_rgba(14,165,233,0.45)]">
                {t("oracle_label")}
              </div>
              <div className="flex-1 h-px bg-gradient-to-r from-info/20 to-transparent" />
            </div>
            <div className="text-detail text-t-muted text-center normal-case tracking-normal max-w-[300px] opacity-0 animate-[fade-in_300ms_ease_80ms_both]">
              {t("oracle_empty")}
            </div>
            {/* Suggestion chips — staggered entrance */}
            <div className="flex flex-wrap justify-center gap-2 mt-1">
              {SUGGESTIONS.map((key, i) => (
                <button
                  key={key}
                  onClick={() => handleSend(t(key))}
                  style={{ animationDelay: `${160 + i * 60}ms` }}
                  className="text-micro tracking-wider px-3 py-2 border border-info/20 text-t-muted hover:border-info/40 hover:text-info hover:bg-info/[0.04] active:scale-[0.97] transition-[colors,transform] opacity-0 animate-[fade-in_200ms_ease_both]"
                >
                  {t(key)}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={
              msg.role === "user"
                ? "ml-10 text-right animate-oracle-slide-right"
                : "mr-4 border-l-2 border-l-info/30 pl-3 pr-2 py-1 bg-info/[0.05] animate-oracle-chromatic-in"
            }
          >
            <span className={`text-micro tracking-wider block mb-1 ${
              msg.role === "user" ? "text-t-dim" : "text-info"
            }`}>
              {msg.role === "user" ? t("you") : t("oracle")}
            </span>
            <span className={`text-detail normal-case tracking-normal leading-relaxed break-words block ${
              msg.role === "user" ? "text-t-secondary" : "text-t-DEFAULT"
            }`}>
              {msg.id === latestMsgId.current ? (
                <DecodeText text={msg.content} />
              ) : (
                msg.content
              )}
            </span>
          </div>
        ))}

        {loading && (
          <div className="mr-4 border-l-2 border-l-info/30 pl-3 pr-2 py-1 bg-info/[0.05] animate-oracle-slide-left">
            <span className="text-micro tracking-wider text-info block mb-1">{t("oracle")}</span>
            <span className="text-detail text-info/50 normal-case tracking-normal bg-gradient-to-r from-info/[0.06] via-info/[0.12] to-info/[0.06] bg-[length:200%_100%] animate-shimmer inline-block px-2 py-0.5">
              {t("oracle_thinking")}
            </span>
          </div>
        )}

        {error && (
          <div className="text-micro text-danger tracking-wider px-3 py-2 border border-danger animate-slide-down flex items-start gap-2">
            <span className="flex-1">{error}</span>
            <button
              onClick={handleDismissError}
              className="text-danger/50 hover:text-danger transition-colors shrink-0 leading-none min-w-[36px] min-h-[36px] flex items-center justify-center -mr-2 -my-1"
              aria-label={t("close")}
            >
              ×
            </button>
          </div>
        )}
        </div>
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex gap-2 p-4 border-t border-b-DEFAULT shrink-0 relative overflow-hidden">
        {/* Transmission sweep — info-tinted flash on send */}
        {sendCount > 0 && (
          <span
            key={sendCount}
            className="absolute inset-0 bg-info/10 animate-transmission-sweep pointer-events-none"
            aria-hidden="true"
          />
        )}
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("oracle_placeholder")}
          maxLength={2000}
          disabled={loading}
          aria-label={t("oracle_placeholder")}
          className="flex-1 min-w-0 h-9 px-3 bg-void border border-b-DEFAULT text-detail text-t-DEFAULT normal-case tracking-normal focus:border-primary focus:outline-none hover:border-b-hover transition-colors disabled:opacity-30"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          aria-label={t("oracle_send")}
          className="h-9 px-5 text-micro font-medium tracking-wider bg-primary text-void border border-primary hover:bg-transparent hover:text-primary hover:shadow-[0_0_16px_var(--color-primary-glow-strong)] active:scale-[0.97] disabled:opacity-30 disabled:pointer-events-none transition-[colors,box-shadow,transform]"
        >
          {t("oracle_send")}
        </button>
      </form>
    </div>
  );
}
