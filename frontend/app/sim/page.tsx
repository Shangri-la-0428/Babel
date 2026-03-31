"use client";

import { useEffect, useState, useCallback, useMemo, useRef, Suspense, lazy } from "react";
import { useIdleMessage } from "@/lib/hooks/use-idle-message";
import { useAtmosphere } from "@/lib/hooks/use-atmosphere";
import { useWorldTransitions } from "@/lib/hooks/use-world-transitions";
import { useReplay } from "@/lib/hooks/use-replay";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import {
  WorldState,
  EventData,
  RelationData,
  BabelSettings,
  SavedSeedData,
  HumanWaitingContext,
  hasConfiguredModel,
  hasSeenModelSetupReminder,
  getState,
  getHumanStatus,
  runWorld,
  pauseWorld,
  stepWorld,
  createWebSocket,
  loadSettings,
  markModelSetupReminderSeen,
  generateSeed,
  takeControl,
  releaseControl,
  submitHumanAction,
  forkWorld,
} from "@/lib/api";
import { useLocale } from "@/lib/locale-context";
import EventFeed from "@/components/EventFeed";
import AssetPanel from "@/components/AssetPanel";
import { buildAssetsHref, buildSimHref, buildWorldHref } from "@/lib/navigation";
import ControlBar from "@/components/ControlBar";
import Settings from "@/components/Settings";
import InjectEvent from "@/components/InjectEvent";
import SeekBar from "@/components/SeekBar";
import { ErrorBanner, GlitchReveal } from "@/components/ui";

const ParticleField = dynamic(() => import("@/components/ParticleField"), { ssr: false });
const WorldRadar = dynamic(() => import("@/components/WorldRadar"), { ssr: false });
const WorldShader = dynamic(() => import("@/components/WorldShader"), { ssr: false });
const SeedPreview = lazy(() => import("@/components/SeedPreview"));
const AgentChat = lazy(() => import("@/components/AgentChat"));
const OracleDrawer = lazy(() => import("@/components/OracleDrawer"));
const WorldReport = lazy(() => import("@/components/WorldReport"));

const MAX_EVENTS = 500;

function SimContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("id") || "";
  const seedFile = searchParams.get("seed") || "";
  const worldHref = buildWorldHref(seedFile || null);

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
  const [radarCollapsed, setRadarCollapsed] = useState(false);
  const [highlightsOnly, setHighlightsOnly] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  // Track relation strength deltas between ticks
  const prevRelationsRef = useRef<Map<string, number>>(new Map());
  const [relationDeltas, setRelationDeltas] = useState<Map<string, number>>(new Map());
  const [waitingAgents, setWaitingAgents] = useState<Record<string, HumanWaitingContext>>({});
  const { locale, toggle, t } = useLocale();
  const tRef = useRef(t);
  tRef.current = t;
  const [wsRetryExhausted, setWsRetryExhausted] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const highlightTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const operationRef = useRef(false); // guard against concurrent Run/Step
  // ── Extracted hooks ──
  const idleMessage = useIdleMessage(t);
  const { isNight, shaderEnergy, shaderRipple, tension } = useAtmosphere(state, status, events.length);
  const { showWorldBoot, showWorldEnded } = useWorldTransitions(status);
  const replay = useReplay(sessionId, tick);
  const assetsHref = buildAssetsHref({
    sessionId,
    worldName: state?.name,
    seedFile: seedFile || undefined,
    backHref: sessionId
      ? buildSimHref({ sessionId, seedFile: seedFile || undefined })
      : "/",
  });

  // Load initial state
  useEffect(() => {
    if (!sessionId) return;
    let mounted = true;
    getState(sessionId)
      .then((s) => {
        if (!mounted) return;
        setState(s);
        setEvents(s.recent_events || []);
        setTick(s.tick);
        setStatus(s.status || "paused");
      })
      .catch(() => { if (mounted) setError(tRef.current("failed_load_state")); });
    getHumanStatus(sessionId)
      .then((humanStatus) => {
        if (!mounted) return;
        setControlledAgents(new Set(humanStatus.controlled_agents || []));
        setWaitingAgents(humanStatus.waiting_contexts || {});
      })
      .catch(() => { /* human control hydration is best-effort */ });
    return () => { mounted = false; };
  }, [sessionId]);

  // WebSocket connection with reconnection
  const replayGateRef = replay.replayActiveRef;
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

        // Gate live state updates during replay (WS stays connected)
        const gated = replayGateRef.current;

        switch (data.type) {
          case "connected":
            if (!gated) {
              setState(data.data);
              setEvents(data.data.recent_events || []);
              setTick(data.data.tick ?? 0);
              setStatus(data.data.status || "paused");
            }
            break;

          case "event":
            if (!gated) {
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
                  highlightTimers.current.delete(timer);
                }, 1500);
                highlightTimers.current.add(timer);
              }
            }
            break;

          case "tick":
            if (!gated) {
              setTick(data.data.tick ?? 0);
              setStatus(data.data.status || "paused");
            }
            break;

          case "state_update":
            if (!gated) {
              // Compute relation strength deltas
              const rels = data.data.relations as RelationData[] | undefined;
              if (rels) {
                const deltas = new Map<string, number>();
                for (const r of rels) {
                  const key = `${r.source}→${r.target}`;
                  const prev = prevRelationsRef.current.get(key);
                  if (prev != null) {
                    const d = r.strength - prev;
                    if (Math.abs(d) > 0.01) deltas.set(key, d);
                  }
                }
                // Update prev snapshot
                const next = new Map<string, number>();
                for (const r of rels) next.set(`${r.source}→${r.target}`, r.strength);
                prevRelationsRef.current = next;
                if (deltas.size > 0) setRelationDeltas(deltas);
              }
              setState(data.data);
              setTick(data.data.tick ?? 0);
              setStatus(data.data.status || "paused");
            }
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
            setWaitingAgents((prev) => ({
              ...prev,
              [data.data.agent_id]: {
                agent_name: data.data.agent_name,
                location: data.data.location,
                inventory: data.data.inventory || [],
                visible_agents: data.data.visible_agents || [],
                reachable_locations: data.data.reachable_locations || [],
              },
            }));
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
            if (!data.data.controlled) {
              setWaitingAgents((prev) => {
                const next = { ...prev };
                delete next[data.data.agent_id];
                return next;
              });
            }
            break;

          case "error":
            setError(`${tRef.current("engine_error")}: ${data.data.message || "Unknown"}`);
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
          setError(tRef.current("lost_connection"));
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

    const timers = highlightTimers.current;
    return () => {
      mounted = false;
      clearTimeout(reconnectTimer.current);
      timers.forEach(clearTimeout);
      timers.clear();
      wsRef.current?.close();
    };
  }, [sessionId, replayGateRef]);

  function handleReconnect() {
    connectWsRef.current();
  }

  const checkSettings = useCallback((): boolean => {
    if (!hasConfiguredModel(settings)) {
      if (!hasSeenModelSetupReminder()) {
        markModelSetupReminderSeen();
        setError(t("model_setup_required_first"));
      } else {
        setError(t("api_key_required"));
      }
      setShowSettings(true);
      return false;
    }
    return true;
  }, [settings, t]);

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
  }, [sessionId, settings, tick, checkSettings, t]);

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
  }, [sessionId, settings, checkSettings, t]);

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

  const handleFork = useCallback(async () => {
    if (!sessionId) return;
    try {
      const result = await forkWorld(sessionId, tick);
      window.location.href = buildSimHref({ sessionId: result.session_id });
    } catch {
      setError(t("fork_failed"));
    }
  }, [sessionId, tick, t]);
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
      setWaitingAgents((prev) => {
        const next = { ...prev };
        delete next[agentId];
        return next;
      });
    } catch {
      setError(t("control_failed"));
    }
  }, [sessionId, t]);

  const handleSubmitHumanAction = useCallback(async (
    agentId: string,
    actionType: string,
    target: string,
    content: string,
  ) => {
    if (!sessionId) return;
    try {
      await submitHumanAction(sessionId, agentId, actionType, target, content);
      setWaitingAgents((prev) => {
        const next = { ...prev };
        delete next[agentId];
        return next;
      });
    } catch {
      setError(t("human_action_failed"));
      throw new Error("human_action_failed");
    }
  }, [sessionId, t]);

  // Derived display values: replay overlays live state
  const displayState = replay.isReplay ? (replay.replayState ?? state) : state;
  const displayEvents = replay.isReplay ? replay.replayEvents : events;
  const displayTick = replay.replayTick ?? tick;

  const activeAgentId = useMemo(
    () => (displayEvents.length > 0 ? displayEvents[displayEvents.length - 1]?.agent_id : null),
    [displayEvents]
  );

  // Radar: derive latest event location from agent state
  const latestEventLocation = useMemo(() => {
    if (!displayEvents.length || !displayState?.agents) return "";
    const last = displayEvents[displayEvents.length - 1];
    if (last.agent_id && displayState.agents[last.agent_id]) {
      return displayState.agents[last.agent_id].location;
    }
    return "";
  }, [displayEvents, displayState?.agents]);


  // Radar: agent list for Canvas visualization
  const radarAgents = useMemo(() => {
    if (!displayState?.agents) return [];
    return Object.entries(displayState.agents).map(([id, a]) => ({
      id,
      name: a.name,
      location: a.location,
      status: a.status,
    }));
  }, [displayState?.agents]);

  if (!sessionId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3">
        <div className="text-micro text-t-dim tracking-widest">{"// ERROR"}</div>
        <div className="text-detail text-t-muted normal-case tracking-normal">{t("no_session")}</div>
        <a href={worldHref} className="h-9 px-5 text-micro font-medium tracking-wider border border-b-DEFAULT text-t-muted hover:bg-surface-1/20 hover:border-primary hover:text-primary active:scale-[0.97] transition-[colors,transform] inline-flex items-center">
          {t("go_home")}
        </a>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-void scanlines relative isolate">
      {/* World boot scan — full viewport sweep on run start */}
      {showWorldBoot && (
        <div className="absolute inset-0 z-boot pointer-events-none animate-[world-boot-scan_600ms_ease-out_both]" aria-hidden="true">
          <div className="absolute inset-x-0 h-[2px] bg-primary/20 shadow-[0_0_12px_var(--color-primary-glow-strong)]" />
        </div>
      )}
      {/* World ended overlay — dramatic transition on simulation end */}
      {showWorldEnded && (
        <div
          className="absolute inset-0 z-boot pointer-events-none flex items-center justify-center bg-void/80 animate-[ended-fade-out_1500ms_ease-out_both]"
          aria-live="assertive"
          role="status"
        >
          {/* Danger scan line sweeping down */}
          <div className="absolute inset-x-0 top-0 h-[2px] bg-danger/40 shadow-[0_0_16px_var(--color-danger-glow)] animate-[ended-scan_800ms_ease-out_both]" />
          {/* WORLD ENDED text */}
          <div className="text-subheading font-bold tracking-widest text-danger drop-shadow-[0_0_16px_var(--color-danger-glow)] animate-[ended-text-glitch_600ms_ease_both]">
            <GlitchReveal text={t("simulation_complete")} duration={600} />
          </div>
        </div>
      )}
      {/* Overdrive A: WebGL depth terrain — parallax portal */}
      <WorldShader isNight={isNight} energy={shaderEnergy} ripple={shaderRipple} tension={tension} />
      <ParticleField
        status={status}
        isNight={isNight}
        eventCount={events.length}
        ripple={shaderRipple}
      />
      {/* Overdrive: Event shockwave ring overlay */}
      {shaderRipple > 0 && (
        <div
          className="absolute inset-0 pointer-events-none overflow-hidden z-fx-overlay"
          aria-hidden="true"
        >
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-[shockwave-ring_800ms_cubic-bezier(0.16,1,0.3,1)_both]"
            style={{
              width: "200vmax",
              height: "200vmax",
              border: `1px solid rgba(192, 254, 4, ${0.15 * shaderRipple})`,
              boxShadow: `0 0 40px rgba(192, 254, 4, ${0.06 * shaderRipple}), inset 0 0 40px rgba(192, 254, 4, ${0.03 * shaderRipple})`,
            }}
          />
        </div>
      )}
      {/* Overdrive B: Tension vignette — danger bleed at edges */}
      {tension > 0 && (
        <div
          className="absolute inset-0 pointer-events-none transition-opacity duration-[1500ms] z-fx-overlay"
          style={{
            opacity: tension,
            background: "radial-gradient(ellipse at center, transparent 25%, rgba(242, 71, 35, 0.12) 100%)",
          }}
          aria-hidden="true"
        />
      )}
      <h1 className="sr-only">{t("simulate")}</h1>
      <nav aria-label="Main navigation" className="flex items-center justify-between h-14 px-6 border-b border-b-DEFAULT shrink-0">
        <div className="flex items-center gap-4 min-w-0">
          <a href={worldHref} className="text-micro text-t-muted tracking-wider hover:text-primary transition-colors shrink-0">
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
          <a href={assetsHref} className="text-micro text-t-muted tracking-widest hover:text-t-DEFAULT transition-colors">
            {t("assets")}
          </a>
          <button
            type="button"
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
            type="button"
            onClick={toggle}
            className="text-micro text-t-dim tracking-wider border border-surface-3 px-3 py-1 hover:text-t-DEFAULT hover:border-b-hover active:scale-[0.97] transition-[colors,transform]"
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
              type="button"
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
      <main className="flex-1 grid grid-cols-[1fr_var(--sidebar-width)] min-w-[1024px] overflow-hidden">
        {/* Event Feed */}
        <section className="flex flex-col border-r border-b-DEFAULT overflow-hidden" aria-label="Event feed">
          {/* World Radar — Direction A */}
          {state && (state.locations?.length ?? 0) > 0 && (
            <div className="border-b border-b-DEFAULT shrink-0 bg-void relative">
              <button
                type="button"
                onClick={() => setRadarCollapsed((p) => !p)}
                className="absolute top-1.5 left-4 text-micro text-t-dim tracking-widest z-10 hover:text-t-muted transition-colors"
                aria-expanded={!radarCollapsed}
                aria-controls="world-radar-panel"
              >
                TACTICAL {radarCollapsed ? "▸" : "▾"}
              </button>
              <div
                id="world-radar-panel"
                className="accordion-grid"
                data-open={!radarCollapsed}
              >
                <div className="accordion-inner" style={{ height: radarCollapsed ? 0 : 152 }}>
                  <WorldRadar
                    locations={state.locations}
                    agents={radarAgents}
                    isRunning={status === "running"}
                    latestEventLocation={latestEventLocation}
                    tick={tick}
                  />
                </div>
              </div>
              {/* Reserve space for toggle button when collapsed */}
              {radarCollapsed && <div className="h-7" />}
            </div>
          )}
          <div className="px-4 py-3 border-b border-b-DEFAULT bg-surface-1 flex justify-between items-center shrink-0">
            <span className="text-micro text-t-muted tracking-widest">
              {t("event_feed")}
            </span>
            <span className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setHighlightsOnly((p) => !p)}
                aria-pressed={highlightsOnly}
                className={`text-micro tracking-wider px-2 py-0.5 border leading-none font-medium transition-[colors,box-shadow] active:scale-[0.97] ${
                  highlightsOnly
                    ? "border-primary text-primary shadow-[0_0_8px_var(--color-primary-glow)]"
                    : "border-b-DEFAULT text-t-dim hover:text-t-muted hover:border-b-hover"
                }`}
              >
                {t("highlights")}
              </button>
              <span className="text-micro text-t-muted tracking-wider">
                {events.length} {t("events_count")}
              </span>
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
                events={displayEvents}
                newEventIds={newEventIds}
                onSeed={handleGenerateEventSeed}
                worldTimeDisplay={displayState?.world_time?.display}
                highlightsOnly={highlightsOnly}
              />
            )}
          </div>
          {idleMessage && status !== "running" && (
            <div className="px-4 py-3 text-micro text-t-dim tracking-widest text-center animate-[fade-in_500ms_ease_both]" key={idleMessage}>
              {idleMessage}
            </div>
          )}
          <InjectEvent sessionId={sessionId} settings={settings} disabled={status === "running" || replay.isReplay} />
        </section>

        {/* Sidebar — Asset Management */}
        <AssetPanel
          state={displayState}
          activeAgentId={activeAgentId}
          sessionId={sessionId}
          seedFile={seedFile || undefined}
          onChat={handleOpenChat}
          onExtractAgent={handleGenerateAgentSeed}
          onExtractWorld={handleGenerateWorldSeed}
          controlledAgents={controlledAgents}
          waitingAgents={waitingAgents}
          onTakeControl={handleTakeControl}
          onReleaseControl={handleReleaseControl}
          onSubmitHumanAction={handleSubmitHumanAction}
          relationDeltas={relationDeltas}
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

      {/* Seek Bar */}
      <SeekBar
        currentTick={tick}
        replayTick={replay.replayTick}
        maxTick={replay.maxTick}
        seeking={replay.seeking}
        onSeek={replay.seekTo}
        onExitReplay={replay.exitReplay}
        isReplay={replay.isReplay}
      />

      {/* Control Bar */}
      <ControlBar
        tick={displayTick}
        status={status}
        onRun={handleRun}
        onPause={handlePause}
        onStep={handleStep}
        disabled={loading && status !== "running"}
        wsStatus={wsStatus}
        worldTime={displayState?.world_time || null}
        onOracle={handleToggleOracle}
        oracleOpen={oracleOpen}
        isReplay={replay.isReplay}
        onFork={handleFork}
        hasControlledAgents={controlledAgents.size > 0}
        onReport={() => setReportOpen((v) => !v)}
        reportOpen={reportOpen}
      />

      {/* World Report overlay */}
      {reportOpen && sessionId && (
        <Suspense fallback={null}>
          <WorldReport
            sessionId={sessionId}
            open={reportOpen}
            onClose={() => setReportOpen(false)}
          />
        </Suspense>
      )}
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
