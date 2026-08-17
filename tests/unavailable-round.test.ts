import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findRound: vi.fn(), markUnavailable: vi.fn(), updateRound: vi.fn(), transaction: vi.fn(),
  createRound: vi.fn(), updateTrack: vi.fn(), getRandomTrack: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    gameRound: { findFirst: mocks.findRound, update: mocks.updateRound, create: mocks.createRound },
    sessionUnavailableTrack: { upsert: mocks.markUnavailable },
    gameTrack: { update: mocks.updateTrack },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/game/selection", () => ({ getRandomTrack: mocks.getRandomTrack }));

import { replaceUnavailableRound } from "@/lib/game/round-service";

const track = {
  id: "track-db-id", spotifyTrackId: "0123456789012345678901", spotifyUri: "spotify:track:0123456789012345678901",
  isrc: null, title: "Song", artistNames: "Artist", artistsJson: "[]", albumName: "Album",
  releaseDate: null, streamCount: 250_000_000n, difficulty: "normal", playable: true,
  spotifyUrl: "https://open.spotify.com/track/0123456789012345678901", createdAt: new Date(), updatedAt: new Date(),
};

describe("session-scoped unavailable tracks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findRound.mockResolvedValue({ id: "round", sessionId: "session-a", trackId: track.id, categoryId: "all", difficulty: "normal" });
    mocks.markUnavailable.mockResolvedValue({});
    mocks.updateRound.mockResolvedValue({});
    mocks.transaction.mockResolvedValue([]);
    mocks.getRandomTrack.mockResolvedValue(track);
    mocks.createRound.mockResolvedValue({
      id: "replacement", sessionId: "session-a", trackId: track.id, attempt: 0, finished: false, won: false,
      categoryId: "all", difficulty: "normal", createdAt: new Date(), finishedAt: null, track, attempts: [],
    });
  });

  it("records the failure for one session and never globally disables the track", async () => {
    await replaceUnavailableRound("round", "session-a");
    expect(mocks.markUnavailable).toHaveBeenCalledWith({
      where: { sessionId_trackId: { sessionId: "session-a", trackId: track.id } },
      create: { sessionId: "session-a", trackId: track.id }, update: {},
    });
    expect(mocks.updateTrack).not.toHaveBeenCalled();
  });
});
