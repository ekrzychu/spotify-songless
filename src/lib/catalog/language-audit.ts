import { LANGUAGE_OVERRIDES, isAcceptedGameLanguage } from "@/lib/catalog/track-language";

export type LanguageAuditTrack = {
  spotifyTrackId: string;
  title: string;
  artistNames: string;
  languageCode: string | null;
  languageSource: string | null;
  languageConfidence: number | null;
  languageEligible: boolean;
};

export type LanguageAudit = {
  total: number;
  accepted: number;
  classifiedAllowed: number;
  unclassifiedAccepted: number;
  rejectedClassified: number;
  manualOverridesConfigured: number;
  manualOverrides: Array<{ spotifyTrackId: string; languageCode: string }>;
  byLanguage: Record<string, number>;
  bySource: Record<string, number>;
  confidence: Record<"unknown" | "below-0.65" | "0.65-0.79" | "0.80-0.94" | "0.95-1.00", number>;
  ambiguousSamples: Array<{ title: string; artistNames: string; source: string }>;
};

export function buildLanguageAudit(
  tracks: readonly LanguageAuditTrack[],
  sampleLimit = 20,
): LanguageAudit {
  const byLanguage: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const confidence: LanguageAudit["confidence"] = {
    unknown: 0,
    "below-0.65": 0,
    "0.65-0.79": 0,
    "0.80-0.94": 0,
    "0.95-1.00": 0,
  };
  const ambiguousSamples: LanguageAudit["ambiguousSamples"] = [];
  let accepted = 0;
  let classifiedAllowed = 0;
  let unclassifiedAccepted = 0;
  let rejectedClassified = 0;

  for (const track of tracks) {
    const language = track.languageCode ?? "unknown";
    const source = track.languageSource ?? "unknown";
    byLanguage[language] = (byLanguage[language] ?? 0) + 1;
    bySource[source] = (bySource[source] ?? 0) + 1;
    if (isAcceptedGameLanguage(track.languageCode)) {
      accepted += 1;
      if (track.languageCode === null) unclassifiedAccepted += 1;
      else classifiedAllowed += 1;
    } else {
      rejectedClassified += 1;
    }
    if (track.languageCode === null) {
      if (ambiguousSamples.length < sampleLimit) {
        ambiguousSamples.push({ title: track.title, artistNames: track.artistNames, source });
      }
    }
    const value = track.languageConfidence;
    if (value === null) confidence.unknown += 1;
    else if (value < 0.65) confidence["below-0.65"] += 1;
    else if (value < 0.8) confidence["0.65-0.79"] += 1;
    else if (value < 0.95) confidence["0.80-0.94"] += 1;
    else confidence["0.95-1.00"] += 1;
  }

  return {
    total: tracks.length,
    accepted,
    classifiedAllowed,
    unclassifiedAccepted,
    rejectedClassified,
    manualOverridesConfigured: Object.keys(LANGUAGE_OVERRIDES).length,
    manualOverrides: Object.entries(LANGUAGE_OVERRIDES)
      .map(([spotifyTrackId, languageCode]) => ({ spotifyTrackId, languageCode }))
      .sort((left, right) => left.spotifyTrackId.localeCompare(right.spotifyTrackId)),
    byLanguage,
    bySource,
    confidence,
    ambiguousSamples,
  };
}

export function formatLanguageAudit(audit: LanguageAudit): string {
  const counts = (values: Record<string, number>) => Object.entries(values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => `${key}: ${count}`);
  return [
    "CATALOG LANGUAGE AUDIT",
    "",
    `Total tracks: ${audit.total}`,
    `Accepted by language policy: ${audit.accepted}`,
    `  Classified EN/PL/ES: ${audit.classifiedAllowed}`,
    `  Unclassified/unknown/uncertain: ${audit.unclassifiedAccepted}`,
    `Rejected classified other languages: ${audit.rejectedClassified}`,
    `Manual overrides configured: ${audit.manualOverridesConfigured}`,
    "",
    "BY LANGUAGE",
    ...counts(audit.byLanguage),
    "",
    "BY SOURCE",
    ...counts(audit.bySource),
    "",
    "CONFIDENCE DISTRIBUTION",
    ...counts(audit.confidence),
    "",
    "MANUAL OVERRIDES",
    ...audit.manualOverrides.map((item) => `  - ${item.spotifyTrackId}: ${item.languageCode}`),
    ...(audit.manualOverrides.length === 0 ? ["  None"] : []),
    "",
    "AMBIGUOUS SAMPLES",
    ...audit.ambiguousSamples.map((track) => `  - ${track.title} - ${track.artistNames} (${track.source})`),
    ...(audit.ambiguousSamples.length === 0 ? ["  None"] : []),
    "",
    "No tracks were modified.",
  ].join("\n");
}
