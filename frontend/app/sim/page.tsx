"use client";

import { useEffect, useState, useCallback, useMemo, useRef, Suspense, lazy } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import {
  WorldState,
  EventData,
  BabelSettings,
  SavedSeedData,
  HumanWaitingContext,
  getState,
  runWorld,
  pauseWorld,
  stepWorld,
  createWebSocket,
  loadSettings,
  generateSeed,
  takeControl,
  releaseControl,
  submitHumanAction,
} from "@/lib/api";
import { useLocale } from "@/lib/locale-context";
import EventFeed from "@/components/EventFeed";
import AssetPanel from "@/components/AssetPanel";
import ControlBar from "@/components/ControlBar";
import Settings from "@/components/Settings";
import InjectEvent from "@/components/InjectEvent";
import { ErrorBanner, GlitchReveal } from "@/components/ui";

const ParticleField = dynamic(() => import("@/components/ParticleField"), { ssr: false });
const WorldRadar = dynamic(() => import("@/components/WorldRadar"), { ssr: false });
const SeedPreview = lazy(() => import("@/components/SeedPreview"));
const AgentChat = lazy(() => import("@/components/AgentChat"));
const OracleDrawer = lazy(() => import("@/components/OracleDrawer"));
const ActionPicker = lazy(() => import("@/components/ActionPicker"));

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
  const [oracleOpen, setOracleOpen] = useState(false);
  const [oracleEverOpened, setOracleEverOpened] = useState(false);
  const [controlledAgents, setControlledAgents] = useState<Set<string>>(new Set());
  const [waitingAgent, setWaitingAgent] = useState<{ id: string; context: HumanWaitingContext } | null>(null);
  const { locale, toggle, t } = useLocale();
  const [wsRetryExhausted, setWsRetryExhausted] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const highlightTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const operationRef = useRef(false); // guard against concurrent Run/Step
  const [showWorldBoot, setShowWorldBoot] = useState(false);
  const [showWorldEnded, setShowWorldEnded] = useState(false);
  const prevRunStatus = useRef(status);

  // Idle personality messages
  const [idleMessage, setIdleMessage] = useState<string | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const idleCycleRef = useRef<ReturnType<typeof setInterval>>();
  const idleIdxRef = useRef(0);

  const IDLE_KEYS = ["idle_0", "idle_1", "idle_2", "idle_3", "idle_4"] as const;

  const resetIdle = useCallback(() => {
    setIdleMessage(null);
    clearTimeout(idleTimerRef.current);
    clearInterval(idleCycleRef.current);
    idleTimerRef.current = setTimeout(() => {
      idleIdxRef.current = 0;
      setIdleMessage(t(IDLE_KEYS[0]));
      idleCycleRef.current = setInterval(() => {
        idleIdxRef.current = (idleIdxRef.current + 1) % IDLE_KEYS.length;
        setIdleMessage(t(IDLE_KEYS[idleIdxRef.current]));
      }, 15000);
    }, 10000);
  }, [t]);

  useEffect(() => {
    resetIdle();
    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];
    events.forEach(e => document.addEventListener(e, resetIdle, { passive: true }));
    return () => {
      clearTimeout(idleTimerRef.current);
      clearInterval(idleCycleRef.current);
      events.forEach(e => document.removeEventListener(e, resetIdle));
    };
  }, [resetIdle]);

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
  const connectWsRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!sessionId) return;

    let retryCount = 0;
    const maxRetries = 10;
    let mounted = true;

    function connect() {
      if (!mounted) return;
      setWsStatus("connecting");
      setWsRetryExhausted(false);

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

          case "agent_added":
            getState(sessionId).then((s) => {
              setState(s);
            }).catch(() => { /* state refresh is best-effort — WS will sync */ });
            break;

          case "waiting_for_human":
            setWaitingAgent({
              id: data.data.agent_id,
              context: {
                agent_name: data.data.agent_name,
                location: data.data.location,
                inventory: data.data.inventory || [],
                visible_agents: data.data.visible_agents || [],
                reachable_locations: data.data.reachable_locations || [],
              },
            });
            break;

          case "human_control":
            setControlledAgents((prev) => {
              const next = new Set(prev);
              if (data.data.controlled) {
                next.add(data.data.agent_id);
              } else {
                next.delete(data.data.agent_id);
              }
              return next;
            });
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
          setWsRetryExhausted(true);
          setError(t("lost_connection"));
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connectWsRef.current = () => {
      retryCount = 0;
      wsRef.current?.close();
      connect();
    };

    connect();

    return () => {
      mounted = false;
      clearTimeout(reconnectTimer.current);
      highlightTimers.current.forEach(clearTimeout);
      highlightTimers.current = [];
      wsRef.current?.close();
    };
  }, [sessionId]);

  function handleReconnect() {
    connectWsRef.current();
  }

  function checkSettings(): boolean {
    if (!settings.apiKey) {
      setError(t("api_key_required"));
      setShowSettings(true);
      return false;
    }
    return true;
  }

  const handleRun = useCallback(async () => {
    if (!sessionId || !checkSettings() || operationRef.current) return;
    operationRef.current = true;
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
    } finally {
      operationRef.current = false;
    }
  }, [sessionId, settings, tick, t]);

  const handlePause = useCallback(async () => {
    if (!sessionId) return;
    try {
      await pauseWorld(sessionId);
      setStatus("paused");
      setLoading(false);
    } catch {
      setError(t("pause_failed"));
    }
  }, [sessionId, t]);

  const handleStep = useCallback(async () => {
    if (!sessionId || !checkSettings() || operationRef.current) return;
    operationRef.current = true;
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
      operationRef.current = false;
    }
  }, [sessionId, settings, t]);

  // Seed generation handlers
  const handleGenerateAgentSeed = useCallback(async (agentId: string) => {
    try {
      const seed = await generateSeed("agent", sessionId, agentId);
      setSeedPreview(seed);
    } catch {
      setError(t("gen_agent_seed_failed"));
    }
  }, [sessionId, t]);

  const handleGenerateEventSeed = useCallback(async (eventId: string) => {
    try {
      const seed = await generateSeed("event", sessionId, eventId);
      setSeedPreview(seed);
    } catch {
      setError(t("gen_event_seed_failed"));
    }
  }, [sessionId, t]);

  const handleGenerateWorldSeed = useCallback(async () => {
    try {
      const seed = await generateSeed("world", sessionId);
      setSeedPreview(seed);
    } catch {
      setError(t("gen_world_seed_failed"));
    }
  }, [sessionId, t]);

  const handleOpenChat = useCallback((id: string, name: string) => {
    setChatAgent({ id, name });
  }, []);

  const handleCloseSettings = useCallback(() => setShowSettings(false), []);
  const handleSaveSettings = useCallback((s: BabelSettings) => setSettings(s), []);
  const handleDismissError = useCallback(() => setError(null), []);
  const handleCloseSeedPreview = useCallback(() => setSeedPreview(null), []);
  const handleCloseChat = useCallback(() => setChatAgent(null), []);
  const handleToggleOracle = useCallback(() => {
    setOracleOpen((prev) => {
      if (!prev) setOracleEverOpened(true);
      return !prev;
    });
  }, []);
  const handleCloseOracle = useCallback(() => setOracleOpen(false), []);

  const handleTakeControl = useCallback(async (agentId: string) => {
    if (!sessionId) return;
    try {
      await takeControl(sessionId, agentId);
      setControlledAgents((prev) => new Set(prev).add(agentId));
    } catch {
      setError(t("control_failed"));
    }
  }, [sessionId, t]);

  const handleReleaseControl = useCallback(async (agentId: string) => {
    if (!sessionId) return;
    try {
      await releaseControl(sessionId, agentId);
      setControlledAgents((prev) => {
        const next = new Set(prev);
        next.delete(agentId);
        return next;
      });
      if (waitingAgent?.id === agentId) setWaitingAgent(null);
    } catch {
      setError(t("control_failed"));
    }
  }, [sessionId, waitingAgent, t]);

  const handleSubmitHumanAction = useCallback(async (actionType: string, target: string, content: string) => {
    if (!sessionId || !waitingAgent) return;
    try {
      await submitHumanAction(sessionId, waitingAgent.id, actionType, target, content);
      setWaitingAgent(null);
    } catch {
      setError(t("human_action_failed"));
    }
  }, [sessionId, waitingAgent, t]);

  const handleCancelWaiting = useCallback(() => {
    // Don't dismiss — the agent is still waiting. User can release control instead.
    // But we can hide the picker temporarily.
    setWaitingAgent(null);
  }, []);

  const activeAgentId = useMemo(
    () => (events.length > 0 ? events[events.length - 1]?.agent_id : null),
    [events]
  );

  // Radar: derive latest event location from agent state
  const latestEventLocation = useMemo(() => {
    if (!events.length || !state?.agents) return "";
    const last = events[events.length - 1];
    if (last.agent_id && state.agents[last.agent_id]) {
      return state.agents[last.agent_id].location;
    }
    return "";
  }, [events, state?.agents]);

  // World boot scan on paused → running
  useEffect(() => {
    if (prevRunStatus.current !== "running" && status === "running") {
      setShowWorldBoot(true);
      const t = setTimeout(() => setShowWorldBoot(false), 600);
      return () => clearTimeout(t);
    }
    // World ended overlay on any status → ended
    if (prevRunStatus.current !== "ended" && status === "ended") {
      setShowWorldEnded(true);
      const t = setTimeout(() => setShowWorldEnded(false), 1500);
      return () => clearTimeout(t);
    }
    prevRunStatus.current = status;
  }, [status]);

  // Radar: agent list for Canvas visualization
  const radarAgents = useMemo(() => {
    if (!state?.agents) return [];
    return Object.entries(state.agents).map(([id, a]) => ({
      id,
      name: a.name,
      location: a.location,
      status: a.status,
    }));
  }, [state?.agents]);

  if (!sessionId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3">
        <div className="text-micro text-t-dim tracking-widest">{"// ERROR"}</div>
        <div className="text-detail text-t-muted normal-case tracking-normal">{t("no_session")}</div>
        <a href="/" className="h-9 px-5 text-micro font-medium tracking-wider border border-b-DEFAULT text-t-muted hover:border-primary hover:text-primary active:scale-[0.97] transition-[colors,transform] inline-flex items-center">
          {t("go_home")}
        </a>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-void scanlines relative isolate">
      {/* World boot scan — full viewport sweep on run start */}
      {showWorldBoot && (
        <div className="absolute inset-0 z-[100] pointer-events-none animate-[world-boot-scan_600ms_ease-out_both]" aria-hidden="true">
          <div className="absolute inset-x-0 h-[2px] bg-primary/20 shadow-[0_0_12px_var(--color-primary-glow-strong)]" />
        </div>
      )}
      {/* World ended overlay — dramatic transition on simulation end */}
      {showWorldEnded && (
        <div
          className="absolute inset-0 z-[100] pointer-events-none flex items-center justify-center bg-void/80 animate-[ended-fade-out_1500ms_ease-out_both]"
          aria-live="assertive"
          role="status"
        >
          {/* Danger scan line sweeping down */}
          <div className="absolute inset-x-0 top-0 h-[2px] bg-danger/40 shadow-[0_0_16px_var(--color-danger-glow)] animate-[ended-scan_800ms_ease-out_both]" />
          {/* WORLD ENDED text */}
          <div className="text-subheading font-bold tracking-widest text-danger drop-shadow-[0_0_16px_var(--color-danger-glow)] animate-[ended-text-glitch_600ms_ease_both]">
            <GlitchReveal text="// SIMULATION COMPLETE" duration={600} />
          </div>
        </div>
      )}
      <ParticleField
        status={status}
        isNight={state?.world_time?.is_night ?? false}
        eventCount={events.length}
      />
      <h1 className="sr-only">{t("simulate")}</h1>
      <nav aria-label="Main navigation" className="flex items-center justify-between h-14 px-6 border-b border-b-DEFAULT shrink-0">
        <div className="flex items-center gap-4 min-w-0">
          <a href="/" className="text-micro text-t-muted tracking-wider hover:text-primary transition-colors shrink-0">
            {t("back")}
          </a>
          <span className="text-t-dim shrink-0">|</span>
          <a href="/" className="font-sans text-subheading font-bold tracking-widest text-primary hover:drop-shadow-[0_0_8px_var(--color-primary-glow-strong)] hover:animate-[logo-glitch_300ms_ease] transition-[filter] shrink-0">
            BABEL
          </a>
          {state?.name && (
            <>
              <span className="text-t-dim shrink-0">/</span>
              <span className="text-body font-semibold text-primary truncate max-w-[300px] drop-shadow-[0_0_8px_var(--color-primary-glow)]">
                <GlitchReveal text={state.name} duration={500} />
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

      {/* Error banner with optional reconnect */}
      {error && (
        <ErrorBanner variant="header" message={error} onDismiss={handleDismissError}>
          {wsRetryExhausted && (
            <button
              onClick={handleReconnect}
              className="ml-3 text-micro tracking-wider text-void bg-danger/80 px-3 py-1 hover:bg-danger transition-colors shrink-0"
            >
              {t("reconnect")}
            </button>
          )}
        </ErrorBanner>
      )}

      {/* Settings panel */}
      {showSettings && (
        <div id="settings-panel">
          <Settings
            onClose={handleCloseSettings}
            onSave={handleSaveSettings}
          />
        </div>
      )}

      {/* Main content */}
      {/* Desktop-only layout (1280px+) */}
      <main className="flex-1 grid grid-cols-[1fr_380px] min-w-[1024px] overflow-hidden">
        {/* Event Feed */}
        <section className="flex flex-col border-r border-b-DEFAULT overflow-hidden" aria-label="Event feed">
          {/* World Radar — Direction A */}
          {state && (state.locations?.length ?? 0) > 0 && (
            <div className="h-[180px] border-b border-b-DEFAULT shrink-0 bg-void relative">
              <span className="absolute top-2 left-4 text-micro text-t-dim tracking-widest pointer-events-none z-10">
                TACTICAL
              </span>
              <WorldRadar
                locations={state.locations}
                agents={radarAgents}
                isRunning={status === "running"}
                latestEventLocation={latestEventLocation}
                tick={tick}
              />
            </div>
          )}
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
                <div className="text-micro text-t-dim tracking-widest">
                  <GlitchReveal text={t("sim_dormant")} duration={500} />
                  <span className="inline-block w-[0.55em] h-[1.1em] bg-t-dim ml-0.5 align-text-bottom animate-[cursor-pulse_1s_step-end_infinite]" aria-hidden="true" />
                </div>
                <div className="text-detail text-t-muted normal-case tracking-normal">
                  {t("no_signals")}
                </div>
              </div>
            ) : (
              <EventFeed
                events={events}
                newEventIds={newEventIds}
                onSeed={handleGenerateEventSeed}
                worldTimeDisplay={state?.world_time?.display}
              />
            )}
          </div>
          {idleMessage && status !== "running" && (
            <div className="px-4 py-3 text-micro text-t-dim tracking-widest text-center animate-[fade-in_500ms_ease_both]" key={idleMessage}>
              {idleMessage}
            </div>
          )}
          <InjectEvent sessionId={sessionId} settings={settings} disabled={status === "running"} />
        </section>

        {/* Sidebar — Asset Management */}
        <AssetPanel
          state={state}
          activeAgentId={activeAgentId}
          sessionId={sessionId}
          onChat={handleOpenChat}
          onExtractAgent={handleGenerateAgentSeed}
          onExtractWorld={handleGenerateWorldSeed}
          controlledAgents={controlledAgents}
          onTakeControl={handleTakeControl}
          onReleaseControl={handleReleaseControl}
        />
      </main>

      {/* Seed Preview Modal (lazy) */}
      {seedPreview && (
        <Suspense fallback={null}>
          <SeedPreview
            seed={seedPreview}
            onClose={handleCloseSeedPreview}
          />
        </Suspense>
      )}

      {/* Oracle Drawer (lazy — stays mounted after first open for exit animation) */}
      {oracleEverOpened && (
        <Suspense fallback={null}>
          <OracleDrawer
            sessionId={sessionId}
            settings={settings}
            open={oracleOpen}
            onClose={handleCloseOracle}
            tick={tick}
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
            onClose={handleCloseChat}
          />
        </Suspense>
      )}

      {/* Human Action Picker (lazy) */}
      {waitingAgent && (
        <Suspense fallback={null}>
          <ActionPicker
            context={waitingAgent.context}
            onSubmit={handleSubmitHumanAction}
            onCancel={handleCancelWaiting}
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
        worldTime={state?.world_time || null}
        onOracle={handleToggleOracle}
        oracleOpen={oracleOpen}
      />
    </div>
  );
}

function SimBootScreen() {
  return (
    <div className="h-screen flex flex-col bg-void scanlines">
      {/* Nav skeleton */}
      <div className="h-14 border-b border-b-DEFAULT shrink-0 flex items-center px-6">
        <div className="h-3 w-16 bg-surface-2 animate-shimmer bg-gradient-to-r from-surface-2 via-surface-3 to-surface-2 bg-[length:200%_100%]" />
      </div>
      {/* Main area */}
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="text-micro text-t-dim tracking-widest">
            <GlitchReveal text="// INITIALIZING" duration={500} />
            <span className="inline-block w-[0.55em] h-[1.1em] bg-t-dim ml-0.5 align-text-bottom animate-[cursor-pulse_1s_step-end_infinite]" aria-hidden="true" />
          </div>
          <div className="flex gap-px">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-1 w-8 bg-surface-2 animate-shimmer bg-gradient-to-r from-surface-2 via-surface-3 to-surface-2 bg-[length:200%_100%]"
                style={{ animationDelay: `${i * 200}ms` }}
              />
            ))}
          </div>
        </div>
      </div>
      {/* ControlBar skeleton */}
      <div className="h-14 border-t border-b-DEFAULT bg-surface-1 shrink-0 flex items-center px-4 gap-3">
        <div className="h-9 w-24 bg-surface-2 animate-shimmer bg-gradient-to-r from-surface-2 via-surface-3 to-surface-2 bg-[length:200%_100%]" />
        <div className="h-9 w-16 bg-surface-2 animate-shimmer bg-gradient-to-r from-surface-2 via-surface-3 to-surface-2 bg-[length:200%_100%]" style={{ animationDelay: "100ms" }} />
        <div className="w-px h-6 bg-b-DEFAULT" />
        <div className="h-4 w-20 bg-surface-2 animate-shimmer bg-gradient-to-r from-surface-2 via-surface-3 to-surface-2 bg-[length:200%_100%]" style={{ animationDelay: "200ms" }} />
      </div>
    </div>
  );
}

export default function SimPage() {
  return (
    <Suspense fallback={<SimBootScreen />}>
      <SimContent />
    </Suspense>
  );
}
