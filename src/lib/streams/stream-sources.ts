export const STREAM_SOURCES = {
  provisionalSpotifyFull: "spotify_full",
  verifiedSoundcharts: "soundcharts",
  verifiedCsv: "csv",
} as const;

export type KnownStreamCountSource = (typeof STREAM_SOURCES)[keyof typeof STREAM_SOURCES];

export function isVerifiedStreamSource(source: string | null): boolean {
  return source !== null && source !== STREAM_SOURCES.provisionalSpotifyFull;
}

export function canSpotifyFullReplace(source: string | null): boolean {
  return source === null || source === STREAM_SOURCES.provisionalSpotifyFull;
}

export function canVerifiedCsvReplace(source: string | null): boolean {
  return source === null || source === STREAM_SOURCES.provisionalSpotifyFull || source === STREAM_SOURCES.verifiedCsv;
}

export function canSoundchartsReplace(source: string | null, refresh = false): boolean {
  return source === null
    || source === STREAM_SOURCES.provisionalSpotifyFull
    || (refresh && source === STREAM_SOURCES.verifiedSoundcharts);
}
