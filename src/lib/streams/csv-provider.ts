import { readFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";
import type { StreamCountLookup, StreamCountProvider } from "@/lib/streams/provider";

type CsvRow = { spotify_track_id?: string; isrc?: string; stream_count?: string };

export class CsvStreamCountProvider implements StreamCountProvider {
  private constructor(
    private readonly byTrackId: ReadonlyMap<string, number>,
    private readonly byIsrc: ReadonlyMap<string, number>,
  ) {}

  static async fromFile(path: string): Promise<CsvStreamCountProvider> {
    const text = await readFile(path, "utf8");
    const rows = parse(text, { columns: true, skip_empty_lines: true, trim: true }) as CsvRow[];
    const byTrackId = new Map<string, number>();
    const byIsrc = new Map<string, number>();
    for (const row of rows) {
      const streams = Number(row.stream_count);
      if (!Number.isSafeInteger(streams) || streams < 0) continue;
      if (row.spotify_track_id) byTrackId.set(row.spotify_track_id, streams);
      if (row.isrc) byIsrc.set(normalizeIsrc(row.isrc), streams);
    }
    return new CsvStreamCountProvider(byTrackId, byIsrc);
  }

  async getStreamCount(track: StreamCountLookup): Promise<number | null> {
    return this.byTrackId.get(track.spotifyTrackId)
      ?? (track.isrc ? this.byIsrc.get(normalizeIsrc(track.isrc)) : undefined)
      ?? null;
  }
}

function normalizeIsrc(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toUpperCase();
}
