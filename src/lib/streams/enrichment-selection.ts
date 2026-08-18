import { CATEGORIES } from "@/lib/catalog/category-config";
import { DIFFICULTY_LABELS } from "@/lib/game/difficulty";
import { normalizeIsrc } from "@/lib/streams/import-normalizer";
import { DIFFICULTIES, type Difficulty } from "@/types/game";

export const DEFAULT_ENRICHMENT_LIMIT = 100;
export const DEFAULT_TARGET_PER_CELL = 10;
export const DEFAULT_MAX_API_REQUESTS = 300;
export const CANARY_MAX_API_REQUESTS = 3;
export const MAX_ENRICHMENT_LIMIT = 400;
export const MAX_PLAN_LIMIT = 1_000;

export const ACTIVE_ENRICHMENT_CATEGORIES = CATEGORIES
  .filter((category): category is typeof category & { type: "genre" | "decade" } => (
    category.type === "genre" || category.type === "decade"
  ))
  .map(({ id, label, type }) => ({ id, label, type }));

export const ENRICHMENT_BALANCE_CATEGORY_IDS = ACTIVE_ENRICHMENT_CATEGORIES.map((category) => category.id);

export type EnrichmentTrackCandidate = {
  id: string;
  spotifyTrackId: string;
  isrc: string | null;
  title: string;
  artistNames: string;
  streamCount: bigint | null;
  streamCountSource: string | null;
  soundchartsUuid: string | null;
  difficulty: string | null;
  categories: ReadonlyArray<{ categoryId: string }>;
};

export type EnrichmentRecordingGroup = {
  key: string;
  normalizedIsrc: string | null;
  tracks: EnrichmentTrackCandidate[];
  targetTrackIds: string[];
  representative: EnrichmentTrackCandidate;
  categoryIds: string[];
  cachedSoundchartsUuid: string | null;
  hasConflictingCachedUuids: boolean;
};

export type DifficultyCoverage = Record<Difficulty, number>;

export type RankedCoverageMatrix = {
  allMusic: DifficultyCoverage;
  categories: Record<string, DifficultyCoverage>;
};

export type UnderfilledCell = {
  categoryId: string;
  categoryLabel: string;
  difficulty: Difficulty;
  ranked: number;
  target: number;
  deficit: number;
};

export type PlannedEnrichmentGroup = EnrichmentRecordingGroup & {
  activeCategoryIds: string[];
  needScore: number;
  difficulty: "unknown";
  estimatedCustomerRequests: { minimum: number; likely: number; upper: number };
};

export type SoundchartsSelectionOptions = {
  limit: number;
  targetPerCell: number;
  includeCachedUnranked: boolean;
  refresh: boolean;
};

export type SoundchartsPlanningOptions = SoundchartsSelectionOptions & { verbose: boolean };

export type SoundchartsExecutionOptions = SoundchartsSelectionOptions & {
  maxApiRequests: number;
  canary: boolean;
};

export type SoundchartsEnrichmentPlan = {
  catalogTracks: number;
  rankedTracks: number;
  unrankedTracks: number;
  targetPerCell: number;
  coverage: RankedCoverageMatrix;
  underfilledCells: UnderfilledCell[];
  freshUnrankedGroups: number;
  cachedUnrankedGroups: number;
  conflictingCachedUuidGroups: number;
  eligibleGroups: number;
  selectedGroups: PlannedEnrichmentGroup[];
  localTracksRepresented: number;
  selectedCategoryCoverage: Record<string, number>;
  requestEstimate: { minimum: number; likely: number; upper: number };
};

export type SoundchartsPlanningDependencies = {
  readTracks: () => Promise<EnrichmentTrackCandidate[]>;
};

export class SoundchartsSelectionArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SoundchartsSelectionArgumentError";
  }
}

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function compareStable(left: { key: string }, right: { key: string }): number {
  return stableHash(left.key) - stableHash(right.key) || left.key.localeCompare(right.key);
}

