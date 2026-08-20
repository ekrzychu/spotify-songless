import { describe, expect, it, vi } from "vitest";
import { SoundchartsApiError, type SoundchartsErrorCode } from "@/lib/soundcharts/client";
import {
  markSoundchartsNotFoundTargets,
  recordSoundchartsNotFoundFailure,
} from "@/lib/streams/soundcharts-not-found";
import { DefinitiveSoundchartsNotFoundError } from "@/lib/streams/soundcharts-provider";

describe("Soundcharts not-found persistence", () => {
  it("marks every current target with the same timestamp", async () => {
    const now = new Date("2026-08-18T12:00:00Z");
    const markTargets = vi.fn().mockResolvedValue(2);
    await expect(markSoundchartsNotFoundTargets(
      { targetTrackIds: ["track-a", "track-b"] },
      { now, dependencies: { markTargets } },
    )).resolves.toBe(2);
    expect(markTargets).toHaveBeenCalledWith(["track-a", "track-b"], now);
  });

  it("preserves provisional ranking fields by recording only target IDs and the timestamp", async () => {
    const now = new Date("2026-08-20T12:00:00Z");
    const provisional = {
      streamCount: 3_000_000n, difficulty: "impossible", streamCountSource: "spotify_full",
    };
    const markTargets = vi.fn().mockResolvedValue(1);
    await markSoundchartsNotFoundTargets(
      { targetTrackIds: ["provisional-track"] },
      { now, dependencies: { markTargets } },
    );
    expect(markTargets).toHaveBeenCalledWith(["provisional-track"], now);
    expect(provisional).toEqual({
      streamCount: 3_000_000n, difficulty: "impossible", streamCountSource: "spotify_full",
    });
  });

  it("records only the provider's definitive not_found failure", async () => {
    const now = new Date("2026-08-18T12:00:00Z");
    const markTargets = vi.fn().mockResolvedValue(1);
    const dependencies = { markTargets };
    const group = { targetTrackIds: ["track-a"] };

    await expect(recordSoundchartsNotFoundFailure(
      new DefinitiveSoundchartsNotFoundError(new SoundchartsApiError("not_found", 404)),
      group,
      { now, dependencies },
    )).resolves.toBe(true);
    expect(markTargets).toHaveBeenCalledOnce();

    markTargets.mockClear();
    await expect(recordSoundchartsNotFoundFailure(
      new SoundchartsApiError("not_found", 404), group, { now, dependencies },
    )).resolves.toBe(false);
    const transientCodes: SoundchartsErrorCode[] = [
      "network_error", "rate_limited", "quota_reserve", "request_budget",
      "authentication_failed", "forbidden", "malformed_response", "api_error", "configuration",
    ];
    for (const code of transientCodes) {
      await expect(recordSoundchartsNotFoundFailure(
        new SoundchartsApiError(code, null), group, { now, dependencies },
      )).resolves.toBe(false);
    }
    await expect(recordSoundchartsNotFoundFailure(
      new Error("unexpected"), group, { now, dependencies },
    )).resolves.toBe(false);
    expect(markTargets).not.toHaveBeenCalled();
  });
});
