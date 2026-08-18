import { describe, expect, it } from "vitest";
import { classifyTrackQuality, normalizeTrackQualityTitle } from "@/lib/catalog/track-quality";

describe("track quality classification", () => {
  it.each([
    ["Track Name (SKIT)", "skit"],
    ["Track Name [SKIT]", "skit"],
    ["Track Name - Skit", "skit"],
    ["Artist Interview", "interview"],
    ["Entrevistas", "interview"],
    ["Vinheta (Entrevístas)", "interview"],
    ["COMMENTARY - Track", "commentary"],
    ["Spoken Word: Chapter 1", "spoken"],
    ["Dialogue", "dialogue"],
    ["Voice Memo #2", "voice-memo"],
    ["Voice Note - Studio", "voice-memo"],
  ])("excludes %s as %s", (title, reason) => {
    expect(classifyTrackQuality(title)).toEqual({ eligible: false, reason });
  });

  it.each([
    "Boys Don't Cry",
    "Army Dreamers",
    "Never Gonna Give You Up",
    "Morning Mood",
    "Intergalactic",
    "Live Forever",
    "Demo",
    "The Interview",
    "Intro",
    "Instrumental",
    "Remix",
  ])("keeps legitimate or ambiguous title %s eligible", (title) => {
    expect(classifyTrackQuality(title)).toEqual({ eligible: true, reason: null });
  });

  it("normalizes case, punctuation, diacritics, and whitespace deterministically", () => {
    expect(normalizeTrackQualityTitle("  VINHETA — Entrevístas!!!  ")).toBe("vinheta entrevistas");
  });
});
