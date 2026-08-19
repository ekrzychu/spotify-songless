import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { gameTrack: { findMany: mocks.findMany } } }));

import { GET } from "@/app/api/game/search/route";

function track(
  spotifyTrackId: string,
  title: string,
  artistNames: string,
  albumName = "Album",
  isrc: string | null = null,
) {
  return {
    spotifyTrackId,
    isrc,
    title,
    artistNames,
    artistsJson: JSON.stringify(artistNames.split(", ").map((name) => ({ name }))),
    albumName,
  };
}

function request(query: string, offset?: string): NextRequest {
  const url = new URL("http://127.0.0.1:3000/api/game/search");
  url.searchParams.set("q", query);
  if (offset !== undefined) url.searchParams.set("offset", offset);
  return new NextRequest(url);
}

describe("local catalog guess search API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([]);
  });

  it("returns an empty response without querying for a short query", async () => {
    const response = await GET(request("a"));
    await expect(response.json()).resolves.toEqual({ items: [], nextOffset: null });
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("searches playable local catalog tracks without gameplay eligibility filters", async () => {
    mocks.findMany.mockResolvedValue([track("nirvana", "Come As You Are", "Nirvana", "Nevermind", "USGF19942501")]);

    const response = await GET(request("came as"));
    await expect(response.json()).resolves.toEqual({
      items: [{
        spotifyTrackId: "nirvana",
        isrc: "USGF19942501",
        title: "Come As You Are",
        artistNames: "Nirvana",
        albumName: "Nevermind",
      }],
      nextOffset: null,
    });

    const query = mocks.findMany.mock.calls[0]?.[0];
    expect(query.where).toMatchObject({ playable: true });
    expect(query.where).not.toHaveProperty("streamCount");
    expect(query.where).not.toHaveProperty("difficulty");
    expect(query.where).not.toHaveProperty("gameEligible");
    expect(query.where).not.toHaveProperty("languageEligible");
    expect(query.where).not.toHaveProperty("categories");
    expect(query.take).toBe(101);
  });

  it("matches artists and returns the existing response fields", async () => {
    mocks.findMany.mockResolvedValue([track("hello", "Hello", "Adele", "25", "GBBKS1500214")]);

    const response = await GET(request("adele"));
    const payload = await response.json() as { items: Array<Record<string, unknown>> };
    expect(payload.items).toEqual([{
      spotifyTrackId: "hello",
      isrc: "GBBKS1500214",
      title: "Hello",
      artistNames: "Adele",
      albumName: "25",
    }]);
    expect(payload.items[0]).not.toHaveProperty("artistsJson");
  });

  it("ranks strong title matches first and deduplicates equivalent visible tracks", async () => {
    mocks.findMany.mockResolvedValue([
      track("artist", "Another Song", "Halo"),
      track("prefix", "Halo Again", "Beyonce"),
      track("exact", "Halo", "Beyonce"),
      track("duplicate", "Halo!", "Beyonce"),
    ]);

    const response = await GET(request("halo"));
    const payload = await response.json() as { items: Array<{ spotifyTrackId: string }> };
    expect(payload.items.map(({ spotifyTrackId }) => spotifyTrackId)).toEqual(["exact", "prefix", "artist"]);
  });

  it("returns a local 500 when the catalog query fails", async () => {
    mocks.findMany.mockRejectedValue(new Error("database unavailable"));

    const response = await GET(request("hello"));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Song search is temporarily unavailable" });
  });
});
