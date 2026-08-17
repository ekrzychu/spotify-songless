export type RawStreamRow = {
  spotify_track_id?: string;
  isrc?: string;
  stream_count?: string;
};

export type NormalizedStreamRow = {
  spotifyTrackId: string | null;
  isrc: string | null;
  streamCount: number;
  rowNumber: number;
};

export type NormalizedImport = {
  rows: NormalizedStreamRow[];
  invalid: number;
  conflicts: number;
};

type SeenValue = { count: number; rowIndex: number };

export function normalizeStreamRows(rawRows: RawStreamRow[]): NormalizedImport {
  const candidates: NormalizedStreamRow[] = [];
  let invalid = 0;
  rawRows.forEach((raw, index) => {
    const spotifyTrackId = raw.spotify_track_id?.trim() || null;
    const isrc = normalizeIsrc(raw.isrc ?? "") || null;
    const countText = raw.stream_count?.trim() ?? "";
    const count = /^\d+$/.test(countText) ? Number(countText) : Number.NaN;
    if (
      (!spotifyTrackId && !isrc)
      || (spotifyTrackId !== null && !/^[A-Za-z0-9]{22}$/.test(spotifyTrackId))
      || (isrc !== null && !/^[A-Z]{2}[A-Z0-9]{10}$/.test(isrc))
      || !Number.isSafeInteger(count)
      || count < 0
    ) {
      invalid += 1;
      return;
    }
    candidates.push({ spotifyTrackId, isrc, streamCount: count, rowNumber: index + 2 });
  });

  const byTrackId = new Map<string, SeenValue>();
  const byIsrc = new Map<string, SeenValue>();
  const isrcByTrackId = new Map<string, { isrc: string; rowIndex: number }>();
  const conflictRows = new Set<number>();
  candidates.forEach((row, rowIndex) => {
    compareCount(row.spotifyTrackId, row.streamCount, rowIndex, byTrackId, conflictRows);
    compareCount(row.isrc, row.streamCount, rowIndex, byIsrc, conflictRows);
    if (row.spotifyTrackId && row.isrc) {
      const previous = isrcByTrackId.get(row.spotifyTrackId);
      if (previous && previous.isrc !== row.isrc) {
        conflictRows.add(previous.rowIndex); conflictRows.add(rowIndex);
      } else isrcByTrackId.set(row.spotifyTrackId, { isrc: row.isrc, rowIndex });
    }
  });

  const seenRows = new Set<string>();
  const rows = candidates.filter((row, index) => {
    if (conflictRows.has(index)) return false;
    const key = `${row.spotifyTrackId ?? ""}|${row.isrc ?? ""}|${row.streamCount}`;
    if (seenRows.has(key)) return false;
    seenRows.add(key);
    return true;
  });
  return { rows, invalid, conflicts: conflictRows.size };
}

function compareCount(
  identifier: string | null,
  count: number,
  rowIndex: number,
  seen: Map<string, SeenValue>,
  conflicts: Set<number>,
): void {
  if (!identifier) return;
  const previous = seen.get(identifier);
  if (previous && previous.count !== count) {
    conflicts.add(previous.rowIndex); conflicts.add(rowIndex);
  } else if (!previous) seen.set(identifier, { count, rowIndex });
}

export function normalizeIsrc(value: string): string {
  return value.trim().replace(/[^a-z0-9]/gi, "").toUpperCase();
}
