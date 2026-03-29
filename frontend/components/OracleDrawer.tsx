"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { chatWithOracle, getOracleHistory, createWorld, OracleMessage, BabelSettings, WorldSeedPayload } from "@/lib/api";
import { useLocale } from "@/lib/locale-context";
import { OracleWaveform } from "./OracleWaveform";
import { OracleParticles } from "./OracleParticles";
import OracleHeader from "./OracleHeader";
import OracleChat from "./OracleChat";
import { ExpandableInput } from "./ui";

type OracleMode = "narrate" | "create";

interface OracleDrawerProps {
  sessionId: string;
  settings: BabelSettings;
  open: boolean;
  onClose: () => void;
  tick: number;
  initialMode?: OracleMode;
  onApplySeed?: (seed: Record<string, unknown>) => void;
  applySeedLabel?: string;
}

function sanitizeStringList(values: unknown): string[] {
  return Array.isArray(values)
    ? values.map((value) => String(value).trim()).filter(Boolean)
    : [];
}

function normalizeGeneratedSeed(raw: Record<string, unknown>): WorldSeedPayload {
  const locations = Array.isArray(raw.locations)
    ? raw.locations
        .map((location) => {
          if (!location || typeof location !== "object") return null;
          const entry = location as { name?: unknown; description?: unknown };
          const name = typeof entry.name === "string" ? entry.name.trim() : "";
          if (!name) return null;
          return {
            name,
            description: typeof entry.description === "string" ? entry.description : "",
          };
        })
        .filter((location): location is { name: string; description: string } => Boolean(location))
    : [];

  const items = Array.isArray(raw.items)
    ? raw.items
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const entry = item as {
            name?: unknown;
            description?: unknown;
            origin?: unknown;
            properties?: unknown;
            significance?: unknown;
          };
          const name = typeof entry.name === "string" ? entry.name.trim() : "";
          if (!name) return null;
          return {
            name,
            description: typeof entry.description === "string" ? entry.description : "",
            origin: typeof entry.origin === "string" ? entry.origin : "",
            properties: sanitizeStringList(entry.properties),
            significance: typeof entry.significance === "string" ? entry.significance : "",
          };
        })
        .filter((item): item is WorldSeedPayload["items"][number] => Boolean(item))
    : [];

  const agents = Array.isArray(raw.agents)
    ? raw.agents
        .map((agent, index) => {
          if (!agent || typeof agent !== "object") return null;
          const entry = agent as {
            id?: unknown;
            name?: unknown;
            description?: unknown;
            personality?: unknown;
            goals?: unknown;
            inventory?: unknown;
            location?: unknown;
          };
          const name = typeof entry.name === "string" ? entry.name.trim() : "";
          if (!name) return null;
          return {
            id:
              typeof entry.id === "string" && entry.id.trim()
                ? entry.id
                : `oracle_agent_${Date.now()}_${index}`,
            name,
            description: typeof entry.description === "string" ? entry.description : "",
            personality: typeof entry.personality === "string" ? entry.personality : "",
            goals: sanitizeStringList(entry.goals),
            inventory: sanitizeStringList(entry.inventory),
            location: typeof entry.location === "string" ? entry.location : "",
          };
        })
        .filter((agent): agent is WorldSeedPayload["agents"][number] => Boolean(agent))
    : [];

  return {
    name: typeof raw.name === "string" ? raw.name : "",
    description: typeof raw.description === "string" ? raw.description : "",
    rules: sanitizeStringList(raw.rules),
    locations,
    items,
    agents,
    initial_events: sanitizeStringList(raw.initial_events),
  };
}

