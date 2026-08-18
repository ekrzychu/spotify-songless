import {
  SoundchartsApiError,
  type SoundchartsSongGenre,
  type SoundchartsSongResolution,
  type SpotifyAudienceSnapshot,
} from "@/lib/soundcharts/client";
import type { StreamCountLookup, StreamCountProvider } from "@/lib/streams/provider";
import { summarizeSpotifyStreams } from "@/lib/streams/spotify-stream-aggregation";

export type SoundchartsResolutionSource = "cached" | "spotify" | "isrc";

export class DefinitiveSoundchartsNotFoundError extends SoundchartsApiError {
  constructor(error: SoundchartsApiError) {
    super("not_found", error.status, error.apiMessage);
    this.name = "DefinitiveSoundchartsNotFoundError";
  }
}

export type SoundchartsStreamCountResult = {
  soundchartsUuid: string;
  streamCount: number | null;
  audienceDate: string | null;
  identifierCount: number;
  uniqueValueCount: number;
  resolutionSource: SoundchartsResolutionSource;
  soundchartsReleaseDate: string | null;
  soundchartsGenres: SoundchartsSongGenre[] | null;
};

export interface SoundchartsProviderClient {
  readonly quotaRemaining: number | null;
  getSongBySpotifyId(spotifyTrackId: string): Promise<SoundchartsSongResolution>;
  getSongByIsrc(isrc: string): Promise<SoundchartsSongResolution>;
  getLatestSpotifyAudienceSnapshot(soundchartsSongUuid: string): Promise<SpotifyAudienceSnapshot | null>;
}

export class SoundchartsStreamCountProvider implements StreamCountProvider {
  constructor(
    private readonly client: SoundchartsProviderClient,
    private readonly quotaReserve = 50,
  ) {}

  async getStreamCount(track: StreamCountLookup): Promise<number | null> {
    return (await this.getStreamCountResult(track)).streamCount;
  }

  async getStreamCountResult(track: StreamCountLookup): Promise<SoundchartsStreamCountResult> {
    this.assertQuotaReserve();
    let soundchartsUuid = track.soundchartsUuid ?? null;
    let resolutionSource: SoundchartsResolutionSource = "cached";
    let soundchartsReleaseDate: string | null = null;
    let soundchartsGenres: SoundchartsSongGenre[] | null = null;

    if (!soundchartsUuid) {
      let resolution: SoundchartsSongResolution;
      try {
        resolution = await this.client.getSongBySpotifyId(track.spotifyTrackId);
        resolutionSource = "spotify";
      } catch (error) {
        if (!(error instanceof SoundchartsApiError) || error.code !== "not_found") throw error;
        if (!track.isrc) throw new DefinitiveSoundchartsNotFoundError(error);
        this.assertQuotaReserve();
        try {
          resolution = await this.client.getSongByIsrc(track.isrc);
        } catch (isrcError) {
          if (isrcError instanceof SoundchartsApiError && isrcError.code === "not_found") {
            throw new DefinitiveSoundchartsNotFoundError(isrcError);
          }
          throw isrcError;
        }
        resolutionSource = "isrc";
      }
      soundchartsUuid = resolution.uuid;
      soundchartsReleaseDate = resolution.releaseDate;
      soundchartsGenres = resolution.genres;
      this.assertQuotaReserve();
    }

    const snapshot = await this.client.getLatestSpotifyAudienceSnapshot(soundchartsUuid);
    if (!snapshot) {
      return {
        soundchartsUuid,
        streamCount: null,
        audienceDate: null,
        identifierCount: 0,
        uniqueValueCount: 0,
        resolutionSource,
        soundchartsReleaseDate,
        soundchartsGenres,
      };
    }
    const aggregation = summarizeSpotifyStreams(snapshot.plots);
    return {
      soundchartsUuid,
      streamCount: aggregation.streamCount,
      audienceDate: snapshot.date,
      identifierCount: aggregation.identifierCount,
      uniqueValueCount: aggregation.uniqueValueCount,
      resolutionSource,
      soundchartsReleaseDate,
      soundchartsGenres,
    };
  }

  private assertQuotaReserve(): void {
    const remaining = this.client.quotaRemaining;
    if (remaining !== null && remaining <= this.quotaReserve) {
      throw new SoundchartsApiError("quota_reserve", null);
    }
  }
}
