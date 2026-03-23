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

const SETTINGS_KEY = "babel_settings";

const DEFAULT_SETTINGS: BabelSettings = {
  apiKey: "",
  apiBase: "https://api.aigocode.com/v1",
  model: "gpt-5.4",
  tickDelay: 3.0,
};

export function loadSettings(): BabelSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: BabelSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// ── Types ──

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
  rules: string[];
  agents: Record<string, AgentData>;
  recent_events: EventData[];
  entity_details?: Record<string, Record<string, unknown>>;
  world_time?: WorldTimeInfo;
}

export interface SeedInfo {
  file: string;
  name: string;
  description: string;
  agent_count: number;
  location_count: number;
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
  const res = await fetchWithTimeout(`${API_BASE}/api/seeds/${filename}`);
  assertOk(res);
  return res.json();
}

export async function createFromSeed(filename: string): Promise<{ session_id: string }> {
  const res = await fetchWithTimeout(`${API_BASE}/api/worlds/from-seed/${filename}`, {
    method: "POST",
  });
  assertOk(res);
  return res.json();
}

export async function createWorld(data: {
  name: string;
  description: string;
  rules: string[];
  locations: { name: string; description: string }[];
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
}): Promise<{ session_id: string }> {
  const res = await fetchWithTimeout(`${API_BASE}/api/worlds`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
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
  opts: { model?: string; api_key?: string; api_base?: string } = {}
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
): Promise<Record<string, unknown>> {
  const res = await fetchWithTimeout(
    `${API_BASE}/api/worlds/${sessionId}/enrich`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity_type: entityType, entity_id: entityId }),
      timeout: LONG_TIMEOUT,
    },
  );
  assertOk(res);
  const data = await res.json();
  return data.details || data;
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
  opts: { model?: string; api_key?: string; api_base?: string; signal?: AbortSignal } = {},
): Promise<{ reply: string; message_id: string }> {
  const res = await fetchWithTimeout(`${API_BASE}/api/worlds/${sessionId}/oracle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      model: opts.model ?? null,
      api_key: opts.api_key ?? null,
      api_base: opts.api_base ?? null,
    }),
    timeout: LONG_TIMEOUT,
    signal: opts.signal,
  });
  assertOk(res);
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
}

export async function fetchAssets(type?: SeedTypeValue): Promise<SavedSeedData[]> {
  const url = type
    ? `${API_BASE}/api/assets?type=${type}`
    : `${API_BASE}/api/assets`;
  const res = await fetchWithTimeout(url);
  assertOk(res);
  return res.json();
}

export async function saveAsset(data: {
  type: SeedTypeValue;
  name: string;
  description?: string;
  tags?: string[];
  data?: Record<string, unknown>;
  source_world?: string;
}): Promise<{ id: string; name: string; type: string }> {
  const res = await fetchWithTimeout(`${API_BASE}/api/assets`, {
    method: "POST",
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
  const res = await fetchWithTimeout(`${API_BASE}/api/assets/extract/${seedType}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, target_id: targetId }),
    timeout: LONG_TIMEOUT,
  });
  assertOk(res);
  return res.json();
}
