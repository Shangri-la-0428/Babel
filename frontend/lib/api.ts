const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

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
}

export interface EventData {
  id: string;
  tick: number;
  agent_id: string | null;
  agent_name: string | null;
  action_type: string;
  action: Record<string, unknown>;
  result: string;
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
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
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

export async function fetchSeeds(): Promise<SeedInfo[]> {
  const res = await fetch(`${API_BASE}/api/seeds`);
  return res.json();
}

export async function createFromSeed(filename: string): Promise<{ session_id: string }> {
  const res = await fetch(`${API_BASE}/api/worlds/from-seed/${filename}`, {
    method: "POST",
  });
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
  const res = await fetch(`${API_BASE}/api/worlds`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function getState(sessionId: string): Promise<WorldState> {
  const res = await fetch(`${API_BASE}/api/worlds/${sessionId}/state`);
  return res.json();
}

export async function getEvents(
  sessionId: string,
  limit = 100
): Promise<EventData[]> {
  const res = await fetch(
    `${API_BASE}/api/worlds/${sessionId}/events?limit=${limit}`
  );
  return res.json();
}

export async function runWorld(
  sessionId: string,
  opts: { max_ticks?: number; model?: string; api_key?: string; api_base?: string; tick_delay?: number } = {}
): Promise<void> {
  await fetch(`${API_BASE}/api/worlds/${sessionId}/run`, {
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
}

export async function stepWorld(
  sessionId: string,
  opts: { model?: string; api_key?: string; api_base?: string } = {}
): Promise<{ tick: number; events: { agent_name: string; action_type: string; result: string }[] }> {
  const res = await fetch(`${API_BASE}/api/worlds/${sessionId}/step`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model ?? null,
      api_key: opts.api_key ?? null,
      api_base: opts.api_base ?? null,
    }),
  });
  return res.json();
}

export async function pauseWorld(sessionId: string): Promise<void> {
  await fetch(`${API_BASE}/api/worlds/${sessionId}/pause`, {
    method: "POST",
  });
}

export async function getSessions(): Promise<
  { id: string; world_seed: string; tick: number; status: string; created_at: string }[]
> {
  const res = await fetch(`${API_BASE}/api/sessions`);
  return res.json();
}

export function createWebSocket(sessionId: string): WebSocket {
  const wsBase = API_BASE.replace(/^http/, "ws");
  return new WebSocket(`${wsBase}/ws/${sessionId}`);
}
