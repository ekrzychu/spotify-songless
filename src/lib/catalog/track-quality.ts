export const TRACK_QUALITY_REASONS = [
  "skit",
  "interview",
  "commentary",
  "spoken",
  "dialogue",
  "voice-memo",
] as const;

export type TrackQualityReason = (typeof TRACK_QUALITY_REASONS)[number];

export type TrackQualityClassification =
  | { eligible: true; reason: null }
  | { eligible: false; reason: TrackQualityReason };

const ELIGIBLE_EXACT_TITLES = new Set(["the interview"]);

export function normalizeTrackQualityTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function classifyTrackQuality(title: string): TrackQualityClassification {
  const normalized = normalizeTrackQualityTitle(title);
  if (!normalized || ELIGIBLE_EXACT_TITLES.has(normalized)) return { eligible: true, reason: null };

  if (/\bskit\b/u.test(normalized)) return { eligible: false, reason: "skit" };
  if (/\bvoice (?:memo|note)\b/u.test(normalized)) return { eligible: false, reason: "voice-memo" };
  if (/\bspoken word\b/u.test(normalized)) return { eligible: false, reason: "spoken" };
  if (hasBoundaryMarker(normalized, ["commentary"])) return { eligible: false, reason: "commentary" };
  if (hasBoundaryMarker(normalized, ["dialogue"])) return { eligible: false, reason: "dialogue" };
  if (hasBoundaryMarker(normalized, ["interview", "interviews", "entrevista", "entrevistas"])) {
    return { eligible: false, reason: "interview" };
  }
  return { eligible: true, reason: null };
}

function hasBoundaryMarker(normalized: string, markers: readonly string[]): boolean {
  return markers.some((marker) => (
    normalized === marker
    || normalized.startsWith(`${marker} `)
    || normalized.endsWith(` ${marker}`)
  ));
}