export default function OracleDrawer({
  sessionId,
  settings,
  open,
  onClose,
  tick,
  initialMode = "narrate",
  onApplySeed,
  applySeedLabel,
}: OracleDrawerProps) {
  const { t, locale } = useLocale();
  const [mode, setMode] = useState<OracleMode>(initialMode);
  const [messages, setMessages] = useState<OracleMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [sendCount, setSendCount] = useState(0);
  const [generatedSeed, setGeneratedSeed] = useState<Record<string, unknown> | null>(null);
  const [creatingSeed, setCreatingSeed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
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
          setMessages((prev) => prev.length > 0 ? prev : history);
          setHistoryLoaded(true);
        }
      })
      .catch(() => { /* history load is best-effort */ });
    return () => { controller.abort(); };
  }, [sessionId, historyLoaded]);

  // Abort in-flight send on unmount + cleanup timers
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

    sendControllerRef.current?.abort();
    const controller = new AbortController();
    sendControllerRef.current = controller;

    setSendCount((c) => c + 1);

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
        mode,
        language: locale,
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

      if (res.mode === "create" && res.seed) {
        setGeneratedSeed(res.seed);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        const detail = err instanceof Error ? err.message : "";
        if (mode === "create" && detail) {
          setError(`${t("oracle_create_failed")} ${detail}`);
        } else if (mode === "create") {
          setError(t("oracle_create_failed"));
        } else {
          setError(t("oracle_failed"));
        }
      }
    } finally {
      if (sendControllerRef.current === controller) {
        setLoading(false);
        sendControllerRef.current = null;
      }
    }
  }, [input, loading, sessionId, settings, tick, t, mode, locale]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    handleSend();
  }, [handleSend]);

  const handleDismissError = useCallback(() => setError(null), []);

  const handleModeChange = useCallback((newMode: OracleMode) => {
    setMode(newMode);
    if (newMode === "create") setGeneratedSeed(null);
  }, []);

  const handlePrimaryAction = useCallback(async () => {
    if (!generatedSeed || creatingSeed) return;
    if (onApplySeed) {
      onApplySeed(generatedSeed);
      return;
    }
    setCreatingSeed(true);
    try {
      const result = await createWorld(normalizeGeneratedSeed(generatedSeed));
      window.location.href = `/sim?id=${result.session_id}`;
    } catch {
      setError(t("failed_create"));
    } finally {
      setCreatingSeed(false);
    }
  }, [generatedSeed, creatingSeed, onApplySeed, t]);

  return (
    <div
      ref={drawerRef}
      className={`fixed right-0 top-14 bottom-14 w-[420px] 2xl:w-[480px] z-overlay flex flex-col bg-void border-l border-info/30 transition-transform duration-200 ease-out-expo oracle-scan-edge ${
        loading ? "animate-oracle-border-pulse oracle-scan-thinking" : ""
      } ${
        open ? "translate-x-0" : "translate-x-full pointer-events-none"
      }`}
      role="complementary"
      aria-label={t("oracle")}
      aria-hidden={!open}
    >
      <OracleHeader
        mode={mode}
        onModeChange={handleModeChange}
        tick={tick}
        onClose={onClose}
        t={t as (key: string, ...args: string[]) => string}
      />

      {/* Signal Waveform */}
      <OracleWaveform state={waveformState} open={open} />

      {/* Messages + Particle Field */}
      <div className="flex-1 min-h-0 relative">
        <OracleParticles thinking={loading} open={open} />
        <OracleChat
          messages={messages}
          loading={loading}
          error={error}
          mode={mode}
          historyLoaded={historyLoaded}
          latestMsgId={latestMsgId.current}
          generatedSeed={generatedSeed}
          creatingSeed={creatingSeed}
          scrollRef={scrollRef}
          onSend={handleSend}
          onDismissError={handleDismissError}
          onPrimaryAction={handlePrimaryAction}
          primaryActionLabel={onApplySeed ? (applySeedLabel || t("oracle_apply_seed")) : t("oracle_create_world")}
          t={t as (key: string, ...args: string[]) => string}
        />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex items-end gap-2 p-4 border-t border-b-DEFAULT shrink-0 relative overflow-hidden">
        {sendCount > 0 && (
          <span
            key={sendCount}
            className="absolute inset-0 bg-info/10 animate-transmission-sweep pointer-events-none"
            aria-hidden="true"
          />
        )}
        <ExpandableInput
          inputRef={inputRef}
          value={input}
          onValueChange={setInput}
          placeholder={mode === "create" ? t("oracle_create_placeholder") : t("oracle_placeholder")}
          maxLength={2000}
          disabled={loading}
          aria-label={mode === "create" ? t("oracle_create_placeholder") : t("oracle_placeholder")}
          className="flex-1 min-w-0 h-9 px-3 bg-void border border-b-DEFAULT text-detail text-t-DEFAULT normal-case tracking-normal focus:border-primary focus:outline-none hover:border-b-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          aria-label={t("oracle_send")}
          className="h-9 px-5 text-micro font-medium tracking-wider bg-primary text-void border border-primary hover:bg-transparent hover:text-primary hover:shadow-[0_0_16px_var(--color-primary-glow-strong)] active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none transition-[colors,box-shadow,transform] shrink-0"
        >
          {t("oracle_send")}
        </button>
      </form>
    </div>
  );
}
