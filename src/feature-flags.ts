export type SocialFeatureFlag =
  | "new_feed"
  | "watch"
  | "shorts"
  | "groups"
  | "boat_profiles"
  | "new_profiles"
  | "social_graph_v2";

export const DEFAULT_SOCIAL_FEATURE_FLAGS: Record<SocialFeatureFlag, boolean> = {
  new_feed: false,
  watch: false,
  shorts: false,
  groups: false,
  boat_profiles: false,
  new_profiles: false,
  social_graph_v2: false,
};

export function parseFeatureFlag(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  const text = String(value ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled"].includes(text)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(text)) return false;
  return fallback;
}

export function featureFlagsFromEnv(env: NodeJS.ProcessEnv = process.env) {
  return Object.fromEntries(
    Object.entries(DEFAULT_SOCIAL_FEATURE_FLAGS).map(([key, fallback]) => [
      key,
      parseFeatureFlag(env[`FEATURE_${key.toUpperCase()}`], fallback),
    ]),
  ) as Record<SocialFeatureFlag, boolean>;
}
