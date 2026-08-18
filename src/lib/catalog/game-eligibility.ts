import {
  classifyTrackQuality,
  TRACK_QUALITY_REASONS,
  type TrackQualityReason,
} from "@/lib/catalog/track-quality";

export type GameEligibilityTrack = {
  id: string;
  title: string;
  gameEligible: boolean;
};

export type GameEligibilityBackfillSummary = {
  scanned: number;
  eligible: number;
  excluded: number;
  updated: number;
  byReason: Record<TrackQualityReason, number>;
};

export type GameEligibilityBackfillDependencies = {
  readTracks: () => Promise<GameEligibilityTrack[]>;
  updateEligibility: (id: string, gameEligible: boolean) => Promise<void>;
};

export function deriveGameEligibility(title: string): {
  gameEligible: boolean;
  reason: TrackQualityReason | null;
} {
  const classification = classifyTrackQuality(title);
  return {
    gameEligible: classification.eligible,
    reason: classification.reason,
  };
}

export async function backfillGameEligibility(
  dependencies: GameEligibilityBackfillDependencies,
): Promise<GameEligibilityBackfillSummary> {
  const tracks = await dependencies.readTracks();
  const byReason = Object.fromEntries(
    TRACK_QUALITY_REASONS.map((reason) => [reason, 0]),
  ) as Record<TrackQualityReason, number>;
  let eligible = 0;
  let excluded = 0;
  let updated = 0;

  for (const track of tracks) {
    const classification = deriveGameEligibility(track.title);
    if (classification.gameEligible) eligible += 1;
    else {
      excluded += 1;
      byReason[classification.reason!] += 1;
    }
    if (track.gameEligible !== classification.gameEligible) {
      await dependencies.updateEligibility(track.id, classification.gameEligible);
      updated += 1;
    }
  }

  return { scanned: tracks.length, eligible, excluded, updated, byReason };
}

export function formatGameEligibilityBackfill(summary: GameEligibilityBackfillSummary): string {
  return [
    "GAME ELIGIBILITY BACKFILL",
    `Tracks scanned: ${summary.scanned}`,
    `Eligible: ${summary.eligible}`,
    `Excluded: ${summary.excluded}`,
    `Rows updated: ${summary.updated}`,
    "By reason:",
    ...TRACK_QUALITY_REASONS.map((reason) => `  ${reason}: ${summary.byReason[reason]}`),
  ].join("\n");
}
