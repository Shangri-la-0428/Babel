const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── Fetch with timeout & abort support ──

const DEFAULT_TIMEOUT = 15_000; // 15s for normal API calls
const LONG_TIMEOUT = 60_000; // 60s for LLM-backed operations (step, chat, generate)

class ApiError extends Error {
  status: number;
  constructor(status: number, statusText: string) {
    super(`${status} ${statusText}`);
    this.status = status;
    this.name = "ApiError";
  }
}

async function fetchWithTimeout(
  input: RequestInfo,
  init?: RequestInit & { timeout?: number },
): Promise<Response> {
  const { timeout = DEFAULT_TIMEOUT, ...fetchInit } = init || {};
  const controller = new AbortController();
  if (fetchInit.signal) {
    // If caller passes an external signal, chain it
    fetchInit.signal.addEventListener("abort", () => controller.abort());
  }
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(input, { ...fetchInit, signal: controller.signal });
    return res;
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new Error("Request timed out");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── Settings (stored in localStorage) ──

export interface BabelSettings {
  apiKey: string;
  apiBase: string;
  model: string;
  tickDelay: number;
}

export interface BabelSettingsProfile extends BabelSettings {
  id: string;
  name: string;
  cachedModels: string[];
}

export interface BabelSettingsStore {
  version: number;
  activeProfileId: string;
  profiles: BabelSettingsProfile[];
}

const SETTINGS_KEY = "babel_settings";
const SETTINGS_PROFILES_KEY = "babel_settings_profiles";
const SETTINGS_BOOTSTRAP_KEY = "babel_settings_bootstrap_profiles";
const SETTINGS_VERSION = 2;

const DEFAULT_SETTINGS: BabelSettings = {
  apiKey: "",
  apiBase: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  tickDelay: 3.0,
};

const SETTINGS_BOOTSTRAP_ENV = process.env.NEXT_PUBLIC_BABEL_BOOTSTRAP_PROFILES || "";

function createProfileId(): string {
  return `profile_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function clampTickDelay(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SETTINGS.tickDelay;
  return Math.max(0.5, Math.min(30, parsed));
}

function normalizeSettings(raw: Partial<BabelSettings> | null | undefined): BabelSettings {
  return {
    apiKey: typeof raw?.apiKey === "string" ? raw.apiKey.trim() : DEFAULT_SETTINGS.apiKey,
    apiBase: typeof raw?.apiBase === "string" ? raw.apiBase.trim() : DEFAULT_SETTINGS.apiBase,
    model: typeof raw?.model === "string" ? raw.model.trim() : DEFAULT_SETTINGS.model,
    tickDelay: clampTickDelay(raw?.tickDelay),
  };
}

function normalizeProfile(
  raw: Partial<BabelSettingsProfile> | null | undefined,
  fallbackName: string,
): BabelSettingsProfile {
  const settings = normalizeSettings(raw);
  return {
    id: typeof raw?.id === "string" && raw.id.trim() ? raw.id.trim() : createProfileId(),
    name: typeof raw?.name === "string" && raw.name.trim() ? raw.name.trim() : fallbackName,
    cachedModels: Array.isArray(raw?.cachedModels)
      ? raw.cachedModels.filter((model): model is string => typeof model === "string" && model.trim().length > 0)
      : [],
    ...settings,
  };
}

function createDefaultProfile(overrides?: Partial<BabelSettingsProfile>): BabelSettingsProfile {
  const fallbackName =
    typeof overrides?.name === "string" && overrides.name.trim()
      ? overrides.name.trim()
      : "Default";
  return normalizeProfile({ ...DEFAULT_SETTINGS, ...overrides }, fallbackName);
}

function createDefaultStore(): BabelSettingsStore {
  const profile = createDefaultProfile();
  return {
    version: SETTINGS_VERSION,
    activeProfileId: profile.id,
    profiles: [profile],
  };
}

function parseBootstrapProfiles(): BabelSettingsProfile[] {
  if (!SETTINGS_BOOTSTRAP_ENV.trim()) return [];

  try {
    const raw = JSON.parse(SETTINGS_BOOTSTRAP_ENV);
    if (!Array.isArray(raw)) return [];

    return raw.map((profile, index) =>
      normalizeProfile(
        typeof profile === "object" && profile !== null
          ? (profile as Partial<BabelSettingsProfile>)
          : undefined,
        index === 0 ? "Bootstrap" : `Bootstrap ${index + 1}`,
      ),
    );
  } catch {
    return [];
  }
}

function applyBootstrapProfiles(store: BabelSettingsStore): {
  store: BabelSettingsStore;
  changed: boolean;
} {
  if (typeof window === "undefined") {
    return { store, changed: false };
  }

  const bootstrapProfiles = parseBootstrapProfiles();
  if (bootstrapProfiles.length === 0) {
    return { store, changed: false };
  }

  try {
    if (localStorage.getItem(SETTINGS_BOOTSTRAP_KEY) === SETTINGS_BOOTSTRAP_ENV) {
      return { store, changed: false };
    }
  } catch {
    return { store, changed: false };
  }

  const profiles = [...store.profiles];
  let changed = false;
  let firstBootstrapProfileId: string | null = null;

  for (const incoming of bootstrapProfiles) {
    const matchIndex = profiles.findIndex(
      (profile) =>
        profile.id === incoming.id ||
        profile.name.trim().toLowerCase() === incoming.name.trim().toLowerCase(),
    );

    if (matchIndex >= 0) {
      profiles[matchIndex] = {
        ...profiles[matchIndex],
        ...incoming,
        cachedModels:
          incoming.cachedModels.length > 0
            ? incoming.cachedModels
            : profiles[matchIndex].cachedModels,
      };
      if (!firstBootstrapProfileId) {
        firstBootstrapProfileId = profiles[matchIndex].id;
      }
    } else {
      profiles.push(incoming);
      if (!firstBootstrapProfileId) {
        firstBootstrapProfileId = incoming.id;
      }
    }

    changed = true;
  }

  const currentActiveProfile =
    profiles.find((profile) => profile.id === store.activeProfileId) || profiles[0];
  const shouldActivateBootstrap =
    !!firstBootstrapProfileId &&
    (!currentActiveProfile?.apiKey.trim() || !currentActiveProfile?.model.trim());

  try {
    localStorage.setItem(SETTINGS_BOOTSTRAP_KEY, SETTINGS_BOOTSTRAP_ENV);
  } catch {
    // Ignore localStorage write failures and continue with the in-memory store.
  }

  return {
    changed,
    store: {
      version: SETTINGS_VERSION,
      activeProfileId: shouldActivateBootstrap
        ? firstBootstrapProfileId!
        : profiles.some((profile) => profile.id === store.activeProfileId)
          ? store.activeProfileId
          : profiles[0].id,
      profiles,
    },
  };
}

function normalizeStore(raw: unknown): BabelSettingsStore | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as {
    activeProfileId?: unknown;
    profiles?: unknown;
  };
  if (!Array.isArray(candidate.profiles) || candidate.profiles.length === 0) return null;

  const profiles = candidate.profiles.map((profile, index) =>
    normalizeProfile(
      typeof profile === "object" && profile !== null
        ? (profile as Partial<BabelSettingsProfile>)
        : undefined,
      index === 0 ? "Default" : `Profile ${index + 1}`,
    )
  );

  const activeProfileId =
    typeof candidate.activeProfileId === "string" &&
    profiles.some((profile) => profile.id === candidate.activeProfileId)
      ? candidate.activeProfileId
      : profiles[0].id;

  return {
    version: SETTINGS_VERSION,
    activeProfileId,
    profiles,
  };
}

function readLegacySettings(): BabelSettings | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return null;
  }
}

function toSettings(profile: BabelSettingsProfile): BabelSettings {
  return {
    apiKey: profile.apiKey,
    apiBase: profile.apiBase,
    model: profile.model,
    tickDelay: profile.tickDelay,
  };
}

function getProfileById(store: BabelSettingsStore, profileId: string): BabelSettingsProfile {
  return store.profiles.find((profile) => profile.id === profileId) || store.profiles[0];
}

export function createSettingsProfile(
  seed?: Partial<BabelSettingsProfile>,
): BabelSettingsProfile {
  const fallbackName =
    typeof seed?.name === "string" && seed.name.trim()
      ? seed.name.trim()
      : "New Profile";
  return normalizeProfile(seed, fallbackName);
}

export function loadSettingsProfiles(): BabelSettingsStore {
  if (typeof window === "undefined") return createDefaultStore();

  try {
    const raw = localStorage.getItem(SETTINGS_PROFILES_KEY);
    if (raw) {
      const parsed = normalizeStore(JSON.parse(raw));
      if (parsed) {
        const bootstrapped = applyBootstrapProfiles(parsed);
        if (bootstrapped.changed) {
          saveSettingsProfiles(bootstrapped.store);
        }
        return bootstrapped.store;
      }
    }
  } catch {
    // Fall back to legacy single-profile storage.
  }

  const legacy = readLegacySettings();
  if (legacy) {
    const profile = createDefaultProfile({ ...legacy, name: "Default" });
    const store = {
      version: SETTINGS_VERSION,
      activeProfileId: profile.id,
      profiles: [profile],
    };
    const bootstrapped = applyBootstrapProfiles(store);
    if (bootstrapped.changed) {
      saveSettingsProfiles(bootstrapped.store);
    }
    return bootstrapped.store;
  }

  const store = createDefaultStore();
  const bootstrapped = applyBootstrapProfiles(store);
  if (bootstrapped.changed) {
    saveSettingsProfiles(bootstrapped.store);
  }
  return bootstrapped.store;
}

export function getActiveSettingsProfile(store: BabelSettingsStore): BabelSettingsProfile {
  return getProfileById(store, store.activeProfileId);
}

export function loadSettings(): BabelSettings {
  return toSettings(getActiveSettingsProfile(loadSettingsProfiles()));
}

export function saveSettingsProfiles(store: BabelSettingsStore): void {
  if (typeof window === "undefined") return;

  const normalized = normalizeStore(store) || createDefaultStore();
  const activeProfile = getActiveSettingsProfile(normalized);

  localStorage.setItem(SETTINGS_PROFILES_KEY, JSON.stringify(normalized));
  // Keep the original key in sync so older code and tests still see the active config.
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(toSettings(activeProfile)));
}

export function saveSettings(settings: BabelSettings): void {
  const store = loadSettingsProfiles();
  const nextStore: BabelSettingsStore = {
    ...store,
    profiles: store.profiles.map((profile) =>
      profile.id === store.activeProfileId
        ? { ...profile, ...normalizeSettings(settings) }
        : profile
    ),
  };
  saveSettingsProfiles(nextStore);
}

// ── Types ──

export interface ActiveGoal {
  text: string;
  status: string;       // active | completed | failed | stalled
  progress: number;     // 0.0-1.0
  stall_count: number;
  started_tick: number;
}

export interface RelationData {
  source: string;
  target: string;
  type: string;         // ally | hostile | neutral | rival | trust
  strength: number;     // 0.0-1.0
  last_tick: number;
}

export interface PsycheState {
  chemicals: { DA: number; HT: number; CORT: number; OT: number; NE: number; END: number };
  autonomic: string;
  emotion: string;
  drives: Record<string, number>;
}

export interface AgentData {
  name: string;
  description: string;
  personality: string;
  goals: string[];
  location: string;
  inventory: string[];
  status: string;
  memory?: string[];
  role?: "main" | "supporting";
  active_goal?: ActiveGoal | null;
  immediate_intent?: string;
  psyche?: PsycheState;
}

export interface EventData {
  id: string;
  tick: number;
  agent_id: string | null;
  agent_name: string | null;
  action_type: string;
  action: Record<string, unknown>;
  result: string;
  agent_role?: string;
}

export interface WorldTimeInfo {
  display: string;   // "Day 1, 22:15" or "Tick 15"
  period: string;    // "night", "morning", etc.
  day: number;
  is_night: boolean;
}

export interface WorldState {
  session_id: string;
  name: string;
  description: string;
  tick: number;
  status: string;
  locations: { name: string; description: string }[];
  items?: WorldItemData[];
  rules: string[];
  agents: Record<string, AgentData>;
  recent_events: EventData[];
  entity_details?: Record<string, Record<string, unknown>>;
  world_time?: WorldTimeInfo;
  relations?: RelationData[];
}

export interface SeedInfo {
  file: string;
  name: string;
  description: string;
  agent_count: number;
  location_count: number;
}

export interface WorldItemData {
  name: string;
  description: string;
  origin: string;
  properties: string[];
  significance: string;
}

// ── Model listing (direct to LLM provider) ──

export async function fetchModels(apiBase: string, apiKey: string): Promise<string[]> {
  try {
    const base = apiBase.replace(/\/+$/, "");
    const url = base.endsWith("/v1") ? `${base}/models` : `${base}/v1/models`;
    const res = await fetchWithTimeout(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 10_000,
    });
    if (!res.ok) return [];
    const data = await res.json();
    const models: string[] = (data.data || [])
      .map((m: { id: string }) => m.id)
      .sort();
    return models;
  } catch {
    return [];
  }
}

// ── Backend API ──

function assertOk(res: Response): void {
  if (!res.ok) throw new ApiError(res.status, res.statusText);
}

export async function fetchSeeds(): Promise<SeedInfo[]> {
  const res = await fetchWithTimeout(`${API_BASE}/api/seeds`);
  assertOk(res);
  return res.json();
}

export interface SeedDetail {
  file: string;
  name: string;
  description: string;
  rules: string[];
  locations: { name: string; description: string }[];
  items: WorldItemData[];
  agents: {
    id: string;
    name: string;
    description: string;
    personality: string;
    goals: string[];
    inventory: string[];
    location: string;
  }[];
  initial_events: string[];
}

export interface WorldSeedPayload {
  name: string;
  description: string;
  rules: string[];
  locations: { name: string; description: string }[];
  items: WorldItemData[];
  agents: {
    id: string;
    name: string;
    description: string;
    personality: string;
    goals: string[];
    inventory: string[];
    location: string;
  }[];
  initial_events: string[];
}

export async function fetchSeedDetail(filename: string): Promise<SeedDetail> {
  const res = await fetchWithTimeout(`${API_BASE}/api/seeds/${encodeURIComponent(filename)}`);
  assertOk(res);
  return res.json();
}

export async function createFromSeed(filename: string): Promise<{ session_id: string; seed_file?: string }> {
  const res = await fetchWithTimeout(`${API_BASE}/api/worlds/from-seed/${encodeURIComponent(filename)}`, {
    method: "POST",
  });
  assertOk(res);
  return res.json();
}

export async function deleteWorldSeed(filename: string): Promise<void> {
  const res = await fetchWithTimeout(`${API_BASE}/api/seeds/${encodeURIComponent(filename)}`, {
    method: "DELETE",
  });
  assertOk(res);
}

export async function createWorld(data: WorldSeedPayload): Promise<{ session_id: string; seed_file?: string }> {
  const res = await fetchWithTimeout(`${API_BASE}/api/worlds`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  assertOk(res);
  return res.json();
}

export async function updateWorldSeed(filename: string, data: WorldSeedPayload): Promise<SeedInfo> {
  const res = await fetchWithTimeout(`${API_BASE}/api/seeds/${encodeURIComponent(filename)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  assertOk(res);
  return res.json();
}

export async function createOracleDraftSession(): Promise<{
  session_id: string;
  name: string;
  tick: number;
  status: string;
}> {
  const res = await fetchWithTimeout(`${API_BASE}/api/oracle/draft`, {
    method: "POST",
  });
  assertOk(res);
  return res.json();
}

export async function getState(sessionId: string): Promise<WorldState> {
  const res = await fetchWithTimeout(`${API_BASE}/api/worlds/${sessionId}/state`);
  assertOk(res);
  return res.json();
}

export async function runWorld(
  sessionId: string,
  opts: { max_ticks?: number; model?: string; api_key?: string; api_base?: string; tick_delay?: number } = {}
): Promise<void> {
  const res = await fetchWithTimeout(`${API_BASE}/api/worlds/${sessionId}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      max_ticks: opts.max_ticks ?? 50,
      model: opts.model ?? null,
      api_key: opts.api_key ?? null,
      api_base: opts.api_base ?? null,
      tick_delay: opts.tick_delay ?? 3.0,
    }),
  });
  assertOk(res);
}

export async function stepWorld(
  sessionId: string,
  opts: { model?: string; api_key?: string; api_base?: string } = {}
): Promise<{ tick: number; events: { agent_name: string; action_type: string; result: string }[] }> {
  const res = await fetchWithTimeout(`${API_BASE}/api/worlds/${sessionId}/step`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model ?? null,
      api_key: opts.api_key ?? null,
      api_base: opts.api_base ?? null,
    }),
    timeout: LONG_TIMEOUT,
  });
  assertOk(res);
  return res.json();
}

export async function pauseWorld(sessionId: string): Promise<void> {
  const res = await fetchWithTimeout(`${API_BASE}/api/worlds/${sessionId}/pause`, {
    method: "POST",
  });
  assertOk(res);
}

export async function getSessions(): Promise<
  { id: string; world_seed: string; tick: number; status: string; created_at: string }[]
> {
  const res = await fetchWithTimeout(`${API_BASE}/api/sessions`);
  assertOk(res);
  return res.json();
}

export async function deleteSession(sessionId: string): Promise<void> {
  const res = await fetchWithTimeout(`${API_BASE}/api/sessions/${sessionId}`, { method: "DELETE" });
  assertOk(res);
}

export async function getSessionEvents(
  sessionId: string,
  limit: number = 3
): Promise<EventData[]> {
  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/api/worlds/${sessionId}/events?limit=${limit}`
    );
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function injectEvent(
  sessionId: string,
  content: string
): Promise<{ id: string; tick: number; result: string; new_agent?: { agent_id: string; name: string } }> {
  const res = await fetchWithTimeout(`${API_BASE}/api/worlds/${sessionId}/inject`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
    timeout: LONG_TIMEOUT,
  });
  assertOk(res);
  return res.json();
}

export async function chatWithAgent(
  sessionId: string,
  agentId: string,
  message: string,
  opts: { model?: string; api_key?: string; api_base?: string; language?: string } = {}
): Promise<{ agent_id: string; agent_name: string; reply: string }> {
  const res = await fetchWithTimeout(`${API_BASE}/api/worlds/${sessionId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agent_id: agentId,
      message,
      model: opts.model ?? null,
      api_key: opts.api_key ?? null,
      api_base: opts.api_base ?? null,
      language: opts.language ?? null,
    }),
    timeout: LONG_TIMEOUT,
  });
  assertOk(res);
  return res.json();
}

export async function enrichEntity(
  sessionId: string,
  entityType: "agent" | "item" | "location",
  entityId: string,
  opts: { language?: string } = {},
): Promise<Record<string, unknown>> {
  const settings = loadSettings();
  const res = await fetchWithTimeout(
    `${API_BASE}/api/worlds/${sessionId}/enrich`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entity_type: entityType,
        entity_id: entityId,
        language: opts.language ?? null,
        model: settings.model.trim() || null,
        api_key: settings.apiKey.trim() || null,
        api_base: settings.apiBase.trim() || null,
      }),
      timeout: LONG_TIMEOUT,
    },
  );
  assertOk(res);
  const data = await res.json();
  const details = data.details || data;
  if (!details || Object.keys(details).length === 0) {
    throw new Error("Empty entity details");
  }
  return details;
}

export async function getEntityDetails(
  sessionId: string,
  entityType: "agent" | "item" | "location",
  entityId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/api/worlds/${sessionId}/entity-details?entity_type=${encodeURIComponent(entityType)}&entity_id=${encodeURIComponent(entityId)}`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.details || null;
  } catch {
    return null;
  }
}

export async function saveEntityDetails(
  sessionId: string,
  entityType: "agent" | "item" | "location",
  entityId: string,
  details: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetchWithTimeout(`${API_BASE}/api/worlds/${sessionId}/entity-details`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      entity_type: entityType,
      entity_id: entityId,
      details,
    }),
  });
  assertOk(res);
  const data = await res.json();
  return data.details || details;
}

