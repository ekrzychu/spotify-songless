export type StreamCountLookup = {
  spotifyTrackId: string;
  isrc?: string | null;
  soundchartsUuid?: string | null;
};

export interface StreamCountProvider {
  getStreamCount(track: StreamCountLookup): Promise<number | null>;
}
