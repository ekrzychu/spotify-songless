import { describe, expect, it, vi } from "vitest";
import {
  ACTIVE_AUDIT_GENRES,
  buildCatalogGenreAudit,
  executeCatalogGenreAudit,
  formatCatalogGenreAudit,
  type CatalogGenreAuditTrack,
} from "@/lib/catalog/catalog-genre-audit";

function track(id: string, categories: string[], title = `Track ${id}`): CatalogGenreAuditTrack {
  return {
    id,
    spotifyTrackId: id.padEnd(22, "0").slice(0, 22),
    title,
    artistNames: `Artist ${id}`,
    categories: categories.map((categoryId) => ({ categoryId })),
  };
}

describe("offline catalog genre audit", () => {
  it("counts each active genre pair once and ignores decades and removed genres", () => {
    const audit = buildCatalogGenreAudit([
      track("pop-rock", ["pop", "rock", "80s", "jazz"]),
      track("electronic-classical", ["electronic", "classical", "2010s", "metal"]),
    ]);

    expect(ACTIVE_AUDIT_GENRES.map((genre) => genre.id)).toEqual([
      "pop", "rock", "hip-hop", "r-and-b", "electronic", "classical",
    ]);
    expect(audit.overlaps.pop?.rock).toBe(1);
    expect(audit.overlaps.rock?.pop).toBe(1);
    expect(audit.overlaps.electronic?.classical).toBe(1);
    expect(audit.overlaps.classical?.electronic).toBe(1);
    expect(audit.overlaps).not.toHaveProperty("80s");
    expect(audit.overlaps).not.toHaveProperty("jazz");
    expect(audit.multiActiveGenreTracks).toBe(2);
  });

  it("reports classical overlap samples and non-song-like title reasons without mutating input", () => {
    const input = [
      track("crossover", ["classical", "pop"], "Army Dreamers"),
      track("skit", ["hip-hop", "90s"], "Track Name (SKIT)"),
    ];
    const original = structuredClone(input);
    const audit = buildCatalogGenreAudit(input);

    expect(audit.classicalOverlaps.find((overlap) => overlap.genreId === "pop")).toMatchObject({
      count: 1,
      samples: [{ title: "Army Dreamers", artistNames: "Artist crossover" }],
    });
    expect(audit.quality).toMatchObject({ obviousNonSonglikeTracks: 1, byReason: { skit: 1 } });
    expect(input).toEqual(original);
    expect(formatCatalogGenreAudit(audit)).toContain("does not declare them incorrect");
    expect(formatCatalogGenreAudit(audit)).toContain("do not store Spotify search-shard provenance");
  });

  it("has a read-only boundary and never constructs network or write work", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network forbidden"));
    const readTracks = vi.fn().mockResolvedValue([track("offline", ["pop"])]);
    const oauth = vi.fn();
    const spotify = vi.fn();
    const soundcharts = vi.fn();
    const databaseWrite = vi.fn();

    const audit = await executeCatalogGenreAudit({ readTracks });

    expect(audit.totalTracks).toBe(1);
    expect(readTracks).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(oauth).not.toHaveBeenCalled();
    expect(spotify).not.toHaveBeenCalled();
    expect(soundcharts).not.toHaveBeenCalled();
    expect(databaseWrite).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