function recordingKey(track: EnrichmentTrackCandidate): { key: string; normalizedIsrc: string | null } {
  const normalizedIsrc = track.isrc ? normalizeIsrc(track.isrc) : "";
  if (/^[A-Z]{2}[A-Z0-9]{10}$/.test(normalizedIsrc)) {
    return { key: `isrc:${normalizedIsrc}`, normalizedIsrc };
  }
  return { key: `spotify:${track.spotifyTrackId}`, normalizedIsrc: null };
}

function isTarget(track: EnrichmentTrackCandidate, refresh: boolean): boolean {
  if (track.streamCount === null) return true;
  return refresh && track.streamCountSource === "soundcharts";
}

export function groupEnrichmentCandidates(
  tracks: readonly EnrichmentTrackCandidate[],
  refresh = false,
): EnrichmentRecordingGroup[] {
  const grouped = new Map<string, { normalizedIsrc: string | null; tracks: EnrichmentTrackCandidate[] }>();
  for (const track of tracks) {
    const { key, normalizedIsrc } = recordingKey(track);
    const current = grouped.get(key) ?? { normalizedIsrc, tracks: [] };
    current.tracks.push(track);
    grouped.set(key, current);
  }

  const groups: EnrichmentRecordingGroup[] = [];
  for (const [key, group] of grouped) {
    const targets = group.tracks.filter((track) => isTarget(track, refresh));
    if (targets.length === 0) continue;
    const orderedTracks = [...group.tracks].sort((left, right) => compareStable(
      { key: left.spotifyTrackId },
      { key: right.spotifyTrackId },
    ));
    const targetIds = new Set(targets.map((track) => track.id));
    const cachedUuids = [...new Set(group.tracks
      .map((track) => track.soundchartsUuid)
      .filter((uuid): uuid is string => Boolean(uuid)))];
    groups.push({
      key,
      normalizedIsrc: group.normalizedIsrc,
      tracks: orderedTracks,
      targetTrackIds: targets.map((track) => track.id),
      representative: orderedTracks.find((track) => targetIds.has(track.id))!,
      categoryIds: [...new Set(targets.flatMap((track) => track.categories.map((item) => item.categoryId)))],
      cachedSoundchartsUuid: cachedUuids.length === 1 ? cachedUuids[0]! : null,
      hasConflictingCachedUuids: cachedUuids.length > 1,
    });
  }
  return groups.sort(compareStable);
}

export function buildRankedCoverageMatrix(
  tracks: readonly EnrichmentTrackCandidate[],
): RankedCoverageMatrix {
  const allMusic = emptyDifficultyCoverage();
  const categories = Object.fromEntries(
    ACTIVE_ENRICHMENT_CATEGORIES.map((category) => [category.id, emptyDifficultyCoverage()]),
  );
  const activeIds = new Set(ENRICHMENT_BALANCE_CATEGORY_IDS);

  for (const track of tracks) {
    const difficulty = asDifficulty(track.difficulty);
    if (!difficulty) continue;
    allMusic[difficulty] += 1;
    for (const categoryId of new Set(track.categories.map((category) => category.categoryId))) {
      if (activeIds.has(categoryId)) categories[categoryId]![difficulty] += 1;
    }
  }
  return { allMusic, categories };
}

