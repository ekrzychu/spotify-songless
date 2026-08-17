import { describe, expect, it } from "vitest";
import {
  matchesVisibleTrack,
  normalizeSearchText,
  rankAndDedupeVisibleTracks,
  visibleTrackMatchRank,
  type VisibleTrackFields,
} from "@/lib/spotify/search-match";

const hello: VisibleTrackFields = { title: "Hello", artistNames: ["Adele"] };

describe("visible title and artist search matching", () => {
  it.each([
    ["hello", hello],
    ["adele", hello],
    ["adele hello", hello],
    ["hello adele", hello],
    ["bohemian queen", { title: "Bohemian Rhapsody", artistNames: ["Queen"] }],
    ["beyonce", { title: "Halo", artistNames: ["Beyoncé"] }],
    ["never gonna give you up", { title: "Never Gonna Give You Up", artistNames: ["Rick Astley"] }],
    ["emi", { title: "Lose Yourself", artistNames: ["Eminem"] }],
    ["bohem", { title: "Bohemian Rhapsody", artistNames: ["Queen"] }],
    ["ac dc", { title: "Back in Black", artistNames: ["AC/DC"] }],
  ])("matches %j using only visible fields", (query, fields) => {
    expect(matchesVisibleTrack(query, fields)).toBe(true);
  });

  it.each([
    ["hello from the other side", hello],
    ["wake me up inside", { title: "Bring Me To Life", artistNames: ["Evanescence"] }],
  ])("rejects unmatched lyric-like query %j", (query, fields) => {
    expect(matchesVisibleTrack(query, fields)).toBe(false);
  });

  it("normalizes case, spacing, punctuation, and Unicode diacritics", () => {
    expect(normalizeSearchText("  BEYONCÉ!!  Knowles ")).toBe("beyonce knowles");
    expect(normalizeSearchText("AC/DC")).toBe("ac dc");
  });

  it("requires every query token and never silently drops stop words", () => {
    expect(visibleTrackMatchRank("hello the", hello)).toBeNull();
  });

  it("ranks exact title before title prefix and cross-field token matches", () => {
    const tracks = [
      { id: "cross", title: "Hello", artists: ["Adele"] },
      { id: "prefix", title: "Hello Again", artists: ["Adele"] },
      { id: "exact", title: "Hello Adele", artists: ["Someone"] },
    ];
    expect(rankAndDedupeVisibleTracks("hello adele", tracks, (track) => ({
      title: track.title,
      artistNames: track.artists,
    })).map((track) => track.id)).toEqual(["exact", "cross", "prefix"]);
  });

  it("deduplicates normalized visible entries while preserving distinct versions", () => {
    const tracks = [
      { id: "first", title: "Halo", artists: ["Beyoncé"] },
      { id: "duplicate", title: "Halo!", artists: ["Beyonce"] },
      { id: "remix", title: "Halo (Remix)", artists: ["Beyoncé"] },
    ];
    expect(rankAndDedupeVisibleTracks("beyonce", tracks, (track) => ({
      title: track.title,
      artistNames: track.artists,
    })).map((track) => track.id)).toEqual(["first", "remix"]);
  });
});
