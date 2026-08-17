import { migrateStorageKey, STORAGE_KEYS } from "@/lib/client/storage";

export const DEFAULT_VOLUME_PERCENT = 65;

export function normalizeVolumePercent(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(numeric)) return DEFAULT_VOLUME_PERCENT;
  return Math.min(100, Math.max(0, Math.round(numeric)));
}

export function readStoredVolumePercent(): number {
  const stored = migrateStorageKey("volume");
  if (stored === null || stored.trim() === "") return DEFAULT_VOLUME_PERCENT;
  const normalized = normalizeVolumePercent(Number(stored));
  if (stored !== String(normalized)) localStorage.setItem(STORAGE_KEYS.volume, String(normalized));
  return normalized;
}

export function persistVolumePercent(value: number): number {
  const normalized = normalizeVolumePercent(value);
  localStorage.setItem(STORAGE_KEYS.volume, String(normalized));
  return normalized;
}
