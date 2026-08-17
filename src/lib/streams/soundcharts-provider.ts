import { SoundchartsApiError, type SpotifyAudienceSnapshot } from "@/lib/soundcharts/client";
import type { StreamCountLookup, StreamCountProvider } from "@/lib/streams/provider";
import { summarizeSpotifyStreams } from "@/lib/streams/spotify-stream-aggregation";

export type SoundchartsResolutionSource = "cached" | "spotify" | "isrc";

export type SoundchartsStreamCountResult = {
  soundchartsUuid: string;
  streamCount: number | null;
  audienceDate: string | null;
  identifierCount: number;
  uniqueValueCount: number;
  resolutionSource: SoundchartsResolutionSource;
};

export interface SoundchartsProviderClient {
  readonly quotaRemaining: number | null;
  getSongBySpotifyId(spotifyTrackId: string): Promise<string>;
  getSongByIsrc(isrc: string): Promise<string>;
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

    if (!soundchartsUuid) {
      try {
        soundchartsUuid = await this.client.getSongBySpotifyId(track.spotifyTrackId);
        resolutionSource = "spotify";
      } catch (error) {
        if (!(error instanceof SoundchartsApiError) || error.code !== "not_found" || !track.isrc) throw error;
        this.assertQuotaReserve();
        soundchartsUuid = await this.client.getSongByIsrc(track.isrc);
        resolutionSource = "isrc";
      }
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
    };
  }

  private assertQuotaReserve(): void {
    const remaining = this.client.quotaRemaining;
    if (remaining !== null && remaining <= this.quotaReserve) {
      throw new SoundchartsApiError("quota_reserve", null);
    }
  }
}
