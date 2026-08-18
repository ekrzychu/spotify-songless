import { db } from "@/lib/db";
import type { EnrichmentRecordingGroup } from "@/lib/streams/enrichment-selection";
import { DefinitiveSoundchartsNotFoundError } from "@/lib/streams/soundcharts-provider";

export type SoundchartsNotFoundDependencies = {
  markTargets: (targetTrackIds: readonly string[], notFoundAt: Date) => Promise<number>;
};

const databaseDependencies: SoundchartsNotFoundDependencies = {
  markTargets: async (targetTrackIds, notFoundAt) => {
    const result = await db.gameTrack.updateMany({
      where: { id: { in: [...targetTrackIds] } },
      data: { soundchartsNotFoundAt: notFoundAt },
    });
    return result.count;
  },
};

export async function markSoundchartsNotFoundTargets(
  group: Pick<EnrichmentRecordingGroup, "targetTrackIds">,
  options: { now?: Date; dependencies?: SoundchartsNotFoundDependencies } = {},
): Promise<number> {
  if (group.targetTrackIds.length === 0) return 0;
  return (options.dependencies ?? databaseDependencies).markTargets(
    group.targetTrackIds,
    options.now ?? new Date(),
  );
}

export async function recordSoundchartsNotFoundFailure(
  error: unknown,
  group: Pick<EnrichmentRecordingGroup, "targetTrackIds">,
  options: { now?: Date; dependencies?: SoundchartsNotFoundDependencies } = {},
): Promise<boolean> {
  if (!(error instanceof DefinitiveSoundchartsNotFoundError)) return false;
  await markSoundchartsNotFoundTargets(group, options);
  return true;
}
