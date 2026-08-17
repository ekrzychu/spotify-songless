import { afterEach, describe, expect, it, vi } from "vitest";
import { migrateStorageKey } from "@/lib/client/storage";

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
});
