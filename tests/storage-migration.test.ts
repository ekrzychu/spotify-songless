import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeStoredFilters } from "@/lib/client/filters";
import { migrateStorageKey } from "@/lib/client/storage";
import {
  DEFAULT_VOLUME_PERCENT,
  normalizeVolumePercent,
  persistVolumePercent,
  readStoredVolumePercent,
} from "@/lib/client/volume";

function storage(initial: Record<string, string>) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("spodle localStorage migration", () => {
  it("copies a legacy value when the new key is absent", () => {
    const local = storage({ "needle-drop:stats": "legacy" });
    vi.stubGlobal("localStorage", local);
    expect(migrateStorageKey("stats")).toBe("legacy");
    expect(local.setItem).toHaveBeenCalledWith("spodle:stats", "legacy");
  });

  it("never overwrites an existing spodle value", () => {
    const local = storage({ "needle-drop:filters": "old", "spodle:filters": "new" });
    vi.stubGlobal("localStorage", local);
    expect(migrateStorageKey("filters")).toBe("new");
    expect(local.setItem).not.toHaveBeenCalled();
  });

  it("repairs a removed jazz filter to All Music", () => {
    expect(normalizeStoredFilters({ category: "jazz", difficulty: "normal" })).toEqual({
      category: "all",
      difficulty: "normal",
    });
  });

  it("repairs an invalid saved difficulty independently", () => {
    expect(normalizeStoredFilters({ category: "rock", difficulty: "legendary" })).toEqual({
      category: "rock",
      difficulty: "normal",
    });
  });

  it("restores the gameplay-only Unranked filter", () => {
    expect(normalizeStoredFilters({ category: "pop", difficulty: "unranked" })).toEqual({
      category: "pop",
      difficulty: "unranked",
    });
  });

  it.each([
    [0, 0],
    [65, 65],
    [100, 100],
    [-20, 0],
    [140, 100],
    [Number.NaN, DEFAULT_VOLUME_PERCENT],
  ])("normalizes persisted volume %s to %s", (input, expected) => {
    expect(normalizeVolumePercent(input)).toBe(expected);
  });

  it("restores and persists volume through the typed storage keys", () => {
    const local = storage({ "spodle:volume": "37" });
    vi.stubGlobal("localStorage", local);
    expect(readStoredVolumePercent()).toBe(37);
    expect(persistVolumePercent(65)).toBe(65);
    expect(local.setItem).toHaveBeenCalledWith("spodle:volume", "65");
  });

  it("falls back to 65 for an invalid stored volume", () => {
    const local = storage({ "spodle:volume": "not-a-number" });
    vi.stubGlobal("localStorage", local);
    expect(readStoredVolumePercent()).toBe(DEFAULT_VOLUME_PERCENT);
    expect(local.setItem).toHaveBeenCalledWith("spodle:volume", "65");
  });
});
