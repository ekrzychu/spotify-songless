import { detectAll } from "tinyld";
import languageOverridesJson from "../../../rules/language_overrides.json";

export const ALLOWED_GAME_LANGUAGE_CODES = ["en", "pl", "es"] as const;
export type AllowedGameLanguageCode = (typeof ALLOWED_GAME_LANGUAGE_CODES)[number];
export const LANGUAGE_DETECTOR_MIN_CONFIDENCE = 0.65;
export const LANGUAGE_DETECTOR_MIN_MARGIN = 0.2;
export const LANGUAGE_DETECTOR_MIN_LETTERS = 12;
export const LANGUAGE_DETECTOR_MIN_TOKENS = 3;

export type LanguageSource = "manual" | "provider" | "detector" | "detector-uncertain" | "unknown";

export type TrackLanguageState = {
  languageCode: string | null;
  languageSource: LanguageSource;
  languageConfidence: number | null;
  languageEligible: boolean;
};

export type LanguageOverrides = Readonly<Record<string, string>>;

export const LANGUAGE_OVERRIDES: LanguageOverrides = languageOverridesJson;

export type TrackLanguageInput = {
  spotifyTrackId: string;
  title: string;
  albumName: string;
  providerLanguageCode?: string | null;
  existingLanguageCode?: string | null;
  existingLanguageSource?: string | null;
};

type LanguageDetector = (text: string) => Array<{ lang: string; accuracy: number }>;

const LANGUAGE_CONFIDENCE_COMPARISON_EPSILON = 1e-12;

const VERSION_METADATA = /\b(?:remaster(?:ed)?(?:\s+\d{4})?|radio edit|live|mono version|instrumental|original mix|extended mix|tv version)\b/giu;

