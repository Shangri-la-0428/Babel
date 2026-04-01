"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/locale-context";
import { sendCommand, CommandResponse, loadSettings } from "@/lib/api";
import { AutoTextarea, Badge, SkeletonLine } from "./ui";

interface CommandBarProps {
  sessionId: string;
  status: string;
  onRun: () => void;
  onPause: () => void;
  onStep: () => void;
  onFork: (targetTick: number) => void;
  onStateRefresh: () => void;
}

interface HistoryEntry {
  id: number;
  input: string;
  response: CommandResponse;
}

const CONTROL_INTENTS = new Set(["RUN", "PAUSE", "STEP"]);
const MAX_HISTORY = 5;

let entryIdCounter = 0;

export default function CommandBar({
  sessionId,
  onRun,
  onPause,
  onStep,
  onFork,
  onStateRefresh,
}: CommandBarProps) {
  const { locale, t } = useLocale();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const responseRef = useRef<HTMLDivElement>(null);

  // Global "/" hotkey to focus input
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "/") return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;
      e.preventDefault();
      inputRef.current?.focus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Scroll response area when history changes
  useEffect(() => {
    if (responseRef.current) {
      responseRef.current.scrollTop = responseRef.current.scrollHeight;
    }
  }, [history]);

  const handleSubmit = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    // Check for local control intents first
    const upper = text.toUpperCase();
    if (upper === "RUN" || upper === "START" || upper === "PLAY") {
      onRun();
      setInput("");
      setHistory((prev) => [
        ...prev.slice(-(MAX_HISTORY - 1)),
        { id: ++entryIdCounter, input: text, response: { intent: "RUN", params: {}, reply: undefined } },
      ]);
      return;
    }
    if (upper === "PAUSE" || upper === "STOP") {
      onPause();
      setInput("");
      setHistory((prev) => [
        ...prev.slice(-(MAX_HISTORY - 1)),
        { id: ++entryIdCounter, input: text, response: { intent: "PAUSE", params: {}, reply: undefined } },
      ]);
      return;
    }
    if (upper === "STEP" || upper === "NEXT") {
      onStep();
      setInput("");
      setHistory((prev) => [
        ...prev.slice(-(MAX_HISTORY - 1)),
        { id: ++entryIdCounter, input: text, response: { intent: "STEP", params: {}, reply: undefined } },
      ]);
      return;
    }

    // Fork with tick number
    const forkMatch = upper.match(/^FORK\s+(\d+)$/);
    if (forkMatch) {
      onFork(parseInt(forkMatch[1], 10));
      setInput("");
      setHistory((prev) => [
        ...prev.slice(-(MAX_HISTORY - 1)),
        { id: ++entryIdCounter, input: text, response: { intent: "FORK", params: { tick: parseInt(forkMatch[1], 10) }, reply: undefined } },
      ]);
      return;
    }

    // Send to backend
    setLoading(true);
    setInput("");
    try {
      const settings = loadSettings();
      const response = await sendCommand(sessionId, text, {
        model: settings.model.trim() || undefined,
        api_key: settings.apiKey.trim() || undefined,
        api_base: settings.apiBase.trim() || undefined,
        language: locale,
      });

      setHistory((prev) => [
        ...prev.slice(-(MAX_HISTORY - 1)),
        { id: ++entryIdCounter, input: text, response },
      ]);

      // If backend returned a control intent, fire callback
      if (response.intent === "RUN") onRun();
      else if (response.intent === "PAUSE") onPause();
      else if (response.intent === "STEP") onStep();
      else if (response.intent === "FORK" && typeof response.params?.tick === "number") {
        onFork(response.params.tick as number);
      }

      // Refresh state after any command
      onStateRefresh();
    } catch (err) {
      setHistory((prev) => [
        ...prev.slice(-(MAX_HISTORY - 1)),
        {
          id: ++entryIdCounter,
          input: text,
          response: { intent: "ERROR", params: {}, error: err instanceof Error ? err.message : t("cmd_error") },
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, sessionId, locale, t, onRun, onPause, onStep, onFork, onStateRefresh]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
      if (e.key === "Escape") {
        setInput("");
        setHistory([]);
        inputRef.current?.blur();
      }
    },
    [handleSubmit],
  );

  return (
    <div className="bg-void border-t border-b-DEFAULT shrink-0">
      {/* Response area */}
      {(history.length > 0 || loading) && (
        <div
          ref={responseRef}
          className="max-h-48 overflow-y-auto px-4 py-2 flex flex-col gap-1.5 animate-slide-down"
        >
          {history.map((entry) => (
            <div key={entry.id} className="flex flex-col gap-0.5">
              {/* User input echo */}
              <div className="text-micro text-t-dim tracking-wider">
                {">"} {entry.input}
              </div>
              {/* Response */}
              {entry.response.error ? (
                <div className="text-detail text-danger normal-case tracking-normal pl-2">
                  {entry.response.error}
                </div>
              ) : entry.response.reply ? (
                <div className="bg-info/[0.05] border-l-2 border-info/30 pl-3 pr-2 py-1.5 flex items-start gap-2">
                  <div className="text-detail text-t-secondary normal-case tracking-normal leading-relaxed flex-1">
                    {entry.response.reply}
                  </div>
                  <Badge variant="info">{entry.response.intent}</Badge>
                </div>
              ) : CONTROL_INTENTS.has(entry.response.intent) || entry.response.intent === "FORK" ? (
                <div className="text-detail text-t-muted normal-case tracking-normal pl-2 flex items-center gap-2">
                  <Badge variant="primary">{entry.response.intent}</Badge>
                </div>
              ) : null}
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2 py-1">
              <SkeletonLine className="h-3 w-24" />
              <span className="text-micro text-t-dim tracking-wider">{t("cmd_thinking")}</span>
            </div>
          )}
        </div>
      )}

      {/* Input area */}
      <div className="flex items-end gap-2 px-4 py-2">
        <div className="flex-1 min-w-0">
          <AutoTextarea
            textareaRef={inputRef}
            value={input}
            maxHeight={120}
            placeholder={t("cmd_placeholder")}
            disabled={loading}
            rows={1}
            className="w-full h-10 px-3 py-2 bg-void border border-b-DEFAULT font-mono text-detail text-t-DEFAULT normal-case tracking-normal focus:border-primary focus:outline-none hover:border-b-hover transition-colors disabled:opacity-30 disabled:cursor-not-allowed resize-none"
            onChange={(e) => setInput(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading || !input.trim()}
          className="inline-flex items-center justify-center h-10 px-5 text-micro font-medium tracking-wider bg-primary text-void border border-primary hover:bg-transparent hover:text-primary hover:shadow-[0_0_16px_var(--color-primary-glow-strong)] active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed transition-[colors,box-shadow,transform]"
        >
          {t("cmd_send")}
        </button>
      </div>
    </div>
  );
}