export function buildSoundchartsEnrichmentPlan(
  tracks: readonly EnrichmentTrackCandidate[],
  options: SoundchartsSelectionOptions,
): SoundchartsEnrichmentPlan {
  const coverage = buildRankedCoverageMatrix(tracks);
  const underfilledCells = buildUnderfilledCells(coverage, options.targetPerCell);
  const categoryNeed = new Map<string, number>();
  for (const cell of underfilledCells) {
    categoryNeed.set(cell.categoryId, (categoryNeed.get(cell.categoryId) ?? 0) + cell.deficit);
  }

  const groups = groupEnrichmentCandidates(tracks, options.refresh);
  const targetById = new Map(tracks.map((track) => [track.id, track]));
  const isCachedUnranked = (group: EnrichmentRecordingGroup): boolean => (
    group.cachedSoundchartsUuid !== null
    && group.targetTrackIds.every((id) => targetById.get(id)?.streamCount === null)
  );
  const conflictingCachedUuidGroups = groups.filter((group) => group.hasConflictingCachedUuids).length;
  const cachedUnrankedGroups = groups.filter((group) => (
    !group.hasConflictingCachedUuids && isCachedUnranked(group)
  )).length;
  const freshUnrankedGroups = groups.filter((group) => (
    !group.hasConflictingCachedUuids
    && group.cachedSoundchartsUuid === null
    && group.targetTrackIds.every((id) => targetById.get(id)?.streamCount === null)
  )).length;
  const eligible = groups.filter((group) => (
    !group.hasConflictingCachedUuids
    && (options.includeCachedUnranked || !isCachedUnranked(group))
  ));

  const selectedGroups = eligible
    .map((group): PlannedEnrichmentGroup => {
      const activeCategoryIds = ENRICHMENT_BALANCE_CATEGORY_IDS.filter((id) => group.categoryIds.includes(id));
      const topNeeds = activeCategoryIds
        .map((id) => categoryNeed.get(id) ?? 0)
        .sort((left, right) => right - left)
        .slice(0, 3);
      return {
        ...group,
        activeCategoryIds,
        needScore: topNeeds.reduce((total, need) => total + need, 0),
        difficulty: "unknown",
        estimatedCustomerRequests: estimateGroupRequests(group),
      };
    })
    .sort((left, right) => (
      right.needScore - left.needScore
      || Number(Boolean(right.normalizedIsrc)) - Number(Boolean(left.normalizedIsrc))
      || right.tracks.length - left.tracks.length
      || compareStable(left, right)
    ))
    .slice(0, options.limit);

  const selectedCategoryCoverage = Object.fromEntries(
    ACTIVE_ENRICHMENT_CATEGORIES.map((category) => [
      category.id,
      selectedGroups.filter((group) => group.activeCategoryIds.includes(category.id)).length,
    ]),
  );
  const requestEstimate = selectedGroups.reduce((total, group) => ({
    minimum: total.minimum + group.estimatedCustomerRequests.minimum,
    likely: total.likely + group.estimatedCustomerRequests.likely,
    upper: total.upper + group.estimatedCustomerRequests.upper,
  }), { minimum: 0, likely: 0, upper: 0 });
  const rankedTracks = tracks.filter((track) => asDifficulty(track.difficulty) !== null).length;

  return {
    catalogTracks: tracks.length,
    rankedTracks,
    unrankedTracks: tracks.length - rankedTracks,
    targetPerCell: options.targetPerCell,
    coverage,
    underfilledCells,
    freshUnrankedGroups,
    cachedUnrankedGroups,
    conflictingCachedUuidGroups,
    eligibleGroups: eligible.length,
    selectedGroups,
    localTracksRepresented: selectedGroups.reduce((total, group) => total + group.tracks.length, 0),
    selectedCategoryCoverage,
    requestEstimate,
  };
}

export async function executeSoundchartsEnrichmentPlanning(
  options: SoundchartsPlanningOptions,
  dependencies: SoundchartsPlanningDependencies,
): Promise<SoundchartsEnrichmentPlan> {
  return buildSoundchartsEnrichmentPlan(await dependencies.readTracks(), options);
}

