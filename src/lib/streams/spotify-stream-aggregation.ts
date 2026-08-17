export type SpotifyStreamAggregation = {
  streamCount: number | null;
  identifierCount: number;
  uniqueValueCount: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function summarizeSpotifyStreams(plots: readonly unknown[]): SpotifyStreamAggregation {
  const identifiers = new Set<string>();
  const uniqueValues = new Set<bigint>();

  for (const plotValue of plots) {
    const plot = asRecord(plotValue);
    if (!plot) continue;
    if (typeof plot.identifier === "string" && plot.identifier.length > 0) {
      identifiers.add(plot.identifier);
    }
    if (typeof plot.value !== "number" || !Number.isSafeInteger(plot.value) || plot.value < 0) continue;
    uniqueValues.add(BigInt(plot.value));
  }

  if (uniqueValues.size === 0) {
    return { streamCount: null, identifierCount: identifiers.size, uniqueValueCount: 0 };
  }

  let total = 0n;
  for (const value of uniqueValues) total += value;
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Aggregated Spotify streams exceed JavaScript's safe integer range");
  }
  return {
    streamCount: Number(total),
    identifierCount: identifiers.size,
    uniqueValueCount: uniqueValues.size,
  };
}

export function aggregateSpotifyStreams(plots: readonly unknown[]): number | null {
  return summarizeSpotifyStreams(plots).streamCount;
}