// ── Oracle (Omniscient Narrator) ──

export interface OracleMessage {
  id: string;
  role: "user" | "oracle";
  content: string;
  tick: number;
  created_at: string;
}

export async function chatWithOracle(
  sessionId: string,
  message: string,
  opts: { model?: string; api_key?: string; api_base?: string; signal?: AbortSignal; mode?: string; language?: string } = {},
): Promise<{ reply: string; message_id: string; mode?: string; seed?: Record<string, unknown> }> {
  const res = await fetchWithTimeout(`${API_BASE}/api/worlds/${sessionId}/oracle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      mode: opts.mode ?? "narrate",
      model: opts.model ?? null,
      api_key: opts.api_key ?? null,
      api_base: opts.api_base ?? null,
      language: opts.language ?? null,
    }),
    timeout: LONG_TIMEOUT,
    signal: opts.signal,
  });
  if (!res.ok) {
    let detail = "";
    try {
      const data = await res.json();
      if (typeof data?.detail === "string") detail = data.detail;
    } catch {
      // Ignore parse failures and fall back to generic status text.
    }
    throw new Error(detail || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function getOracleHistory(
  sessionId: string,
  limit: number = 50,
  signal?: AbortSignal,
): Promise<OracleMessage[]> {
  const res = await fetchWithTimeout(
    `${API_BASE}/api/worlds/${sessionId}/oracle/history?limit=${limit}`,
    { signal },
  );
  assertOk(res);
  return res.json();
}

// ── Human Agent Control ("Play as Agent") ──

export interface HumanWaitingContext {
  agent_name: string;
  location: string;
  inventory: string[];
  visible_agents: { id: string; name: string; location: string }[];
  reachable_locations: string[];
}

export interface HumanStatus {
  controlled_agents: string[];
  waiting_agents: string[];
  waiting_contexts: Record<string, HumanWaitingContext>;
}

export async function takeControl(sessionId: string, agentId: string): Promise<void> {
  const res = await fetchWithTimeout(
    `${API_BASE}/api/worlds/${sessionId}/take-control/${agentId}`,
    { method: "POST" },
  );
  assertOk(res);
}

export async function releaseControl(sessionId: string, agentId: string): Promise<void> {
  const res = await fetchWithTimeout(
    `${API_BASE}/api/worlds/${sessionId}/release-control/${agentId}`,
    { method: "POST" },
  );
  assertOk(res);
}

export async function submitHumanAction(
  sessionId: string,
  agentId: string,
  actionType: string,
  target: string = "",
  content: string = "",
): Promise<void> {
  const res = await fetchWithTimeout(
    `${API_BASE}/api/worlds/${sessionId}/human-action`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_id: agentId,
        action_type: actionType,
        target,
        content,
      }),
    },
  );
  assertOk(res);
}

export async function getHumanStatus(sessionId: string): Promise<HumanStatus> {
  const res = await fetchWithTimeout(`${API_BASE}/api/worlds/${sessionId}/human-status`);
  assertOk(res);
  const data = await res.json();
  return {
    controlled_agents: Array.isArray(data?.controlled_agents)
      ? data.controlled_agents.filter((agentId: unknown): agentId is string => typeof agentId === "string")
      : [],
    waiting_agents: Array.isArray(data?.waiting_agents)
      ? data.waiting_agents.filter((agentId: unknown): agentId is string => typeof agentId === "string")
      : [],
    waiting_contexts:
      data?.waiting_contexts && typeof data.waiting_contexts === "object"
        ? (data.waiting_contexts as Record<string, HumanWaitingContext>)
        : {},
  };
}

export function createWebSocket(sessionId: string): WebSocket {
  const wsBase = API_BASE.replace(/^http/, "ws");
  return new WebSocket(`${wsBase}/ws/${sessionId}`);
}

// ── Asset Library (Seeds) ──

export type SeedTypeValue = "world" | "agent" | "item" | "location" | "event";

export interface SavedSeedData {
  id: string;
  type: SeedTypeValue;
  name: string;
  description: string;
  tags: string[];
  data: Record<string, unknown>;
  source_world: string;
  created_at: string;
  virtual?: boolean;
  context_session_id?: string;
}

export async function fetchAssets(type?: SeedTypeValue): Promise<SavedSeedData[]> {
  const url = type
    ? `${API_BASE}/api/assets?type=${type}`
    : `${API_BASE}/api/assets`;
  const res = await fetchWithTimeout(url);
  assertOk(res);
  return res.json();
}

export interface AssetPayload {
  type: SeedTypeValue;
  name: string;
  description?: string;
  tags?: string[];
  data?: Record<string, unknown>;
  source_world?: string;
}

export async function saveAsset(data: AssetPayload): Promise<{ id: string; name: string; type: string }> {
  const res = await fetchWithTimeout(`${API_BASE}/api/assets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  assertOk(res);
  return res.json();
}

export async function updateAsset(id: string, data: Partial<AssetPayload>): Promise<SavedSeedData> {
  const res = await fetchWithTimeout(`${API_BASE}/api/assets/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  assertOk(res);
  return res.json();
}

export async function deleteAsset(id: string): Promise<void> {
  const res = await fetchWithTimeout(`${API_BASE}/api/assets/${id}`, { method: "DELETE" });
  assertOk(res);
}

export async function generateSeed(
  seedType: SeedTypeValue,
  sessionId: string,
  targetId: string = ""
): Promise<SavedSeedData> {
  const settings = loadSettings();
  const res = await fetchWithTimeout(`${API_BASE}/api/assets/extract/${seedType}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      target_id: targetId,
      model: settings.model.trim() || null,
      api_key: settings.apiKey.trim() || null,
      api_base: settings.apiBase.trim() || null,
    }),
    timeout: LONG_TIMEOUT,
  });
  assertOk(res);
  return res.json();
}

