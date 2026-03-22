"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  WorldState,
  EventData,
  BabelSettings,
  getState,
  runWorld,
  pauseWorld,
  stepWorld,
  createWebSocket,
  loadSettings,
  extractSeed,
} from "@/lib/api";
import { useLocale } from "@/lib/locale-context";
import EventFeed from "@/components/EventFeed";
import AgentCard from "@/components/AgentCard";
import WorldStatePanel from "@/components/WorldState";
import ControlBar from "@/components/ControlBar";
import Settings from "@/components/Settings";
import InjectEvent from "@/components/InjectEvent";
import AgentChat from "@/components/AgentChat";

const MAX_EVENTS = 500;

function SimContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("id") || "";

  const [state, setState] = useState<WorldState | null>(null);
  const [events, setEvents] = useState<EventData[]>([]);
  const [newEventIds, setNewEventIds] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState("paused");
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<BabelSettings>(loadSettings);
  const [error, setError] = useState<string | null>(null);
  const [wsStatus, setWsStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [chatAgent, setChatAgent] = useState<{ id: string; name: string } | null>(null);
  const [worldExtracted, setWorldExtracted] = useState(false);
  const { locale, toggle, t } = useLocale();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();

  // Load initial state
  useEffect(() => {
    if (!sessionId) return;
    getState(sessionId)
      .then((s) => {
        setState(s);
        setEvents(s.recent_events);
        setTick(s.tick);
        setStatus(s.status);
      })
      .catch(() => setError("Failed to load world state. Is the backend running?"));
  }, [sessionId]);

  // WebSocket connection with reconnection
  useEffect(() => {
    if (!sessionId) return;

    let retryCount = 0;
    const maxRetries = 10;
    let mounted = true;

    function connect() {
      if (!mounted) return;
      setWsStatus("connecting");

      const ws = createWebSocket(sessionId);
      wsRef.current = ws;

      ws.onopen = () => {
        retryCount = 0;
        setWsStatus("connected");
        setError(null);
      };

      ws.onmessage = (msg) => {
        const data = JSON.parse(msg.data);

        switch (data.type) {
          case "connected":
            setState(data.data);
            setEvents(data.data.recent_events || []);
            setTick(data.data.tick);
            setStatus(data.data.status);
            break;

          case "event":
            setEvents((prev) => {
              const next = [...prev, data.data];
              return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
            });
            setNewEventIds((prev) => new Set(prev).add(data.data.id));
            setTimeout(() => {
              setNewEventIds((prev) => {
                const next = new Set(prev);
                next.delete(data.data.id);
                return next;
              });
            }, 1500);
            break;

          case "tick":
            setTick(data.data.tick);
            setStatus(data.data.status);
            break;

          case "state_update":
            setState(data.data);
            setTick(data.data.tick);
            setStatus(data.data.status);
            break;

          case "stopped":
            setStatus("ended");
            setTick(data.data.tick);
            setLoading(false);
            break;

          case "error":
            setError(`Engine error: ${data.data.message}`);
            break;
        }
      };

      ws.onclose = () => {
        if (!mounted) return;
        setWsStatus("disconnected");
        wsRef.current = null;

        if (retryCount < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
          retryCount++;
          reconnectTimer.current = setTimeout(connect, delay);
        } else {
          setError("Lost connection to server. Please refresh the page.");
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      mounted = false;
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [sessionId]);

  function checkSettings(): boolean {
    if (!settings.apiKey) {
      setError(t("api_key_required"));
      setShowSettings(true);
      return false;
    }
    return true;
  }

  const handleRun = useCallback(async () => {
    if (!sessionId || !checkSettings()) return;
    setLoading(true);
    setStatus("running");
    setError(null);
    try {
      await runWorld(sessionId, {
        model: settings.model || undefined,
        api_key: settings.apiKey || undefined,
        api_base: settings.apiBase || undefined,
        max_ticks: tick + 50,
        tick_delay: settings.tickDelay,
      });
    } catch {
      setError(t("run_failed"));
      setLoading(false);
      setStatus("paused");
    }
  }, [sessionId, settings, tick]);

  const handlePause = useCallback(async () => {
    if (!sessionId) return;
    try {
      await pauseWorld(sessionId);
      setStatus("paused");
      setLoading(false);
    } catch {
      setError(t("pause_failed"));
    }
  }, [sessionId]);

  const handleStep = useCallback(async () => {
    if (!sessionId || !checkSettings()) return;
    setLoading(true);
    setError(null);
    try {
      await stepWorld(sessionId, {
        model: settings.model || undefined,
        api_key: settings.apiKey || undefined,
        api_base: settings.apiBase || undefined,
      });
    } catch {
      setError(t("step_failed"));
    } finally {
      setLoading(false);
    }
  }, [sessionId, settings]);

  if (!sessionId) {
    return (
      <div className="min-h-screen flex items-center justify-center text-t-dim">
        No session ID provided.
        <a href="/" className="text-primary ml-2 hover:underline">Go home</a>
      </div>
    );
  }

  const agents = state?.agents || {};
  const activeAgentId =
    events.length > 0 ? events[events.length - 1]?.agent_id : null;

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-void">
      <nav aria-label="Main navigation" className="flex items-center justify-between h-14 px-6 border-b border-b-DEFAULT shrink-0">
        <a href="/" className="font-sans text-subheading font-bold tracking-widest">
          BABEL
        </a>
        <div className="flex items-center gap-6">
          <a
            href="/"
            className="text-micro text-t-muted tracking-widest hover:text-white transition-colors"
          >
            {t("home")}
          </a>
          <span className="text-micro text-primary tracking-widest" aria-current="page">{t("simulate")}</span>
          <a
            href="/assets"
            className="text-micro text-t-muted tracking-widest hover:text-white transition-colors"
          >
            {t("assets")}
          </a>
          <button
            onClick={() => setShowSettings(!showSettings)}
            aria-expanded={showSettings}
            aria-controls="settings-panel"
            className={`text-micro tracking-widest transition-colors ${
              showSettings ? "text-primary" : "text-t-muted hover:text-white"
            }`}
          >
            {t("settings")}
          </button>
          <button
            onClick={toggle}
            className="text-micro text-t-dim tracking-wider border border-surface-3 px-2 py-[2px] hover:text-white hover:border-b-hover transition-colors"
          >
            {locale === "cn" ? "EN" : "中"}
          </button>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-baseline gap-2" aria-label={`Current tick: ${tick}`}>
            <span className="text-micro text-t-muted tracking-widest">Tick</span>
            <span className="text-subheading font-bold text-primary tabular-nums" aria-live="polite">
              {String(tick).padStart(3, "0")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${
                status === "running"
                  ? "bg-primary shadow-[0_0_8px_var(--color-primary-glow-strong)]"
                  : status === "ended"
                  ? "bg-danger"
                  : "bg-t-dim"
              }`}
              aria-hidden="true"
            />
            <span
              className={`text-micro tracking-wider ${
                status === "running" ? "text-primary" : "text-t-muted"
              }`}
              role="status"
            >
              {status}
            </span>
          </div>
          {/* Current model indicator */}
          <div className="w-px h-4 bg-b-DEFAULT" aria-hidden="true" />
          <span className="text-micro text-t-dim tracking-wider normal-case">
            {settings.model}
          </span>
          {/* WebSocket indicator */}
          {wsStatus === "disconnected" && (
            <span className="text-micro text-danger tracking-wider">{t("disconnected")}</span>
          )}
        </div>
      </nav>

      {/* Error banner */}
      {error && (
        <div className="px-6 py-3 bg-surface-1 border-b border-danger text-detail text-danger flex items-center justify-between shrink-0" role="alert">
          <span className="normal-case tracking-normal">{error}</span>
          <button onClick={() => setError(null)} className="text-micro text-danger hover:text-white transition-colors ml-4" aria-label="Dismiss error">
            Dismiss
          </button>
        </div>
      )}

      {/* Settings panel */}
      {showSettings && (
        <div id="settings-panel">
          <Settings
            onClose={() => setShowSettings(false)}
            onSave={(s) => setSettings(s)}
          />
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 grid grid-cols-[1fr_380px] overflow-hidden">
        {/* Event Feed */}
        <section className="flex flex-col border-r border-b-DEFAULT overflow-hidden" aria-label="Event feed">
          <div className="px-4 py-3 border-b border-b-DEFAULT bg-surface-1 flex justify-between items-center shrink-0">
            <span className="text-micro text-t-muted tracking-widest">
              {t("event_feed")}
            </span>
            <span className="text-micro text-t-muted tracking-wider">
              {events.length} {t("events_count")}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {events.length === 0 ? (
              <div className="flex items-center justify-center h-full text-detail text-t-dim">
                {t("no_events")}
              </div>
            ) : (
              <EventFeed events={events} newEventIds={newEventIds} sessionId={sessionId} />
            )}
          </div>
          <InjectEvent sessionId={sessionId} settings={settings} disabled={status === "running"} />
        </section>

        {/* Sidebar */}
        <aside className="flex flex-col overflow-hidden" aria-label="World details">
          {/* Agents */}
          <section className="border-b border-b-DEFAULT shrink-0" aria-label="Agents">
            <div className="px-4 py-3 border-b border-b-DEFAULT bg-surface-1 flex justify-between items-center">
              <span className="text-micro text-t-muted tracking-widest">
                {t("agents")}
              </span>
              <span className="text-micro text-t-muted tracking-wider">
                {Object.keys(agents).length} {t("total")}
              </span>
            </div>
            <div className="p-3 flex flex-col gap-3 max-h-[50vh] overflow-y-auto">
              {Object.entries(agents).map(([id, agent]) => (
                <AgentCard
                  key={id}
                  agentId={id}
                  agent={agent}
                  isActive={id === activeAgentId}
                  sessionId={sessionId}
                  onChat={() => setChatAgent({ id, name: agent.name })}
                />
              ))}
            </div>
          </section>

          {/* World State */}
          <section className="flex-1 flex flex-col overflow-hidden" aria-label="World state">
            <div className="px-4 py-3 border-b border-b-DEFAULT bg-surface-1 shrink-0 flex justify-between items-center">
              <span className="text-micro text-t-muted tracking-widest">
                {t("world_state")}
              </span>
              <button
                onClick={async () => {
                  try {
                    await extractSeed("world", sessionId);
                    setWorldExtracted(true);
                    setTimeout(() => setWorldExtracted(false), 2000);
                  } catch {}
                }}
                className={`text-micro tracking-wider transition-colors ${
                  worldExtracted ? "text-primary" : "text-t-dim hover:text-primary"
                }`}
              >
                {worldExtracted ? t("saved") : t("extract_world")}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <WorldStatePanel state={state} />
            </div>
          </section>
        </aside>
      </div>

      {/* Agent Chat Modal */}
      {chatAgent && (
        <AgentChat
          sessionId={sessionId}
          agentId={chatAgent.id}
          agentName={chatAgent.name}
          settings={settings}
          onClose={() => setChatAgent(null)}
        />
      )}

      {/* Control Bar */}
      <ControlBar
        tick={tick}
        status={status}
        onRun={handleRun}
        onPause={handlePause}
        onStep={handleStep}
        disabled={loading && status !== "running"}
        worldName={state?.name}
        sessionId={sessionId}
      />
    </div>
  );
}

export default function SimPage() {
  return (
    <Suspense
      fallback={
        <div className="h-screen flex items-center justify-center bg-void text-t-dim">
          Loading...
        </div>
      }
    >
      <SimContent />
    </Suspense>
  );
}
