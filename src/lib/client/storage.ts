export const STORAGE_KEYS = {
  filters: "spodle:filters",
  round: "spodle:round",
  stats: "spodle:stats",
} as const;

const LEGACY_STORAGE_KEYS: Record<keyof typeof STORAGE_KEYS, string> = {
  filters: "needle-drop:filters",
  round: "needle-drop:round",
  stats: "needle-drop:stats",
};

export function migrateStorageKey(key: keyof typeof STORAGE_KEYS): string | null {
  const currentKey = STORAGE_KEYS[key];
  const current = localStorage.getItem(currentKey);
  if (current !== null) return current;
  const legacy = localStorage.getItem(LEGACY_STORAGE_KEYS[key]);
  if (legacy !== null) localStorage.setItem(currentKey, legacy);
  return legacy;
}