export function formatSoundchartsEnrichmentPlan(
  plan: SoundchartsEnrichmentPlan,
  options: { verbose?: boolean } = {},
): string {
  const genres = ACTIVE_ENRICHMENT_CATEGORIES.filter((category) => category.type === "genre");
  const decades = ACTIVE_ENRICHMENT_CATEGORIES.filter((category) => category.type === "decade");
  const displayedGroups = options.verbose ? plan.selectedGroups : plan.selectedGroups.slice(0, 20);
  return [
    "SOUNDCHARTS ENRICHMENT PLAN",
    "",
    `Catalog tracks: ${plan.catalogTracks.toLocaleString("en-US")}`,
    `Ranked tracks: ${plan.rankedTracks.toLocaleString("en-US")}`,
    `Unranked tracks: ${plan.unrankedTracks.toLocaleString("en-US")}`,
    "",
    `Target ranked per category/difficulty cell: ${plan.targetPerCell}`,
    "Candidate difficulty is unknown until Soundcharts returns verified stream counts.",
    "",
    `Fresh unranked recording groups: ${plan.freshUnrankedGroups}`,
    `Previously resolved but still unranked: ${plan.cachedUnrankedGroups}`,
    `Groups with conflicting cached UUIDs: ${plan.conflictingCachedUuidGroups}`,
    `Eligible groups: ${plan.eligibleGroups}`,
    `Selected groups: ${plan.selectedGroups.length}`,
    `Local Spotify tracks represented: ${plan.localTracksRepresented}`,
    "",
    "CURRENT RANKED GAMEPLAY COVERAGE",
    "",
    "ALL MUSIC",
    formatCoverageTable([{ label: "All Music", coverage: plan.coverage.allMusic }]),
    "",
    "GENRES",
    formatCoverageTable(genres.map((category) => ({
      label: category.label,
      coverage: plan.coverage.categories[category.id]!,
    }))),
    "",
    "DECADES",
    formatCoverageTable(decades.map((category) => ({
      label: category.label,
      coverage: plan.coverage.categories[category.id]!,
    }))),
    "",
    "MOST UNDERFILLED CELLS",
    ...plan.underfilledCells.slice(0, 20).map((cell, index) => (
      `${index + 1}. ${cell.categoryLabel} x ${DIFFICULTY_LABELS[cell.difficulty]}: ${cell.ranked} / ${cell.target}`
    )),
    ...(plan.underfilledCells.length === 0 ? ["All active cells meet the planning target."] : []),
    "",
    "SELECTED CANDIDATE COVERAGE",
    ...ACTIVE_ENRICHMENT_CATEGORIES.map((category) => (
      `${category.label}: ${plan.selectedCategoryCoverage[category.id] ?? 0}`
    )),
    "",
    `TOP ${displayedGroups.length} SELECTED CANDIDATES`,
    ...displayedGroups.map((group, index) => (
      `${index + 1}. ${group.representative.title} - ${group.representative.artistNames}`
      + ` | need=${group.needScore}`
      + ` | difficulty=${group.difficulty}`
      + ` | tracks=${group.tracks.length}`
      + ` | categories=${group.activeCategoryIds.join(", ") || "All Music only"}`
    )),
    ...(displayedGroups.length === 0 ? ["No eligible recording groups selected."] : []),
    ...(!options.verbose && plan.selectedGroups.length > displayedGroups.length
      ? [`... ${plan.selectedGroups.length - displayedGroups.length} more selected; use --verbose to display all.`]
      : []),
    "",
    "REQUEST ESTIMATE",
    `Minimum customer API HTTP requests: ${plan.requestEstimate.minimum}`,
    `Likely customer API HTTP requests: ${plan.requestEstimate.likely}`,
    `Upper customer API HTTP requests: ${plan.requestEstimate.upper}`,
    "HTTP request estimate, NOT guaranteed quota consumption. Retries are not included.",
    "",
    "Scoring sums the three largest active category deficits per recording group. This rewards useful overlap while capping the advantage of tracks with many labels.",
  ].join("\n");
}

export function parseSoundchartsPlanningOptions(args: readonly string[]): SoundchartsPlanningOptions {
  const values = parseArguments(args, new Set(["limit", "target-per-cell"]), new Set([
    "include-cached-unranked", "verbose",
  ]));
  return {
    limit: parseBoundedInteger(values.values.get("limit"), DEFAULT_ENRICHMENT_LIMIT, 1, MAX_PLAN_LIMIT, "limit"),
    targetPerCell: parseBoundedInteger(
      values.values.get("target-per-cell"), DEFAULT_TARGET_PER_CELL, 1, 10_000, "target-per-cell",
    ),
    includeCachedUnranked: values.flags.has("include-cached-unranked"),
    refresh: false,
    verbose: values.flags.has("verbose"),
  };
}