export function normalizeLanguageDetectionText(title: string, albumName: string): string {
  const clean = (value: string) => value
    .normalize("NFKC")
    .replace(VERSION_METADATA, " ")
    .replace(/[()[\]{}]/gu, " ")
    .replace(/[\s\-–—:|/]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
  const cleanedTitle = clean(title);
  const cleanedAlbum = clean(albumName);
  return cleanedAlbum && cleanedAlbum.toLocaleLowerCase("en-US") !== cleanedTitle.toLocaleLowerCase("en-US")
    ? `${cleanedTitle} ${cleanedAlbum}`.trim()
    : cleanedTitle;
}

function normalizedIsoCode(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLocaleLowerCase("en-US") ?? "";
  return /^[a-z]{2}$/u.test(normalized) ? normalized : null;
}

export function isAllowedGameLanguage(code: string | null | undefined): code is AllowedGameLanguageCode {
  return ALLOWED_GAME_LANGUAGE_CODES.includes(code as AllowedGameLanguageCode);
}

export function isAcceptedGameLanguage(code: string | null | undefined): boolean {
  return code == null || isAllowedGameLanguage(code);
}

function certainState(code: string, source: "manual" | "provider", confidence = 1): TrackLanguageState {
  return {
    languageCode: code,
    languageSource: source,
    languageConfidence: confidence,
    languageEligible: isAcceptedGameLanguage(code),
  };
}

function hasEquivalentConfidence(left: number | null, right: number | null): boolean {
  if (left === null || right === null) return left === right;
  return Math.abs(left - right) <= LANGUAGE_CONFIDENCE_COMPARISON_EPSILON;
}

export function deriveTrackLanguageState(
  input: TrackLanguageInput,
  options: { overrides?: LanguageOverrides; detector?: LanguageDetector } = {},
): TrackLanguageState {
  const overrides = options.overrides ?? LANGUAGE_OVERRIDES;
  const manualCode = normalizedIsoCode(overrides[input.spotifyTrackId]);
  if (manualCode) return certainState(manualCode, "manual");

  const existingManualCode = input.existingLanguageSource === "manual"
    ? normalizedIsoCode(input.existingLanguageCode)
    : null;
  if (existingManualCode) return certainState(existingManualCode, "manual");

  const providerCode = normalizedIsoCode(input.providerLanguageCode)
    ?? (input.existingLanguageSource === "provider" ? normalizedIsoCode(input.existingLanguageCode) : null);
  if (providerCode) return certainState(providerCode, "provider");

  const text = normalizeLanguageDetectionText(input.title, input.albumName);
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  const tokens = text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
  if (letters < LANGUAGE_DETECTOR_MIN_LETTERS || tokens < LANGUAGE_DETECTOR_MIN_TOKENS) {
    return {
      languageCode: null,
      languageSource: "unknown",
      languageConfidence: null,
      languageEligible: true,
    };
  }

  const results = (options.detector ?? detectAll)(text);
  const first = results[0];
  const second = results[1];
  const confidence = first?.accuracy ?? null;
  const margin = first ? first.accuracy - (second?.accuracy ?? 0) : 0;
  const code = normalizedIsoCode(first?.lang);
  if (
    !code
    || confidence === null
    || confidence < LANGUAGE_DETECTOR_MIN_CONFIDENCE
    || margin < LANGUAGE_DETECTOR_MIN_MARGIN
  ) {
    return {
      languageCode: null,
      languageSource: "detector-uncertain",
      languageConfidence: confidence,
      languageEligible: true,
    };
  }
  return {
    languageCode: code,
    languageSource: "detector",
    languageConfidence: confidence,
    languageEligible: isAcceptedGameLanguage(code),
  };
}

export type LanguageBackfillTrack = TrackLanguageInput & {
  id: string;
  languageCode: string | null;
  languageSource: string | null;
  languageConfidence: number | null;
  languageEligible: boolean;
};

export type LanguageBackfillSummary = {
  scanned: number;
  accepted: number;
  classifiedAllowed: number;
  unclassifiedAccepted: number;
  rejectedClassified: number;
  updated: number;
  byLanguage: Record<string, number>;
  samples: {
    allowed: Array<{ title: string; code: string; source: string }>;
    rejected: Array<{ title: string; code: string; source: string }>;
    unknown: Array<{ title: string; source: string }>;
  };
};

export async function backfillTrackLanguages(
  tracks: readonly LanguageBackfillTrack[],
  dependencies: {
    updateTrack: (id: string, state: TrackLanguageState & { languageUpdatedAt: Date }) => Promise<void>;
  },
  options: { overrides?: LanguageOverrides; detector?: LanguageDetector; now?: Date; sampleLimit?: number } = {},
): Promise<LanguageBackfillSummary> {
  const now = options.now ?? new Date();
  const sampleLimit = options.sampleLimit ?? 10;
  const byLanguage: Record<string, number> = {};
  const samples: LanguageBackfillSummary["samples"] = { allowed: [], rejected: [], unknown: [] };
  let accepted = 0;
  let classifiedAllowed = 0;
  let unclassifiedAccepted = 0;
  let rejectedClassified = 0;
  let updated = 0;

  for (const track of tracks) {
    const state = deriveTrackLanguageState({
      ...track,
      existingLanguageCode: track.languageCode,
      existingLanguageSource: track.languageSource,
    }, options);
    const key = state.languageCode ?? "unknown";
    byLanguage[key] = (byLanguage[key] ?? 0) + 1;
    if (state.languageEligible) {
      accepted += 1;
      if (state.languageCode === null) {
        unclassifiedAccepted += 1;
        if (samples.unknown.length < sampleLimit) {
          samples.unknown.push({ title: track.title, source: state.languageSource });
        }
      } else {
        classifiedAllowed += 1;
      }
      if (state.languageCode && samples.allowed.length < sampleLimit) {
        samples.allowed.push({ title: track.title, code: state.languageCode!, source: state.languageSource });
      }
    } else if (state.languageCode) {
      rejectedClassified += 1;
      if (samples.rejected.length < sampleLimit) {
        samples.rejected.push({ title: track.title, code: state.languageCode, source: state.languageSource });
      }
    }

    if (
      track.languageCode !== state.languageCode
      || track.languageSource !== state.languageSource
      || !hasEquivalentConfidence(track.languageConfidence, state.languageConfidence)
      || track.languageEligible !== state.languageEligible
    ) {
      await dependencies.updateTrack(track.id, { ...state, languageUpdatedAt: now });
      updated += 1;
    }
  }
  return {
    scanned: tracks.length,
    accepted,
    classifiedAllowed,
    unclassifiedAccepted,
    rejectedClassified,
    updated,
    byLanguage,
    samples,
  };
}

export function formatLanguageBackfill(summary: LanguageBackfillSummary): string {
  const sampleLines = (values: Array<{ title: string; code?: string; source: string }>) => (
    values.length ? values.map((item) => `  - ${item.title}: ${item.code ?? "unknown"} (${item.source})`) : ["  None"]
  );
  return [
    "LANGUAGE BACKFILL",
    "",
    `Tracks scanned: ${summary.scanned}`,
    `Accepted by language policy: ${summary.accepted}`,
    `  Classified EN/PL/ES: ${summary.classifiedAllowed}`,
    `  Unclassified/unknown/uncertain: ${summary.unclassifiedAccepted}`,
    `Rejected classified other languages: ${summary.rejectedClassified}`,
    `Rows updated: ${summary.updated}`,
    "",
    "BY LANGUAGE",
    ...Object.entries(summary.byLanguage)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([code, count]) => `${code}: ${count}`),
    "",
    "ACCEPTED CLASSIFIED EN/PL/ES SAMPLES",
    ...sampleLines(summary.samples.allowed),
    "",
    "REJECTED SAMPLES",
    ...sampleLines(summary.samples.rejected),
    "",
    "ACCEPTED UNCLASSIFIED/UNKNOWN/UNCERTAIN SAMPLES",
    ...sampleLines(summary.samples.unknown),
  ].join("\n");
}
