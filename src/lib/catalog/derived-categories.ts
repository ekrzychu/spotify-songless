import { db } from "@/lib/db";

export const DECADE_CATEGORY_IDS = ["70s", "80s", "90s", "2000s", "2010s", "2020s"] as const;

export type DecadeCategoryId = (typeof DECADE_CATEGORY_IDS)[number];

export type DecadeAssociationSummary = {
  scanned: number;
  assigned: number;
  unassigned: number;
  byDecade: Record<DecadeCategoryId, number>;
};

const decadeRanges: ReadonlyArray<{ start: number; end: number; categoryId: DecadeCategoryId }> = [
  { start: 1970, end: 1979, categoryId: "70s" },
  { start: 1980, end: 1989, categoryId: "80s" },
  { start: 1990, end: 1999, categoryId: "90s" },
  { start: 2000, end: 2009, categoryId: "2000s" },
  { start: 2010, end: 2019, categoryId: "2010s" },
  { start: 2020, end: 2029, categoryId: "2020s" },
];

function getReleaseYear(releaseDate: string | null | undefined): number | null {
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(releaseDate?.trim() ?? "");
  if (!match) return null;

  const year = Number(match[1]);
  const month = match[2] ? Number(match[2]) : null;
  const day = match[3] ? Number(match[3]) : null;
  if (month !== null && (month < 1 || month > 12)) return null;
  if (day !== null) {
    const parsed = new Date(Date.UTC(year, month! - 1, day));
    if (
      parsed.getUTCFullYear() !== year
      || parsed.getUTCMonth() !== month! - 1
      || parsed.getUTCDate() !== day
    ) return null;
  }

  return year;
}

export function deriveDecadeCategoryId(releaseDate: string | null | undefined): DecadeCategoryId | null {
  const year = getReleaseYear(releaseDate);
  if (year === null) return null;
  return decadeRanges.find(({ start, end }) => year >= start && year <= end)?.categoryId ?? null;
}

export async function assignDerivedCategories(
  trackId: string,
  releaseDate: string | null | undefined,
): Promise<DecadeCategoryId | null> {
  const categoryId = deriveDecadeCategoryId(releaseDate);
  const staleCategoryIds = DECADE_CATEGORY_IDS.filter((id) => id !== categoryId);

  await db.trackCategory.deleteMany({
    where: { trackId, categoryId: { in: staleCategoryIds } },
  });

  if (categoryId) {
    await db.trackCategory.upsert({
      where: { trackId_categoryId: { trackId, categoryId } },
      create: { trackId, categoryId },
      update: {},
    });
  }

  return categoryId;
}

export async function backfillDerivedCategories(): Promise<DecadeAssociationSummary> {
  const tracks = await db.gameTrack.findMany({ select: { id: true, releaseDate: true } });
  const byDecade = Object.fromEntries(
    DECADE_CATEGORY_IDS.map((categoryId) => [categoryId, 0]),
  ) as Record<DecadeCategoryId, number>;
  let assigned = 0;

  for (const track of tracks) {
    const categoryId = await assignDerivedCategories(track.id, track.releaseDate);
    if (categoryId) {
      byDecade[categoryId] += 1;
      assigned += 1;
    }
  }

  return {
    scanned: tracks.length,
    assigned,
    unassigned: tracks.length - assigned,
    byDecade,
  };
}

export function formatDecadeAssociationSummary(summary: DecadeAssociationSummary): string {
  return [
    "DECADE ASSOCIATIONS",
    `Tracks scanned: ${summary.scanned}`,
    `Assigned: ${summary.assigned}`,
    `Unassigned (missing, invalid, or outside 1970-2029): ${summary.unassigned}`,
    ...DECADE_CATEGORY_IDS.map((categoryId) => `${categoryId}: ${summary.byDecade[categoryId]}`),
  ].join("\n");
}