// ── Timeline & Replay ──

export interface TimelineNode {
  id: string;
  session_id: string;
  tick: number;
  parent_id: string | null;
  branch_id: string;
  node_type: string;
  summary: string;
  event_count: number;
  agent_locations: Record<string, string>;
  significant: boolean;
  created_at: string;
}

export interface ReconstructedState {
  tick: number;
  snapshot_tick: number;
  world_seed: Record<string, unknown>;
  agent_states: Record<string, Record<string, unknown>>;
  events_since_snapshot: EventData[];
}

export async function getTimeline(
  sessionId: string,
  fromTick = 0,
  toTick?: number,
): Promise<{ nodes: TimelineNode[]; branch: string }> {
  const params = new URLSearchParams({ from_tick: String(fromTick) });
  if (toTick !== undefined) params.set("to_tick", String(toTick));
  const res = await fetchWithTimeout(`${API_BASE}/api/worlds/${sessionId}/timeline?${params}`);
  assertOk(res);
  return res.json();
}

export async function reconstructAtTick(
  sessionId: string,
  tick: number,
  signal?: AbortSignal,
): Promise<ReconstructedState> {
  const res = await fetchWithTimeout(`${API_BASE}/api/worlds/${sessionId}/reconstruct`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tick }),
    timeout: LONG_TIMEOUT,
    signal,
  });
  assertOk(res);
  return res.json();
}
