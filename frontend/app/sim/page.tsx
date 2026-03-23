"use client";

import { useEffect, useState, useCallback, useRef, Suspense, lazy } from "react";
import { useSearchParams } from "next/navigation";
import {
  WorldState,
  EventData,
  BabelSettings,
  SavedSeedData,
  getState,
  runWorld,
  pauseWorld,
  stepWorld,
  createWebSocket,
  loadSettings,
  generateSeed,
} from "@/lib/api";
import { useLocale } from "@/lib/locale-context";
import EventFeed from "@/components/EventFeed";
import AssetPanel from "@/components/AssetPanel";
import ControlBar from "@/components/ControlBar";
import Settings from "@/components/Settings";
import InjectEvent from "@/components/InjectEvent";
import { ErrorBanner } from "@/components/ui";

const SeedPreview = lazy(() => import("@/components/SeedPreview"));
const AgentChat = lazy(() => import("@/components/AgentChat"));

const MAX_EVENTS = 500;

function SimContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("id") || "";

  const [state, setState] = useState<WorldState | null>(null);
  const [events, setEvents] = useState<EventData[]>([]);
  const newEventIdsRef = useRef<Set<string>>(new Set());
  const [newEventIds, setNewEventIds] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState("paused");
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<BabelSettings>(loadSettings);
  const [error, setError] = useState<string | null>(null);
  const [wsStatus, setWsStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [chatAgent, setChatAgent] = useState<{ id: string; name: string } | null>(null);
  const [seedPreview, setSeedPreview] = useState<SavedSeedData | null>(null);
  const { locale, toggle, t } = useLocale();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const highlightTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Load initial state
  useEffect(() => {
    if (!sessionId) return;
    getState(sessionId)
      .then((s) => {
        setState(s);
        setEvents(s.recent_events || []);
        setTick(s.tick);
        setStatus(s.status || "paused");
      })
      .catch(() => setError(t("failed_load_state")));
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let data: any;
        try { data = JSON.parse(msg.data); } catch { return; }

        if (!data.data) return;

        switch (data.type) {
          case "connected":
            setState(data.data);
            setEvents(data.data.recent_events || []);
            setTick(data.data.tick ?? 0);
            setStatus(data.data.status || "paused");
            break;

          case "event":
            setEvents((prev) => {
              const next = [...prev, data.data];
              return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
            });
            {
              const evtId = data.data.id;
              newEventIdsRef.current.add(evtId);
              setNewEventIds(new Set(newEventIdsRef.current));
              const timer = setTimeout(() => {
                newEventIdsRef.current.delete(evtId);
                setNewEventIds(new Set(newEventIdsRef.current));
              }, 1500);
              highlightTimers.current.push(timer);
            }
            break;

          case "tick":
            setTick(data.data.tick ?? 0);
            setStatus(data.data.status || "paused");
            break;

          case "state_update":
            setState(data.data);
            setTick(data.data.tick ?? 0);
            setStatus(data.data.status || "paused");
            break;

          case "stopped":
            setStatus("ended");
            setTick(data.data.tick ?? 0);
            setLoading(false);
            break;

          case "error":
            setError(`${t("engine_error")}: ${data.data.message || "Unknown"}`);
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
          setError(t("lost_connection"));
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
      highlightTimers.current.forEach(clearTimeout);
      highlightTimers.current = [];
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

  // Seed generation handlers
  async function handleGenerateAgentSeed(agentId: string) {
    try {
      const seed = await generateSeed("agent", sessionId, agentId);
      setSeedPreview(seed);
    } catch {
      setError(t("gen_agent_seed_failed"));
    }
  }

  async function handleGenerateEventSeed(eventId: string) {
    try {
      const seed = await generateSeed("event", sessionId, eventId);
      setSeedPreview(seed);
    } catch {
      setError(t("gen_event_seed_failed"));
    }
  }

  async function handleGenerateWorldSeed() {
    try {
      const seed = await generateSeed("world", sessionId);
      setSeedPreview(seed);
    } catch {
      setError(t("gen_world_seed_failed"));
    }
  }

  if (!sessionId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3">
        <div className="text-micro text-t-dim tracking-widest">{"// ERROR"}</div>
        <div className="text-detail text-t-muted normal-case tracking-normal">{t("no_session")}</div>
        <a href="/" className="h-9 px-5 text-micro font-medium tracking-wider border border-b-DEFAULT text-t-muted hover:border-primary hover:text-primary transition-colors inline-flex items-center">
          {t("go_home")}
        </a>
      </div>
    );
  }

  const activeAgentId =
    events.length > 0 ? events[events.length - 1]?.agent_id : null;

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-void scanlines">
      <h1 className="sr-only">{t("simulate")}</h1>
      <nav aria-label="Main navigation" className="flex items-center justify-between h-14 px-6 border-b border-b-DEFAULT shrink-0">
        <div className="flex items-center gap-4 min-w-0">
          <a href="/" className="text-micro text-t-muted tracking-wider hover:text-primary transition-colors shrink-0">
            {t("back")}
          </a>
          <span className="text-t-dim shrink-0">|</span>
          <a href="/" className="font-sans text-subheading font-bold tracking-widest text-primary hover:drop-shadow-[0_0_8px_var(--color-primary-glow-strong)] transition-[filter] shrink-0">
            BABEL
          </a>
          {state?.name && (
            <>
              <span className="text-t-dim shrink-0">/</span>
              <span className="text-body font-semibold text-primary truncate max-w-[300px] drop-shadow-[0_0_8px_var(--color-primary-glow)]">
                {state.name}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-6">
          <a href="/assets" className="text-micro text-t-muted tracking-widest hover:text-t-DEFAULT transition-colors">
            {t("assets")}
          </a>
          <button
            onClick={() => setShowSettings(!showSettings)}
            aria-expanded={showSettings}
            aria-controls="settings-panel"
            className={`text-micro tracking-widest transition-colors ${
              showSettings ? "text-primary" : "text-t-muted hover:text-t-DEFAULT"
            }`}
          >
            {t("settings")}
          </button>
          <button
            onClick={toggle}
            className="text-micro text-t-dim tracking-wider border border-surface-3 px-3 py-1 hover:text-t-DEFAULT hover:border-b-hover transition-colors"
            aria-label={t("lang_switch")}
          >
            {locale === "cn" ? "EN" : "中"}
          </button>
        </div>
      </nav>

      {/* Error banner */}
      {error && (
        <ErrorBanner variant="header" message={error} onDismiss={() => setError(null)} />
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
      {/* Desktop-only layout (1280px+) */}
      <main className="flex-1 grid grid-cols-[1fr_380px] min-w-[1024px] overflow-hidden">
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
              <div className="flex flex-col items-center justify-center h-full gap-2">
                <div className="text-micro text-t-dim tracking-widest">{"// AWAITING INPUT"}</div>
                <div className="text-detail text-t-muted normal-case tracking-normal">
                  {t("no_events")}
                </div>
              </div>
            ) : (
              <EventFeed
                events={events}
                newEventIds={newEventIds}
                onSeed={handleGenerateEventSeed}
              />
            )}
          </div>
          <InjectEvent sessionId={sessionId} settings={settings} disabled={status === "running"} />
        </section>

        {/* Sidebar — Asset Management */}
        <AssetPanel
          state={state}
          activeAgentId={activeAgentId}
          sessionId={sessionId}
          onChat={(id, name) => setChatAgent({ id, name })}
          onExtractAgent={handleGenerateAgentSeed}
          onExtractWorld={handleGenerateWorldSeed}
        />
      </main>

      {/* Seed Preview Modal (lazy) */}
      {seedPreview && (
        <Suspense fallback={null}>
          <SeedPreview
            seed={seedPreview}
            onClose={() => setSeedPreview(null)}
          />
        </Suspense>
      )}

      {/* Agent Chat Modal (lazy) */}
      {chatAgent && (
        <Suspense fallback={null}>
          <AgentChat
            sessionId={sessionId}
            agentId={chatAgent.id}
            agentName={chatAgent.name}
            settings={settings}
            onClose={() => setChatAgent(null)}
          />
        </Suspense>
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
        model={settings.model}
        wsStatus={wsStatus}
      />
    </div>
  );
}

export default function SimPage() {
  return (
    <Suspense
      fallback={
        <div className="h-screen flex items-center justify-center bg-void text-micro text-t-dim tracking-widest">
          LOADING
        </div>
      }
    >
      <SimContent />
    </Suspense>
  );
}
