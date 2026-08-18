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

function certainState(code: string, source: "manual" | "provider", confidence = 1): TrackLanguageState {
  return {
    languageCode: code,
    languageSource: source,
    languageConfidence: confidence,
    languageEligible: isAllowedGameLanguage(code),
  };
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
      languageEligible: false,
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
      languageEligible: false,
    };
  }
  return {
    languageCode: code,
    languageSource: "detector",
    languageConfidence: confidence,
    languageEligible: isAllowedGameLanguage(code),
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
  eligible: number;
  ineligibleOther: number;
  unknown: number;
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
  let eligible = 0;
  let ineligibleOther = 0;
  let unknown = 0;
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
      eligible += 1;
      if (samples.allowed.length < sampleLimit) {
        samples.allowed.push({ title: track.title, code: state.languageCode!, source: state.languageSource });
      }
    } else if (state.languageCode) {
      ineligibleOther += 1;
      if (samples.rejected.length < sampleLimit) {
        samples.rejected.push({ title: track.title, code: state.languageCode, source: state.languageSource });
      }
    } else {
      unknown += 1;
      if (samples.unknown.length < sampleLimit) {
        samples.unknown.push({ title: track.title, source: state.languageSource });
      }
    }

    if (
      track.languageCode !== state.languageCode
      || track.languageSource !== state.languageSource
      || track.languageConfidence !== state.languageConfidence
      || track.languageEligible !== state.languageEligible
    ) {
      await dependencies.updateTrack(track.id, { ...state, languageUpdatedAt: now });
      updated += 1;
    }
  }
  return { scanned: tracks.length, eligible, ineligibleOther, unknown, updated, byLanguage, samples };
}

export function formatLanguageBackfill(summary: LanguageBackfillSummary): string {
  const sampleLines = (values: Array<{ title: string; code?: string; source: string }>) => (
    values.length ? values.map((item) => `  - ${item.title}: ${item.code ?? "unknown"} (${item.source})`) : ["  None"]
  );
  return [
    "LANGUAGE BACKFILL",
    "",
    `Tracks scanned: ${summary.scanned}`,
    `Eligible EN/PL/ES: ${summary.eligible}`,
    `Ineligible other languages: ${summary.ineligibleOther}`,
    `Unknown/uncertain: ${summary.unknown}`,
    `Rows updated: ${summary.updated}`,
    "",
    "BY LANGUAGE",
    ...Object.entries(summary.byLanguage)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([code, count]) => `${code}: ${count}`),
    "",
    "ALLOWED SAMPLES",
    ...sampleLines(summary.samples.allowed),
    "",
    "REJECTED SAMPLES",
    ...sampleLines(summary.samples.rejected),
    "",
    "UNKNOWN SAMPLES",
    ...sampleLines(summary.samples.unknown),
  ].join("\n");
}