export function parseSoundchartsExecutionOptions(args: readonly string[]): SoundchartsExecutionOptions {
  const values = parseArguments(args, new Set([
    "limit", "target-per-cell", "max-api-requests",
  ]), new Set(["include-cached-unranked", "refresh", "canary"]));
  const canary = values.flags.has("canary");
  const limit = parseBoundedInteger(
    values.values.get("limit"), DEFAULT_ENRICHMENT_LIMIT, 1, MAX_ENRICHMENT_LIMIT, "limit",
  );
  const maxApiRequests = parseBoundedInteger(
    values.values.get("max-api-requests"), DEFAULT_MAX_API_REQUESTS, 1, 100_000, "max-api-requests",
  );
  return {
    limit: canary ? 1 : limit,
    targetPerCell: parseBoundedInteger(
      values.values.get("target-per-cell"), DEFAULT_TARGET_PER_CELL, 1, 10_000, "target-per-cell",
    ),
    includeCachedUnranked: values.flags.has("include-cached-unranked"),
    refresh: canary ? false : values.flags.has("refresh"),
    maxApiRequests: canary ? CANARY_MAX_API_REQUESTS : maxApiRequests,
    canary,
  };
}

function emptyDifficultyCoverage(): DifficultyCoverage {
  return { easy: 0, normal: 0, hard: 0, extreme: 0, impossible: 0 };
}

function asDifficulty(value: string | null): Difficulty | null {
  return DIFFICULTIES.find((difficulty) => difficulty === value) ?? null;
}

function buildUnderfilledCells(coverage: RankedCoverageMatrix, target: number): UnderfilledCell[] {
  const categoryIndex = new Map(ACTIVE_ENRICHMENT_CATEGORIES.map((category, index) => [category.id, index]));
  return ACTIVE_ENRICHMENT_CATEGORIES.flatMap((category) => DIFFICULTIES.map((difficulty) => {
    const ranked = coverage.categories[category.id]![difficulty];
    return {
      categoryId: category.id,
      categoryLabel: category.label,
      difficulty,
      ranked,
      target,
      deficit: Math.max(target - ranked, 0),
    };
  })).filter((cell) => cell.deficit > 0).sort((left, right) => (
    right.deficit - left.deficit
    || categoryIndex.get(left.categoryId)! - categoryIndex.get(right.categoryId)!
    || DIFFICULTIES.indexOf(left.difficulty) - DIFFICULTIES.indexOf(right.difficulty)
  ));
}

function estimateGroupRequests(group: EnrichmentRecordingGroup): {
  minimum: number; likely: number; upper: number;
} {
  if (group.cachedSoundchartsUuid) return { minimum: 1, likely: 1, upper: 1 };
  return {
    minimum: 2,
    likely: 2,
    upper: group.normalizedIsrc ? 3 : 2,
  };
}

function formatCoverageTable(rows: Array<{ label: string; coverage: DifficultyCoverage }>): string {
  const labelWidth = 22;
  const cellWidth = 11;
  const header = `${"".padEnd(labelWidth)}${[
    ...DIFFICULTIES.map((difficulty) => DIFFICULTY_LABELS[difficulty]),
    "Total",
  ].map((label) => label.padStart(cellWidth)).join("")}`;
  return [header, ...rows.map((row) => {
    const values = DIFFICULTIES.map((difficulty) => row.coverage[difficulty]);
    const total = values.reduce((sum, value) => sum + value, 0);
    return `${row.label.padEnd(labelWidth)}${[...values, total]
      .map((value) => String(value).padStart(cellWidth)).join("")}`;
  })].join("\n");
}

function parseArguments(
  args: readonly string[],
  valueNames: ReadonlySet<string>,
  flagNames: ReadonlySet<string>,
): { values: Map<string, string>; flags: Set<string> } {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (!argument.startsWith("--")) throw new SoundchartsSelectionArgumentError(`Unknown option: ${argument}`);
    const separator = argument.indexOf("=");
    const name = argument.slice(2, separator >= 0 ? separator : undefined);
    if (flagNames.has(name)) {
      if (separator >= 0) throw new SoundchartsSelectionArgumentError(`--${name} does not take a value.`);
      flags.add(name);
      continue;
    }
    if (!valueNames.has(name)) throw new SoundchartsSelectionArgumentError(`Unknown option: --${name}`);
    const value = separator >= 0 ? argument.slice(separator + 1) : args[++index];
    if (!value || value.startsWith("--")) {
      throw new SoundchartsSelectionArgumentError(`--${name} requires an integer value.`);
    }
    values.set(name, value);
  }
  return { values, flags };
}

function parseBoundedInteger(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) throw new SoundchartsSelectionArgumentError(`--${name} must be an integer.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new SoundchartsSelectionArgumentError(`--${name} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}
