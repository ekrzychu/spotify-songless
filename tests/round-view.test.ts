import { describe, expect, it } from "vitest";
import { roundView } from "@/lib/game/round-service";

describe("round reveal", () => {
  it("keeps an active Unranked round valid if its track becomes ranked in the background", () => {
    const view = roundView({
      id: "round", sessionId: "session", trackId: "track", attempt: 1,
      finished: true, won: true, categoryId: "all", difficulty: "unranked",
      createdAt: new Date(), finishedAt: new Date(), attempts: [],
      track: {
        id: "track", spotifyTrackId: "spotify-id", spotifyUri: "spotify:track:spotify-id",
        isrc: null, title: "Song", artistNames: "Artist", artistsJson: "[]", albumName: "Album",
        releaseDate: null, streamCount: 75_000_000n, difficulty: "hard", soundchartsUuid: "uuid",
        soundchartsReleaseDate: null, soundchartsGenresJson: null, soundchartsNotFoundAt: null,
        streamCountSource: "soundcharts", streamCountUpdatedAt: new Date(), playable: true,
        gameEligible: true, languageCode: null, languageSource: null, languageConfidence: null,
        languageEligible: true, languageUpdatedAt: null, spotifyUrl: "https://open.spotify.com/track/spotify-id",
        createdAt: new Date(), updatedAt: new Date(),
      },
    });

    expect(view.answer).toMatchObject({ difficulty: "unranked", streamCount: null });
  });
});
