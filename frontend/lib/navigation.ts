import { SavedSeedData } from "./api";

export interface AssetNavigationContext {
  sessionId?: string;
  worldName?: string;
  seedFile?: string;
  backHref?: string;
  assetId?: string | null;
}

export interface CreateNavigationContext {
  seedFile?: string;
  backHref?: string;
}

export interface SimNavigationContext {
  sessionId: string;
  seedFile?: string | null;
}

export function buildWorldHref(seedFile?: string | null): string {
  if (!seedFile) return "/";
  const params = new URLSearchParams();
  params.set("seed", seedFile);
  return `/?${params.toString()}`;
}

export function buildCreateHref({
  seedFile,
  backHref,
}: CreateNavigationContext = {}): string {
  const params = new URLSearchParams();
  if (seedFile) params.set("seed", seedFile);
  if (backHref) params.set("back", sanitizeInternalHref(backHref));
  const query = params.toString();
  return query ? `/create?${query}` : "/create";
}

export function buildSimHref({
  sessionId,
  seedFile,
}: SimNavigationContext): string {
  const params = new URLSearchParams();
  params.set("id", sessionId);
  if (seedFile) params.set("seed", seedFile);
  return `/sim?${params.toString()}`;
}

export function sanitizeInternalHref(raw?: string | null, fallback: string = "/"): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//")) return fallback;
  return raw;
}

export function buildAssetsHref({
  sessionId,
  worldName,
  seedFile,
  backHref,
  assetId,
}: AssetNavigationContext = {}): string {
  const params = new URLSearchParams();
  if (sessionId) params.set("session", sessionId);
  if (worldName) params.set("world", worldName);
  if (seedFile) params.set("seed", seedFile);
  if (backHref) params.set("back", sanitizeInternalHref(backHref));
  if (assetId) params.set("asset", assetId);
  const query = params.toString();
  return query ? `/assets?${query}` : "/assets";
}

export function assetMatchesContext(
  seed: Pick<SavedSeedData, "source_world">,
  context: Pick<AssetNavigationContext, "sessionId" | "worldName">,
): boolean {
  if (!context.sessionId && !context.worldName) return true;
  return seed.source_world === context.sessionId || (!!context.worldName && seed.source_world === context.worldName);
}
