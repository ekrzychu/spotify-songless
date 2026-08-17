import { CATEGORIES } from "@/lib/catalog/category-config";
import { normalizeIsrc } from "@/lib/streams/import-normalizer";

export const ENRICHMENT_BALANCE_CATEGORY_IDS = CATEGORIES
  .filter((category) => category.type === "genre" || category.type === "decade")
  .map((category) => category.id);

export type EnrichmentTrackCandidate = {
  id: string;
  spotifyTrackId: string;
  isrc: string | null;
  title: string;
  artistNames: string;
  streamCount: bigint | null;
  streamCountSource: string | null;
  soundchartsUuid: string | null;
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
    const cachedUuids = [...new Set(group.tracks
      .map((track) => track.soundchartsUuid)
      .filter((uuid): uuid is string => Boolean(uuid)))];
    groups.push({
      key,
      normalizedIsrc: group.normalizedIsrc,
      tracks: orderedTracks,
      targetTrackIds: targets.map((track) => track.id),
      representative: orderedTracks.find((track) => targets.some((target) => target.id === track.id))!,
      categoryIds: [...new Set(group.tracks.flatMap((track) => track.categories.map((item) => item.categoryId)))],
      cachedSoundchartsUuid: cachedUuids.length === 1 ? cachedUuids[0]! : null,
      hasConflictingCachedUuids: cachedUuids.length > 1,
    });
  }
  return groups.sort(compareStable);
}

export function selectBalancedEnrichmentGroups(
  tracks: readonly EnrichmentTrackCandidate[],
  limit: number,
  refresh = false,
): EnrichmentRecordingGroup[] {
  const remaining = groupEnrichmentCandidates(tracks, refresh);
  const selected: EnrichmentRecordingGroup[] = [];

  while (selected.length < limit && remaining.length > 0) {
    let addedInCycle = false;
    for (const categoryId of ENRICHMENT_BALANCE_CATEGORY_IDS) {
      const index = remaining.findIndex((group) => group.categoryIds.includes(categoryId));
      if (index < 0) continue;
      selected.push(remaining.splice(index, 1)[0]!);
      addedInCycle = true;
      if (selected.length >= limit) break;
    }
    if (!addedInCycle) break;
  }

  if (selected.length < limit) selected.push(...remaining.slice(0, limit - selected.length));
  return selected;
}
