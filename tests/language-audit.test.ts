import { describe, expect, it } from "vitest";
import { buildLanguageAudit, formatLanguageAudit } from "@/lib/catalog/language-audit";

describe("language audit", () => {
  it("reports eligibility, sources, confidence, and ambiguous samples without mutation", () => {
    const tracks = [
      { spotifyTrackId: "a", title: "English", artistNames: "A", languageCode: "en", languageSource: "detector", languageConfidence: 0.97, languageEligible: true },
      { spotifyTrackId: "b", title: "Deutsch", artistNames: "B", languageCode: "de", languageSource: "detector", languageConfidence: 0.9, languageEligible: false },
      { spotifyTrackId: "c", title: "One", artistNames: "C", languageCode: null, languageSource: "unknown", languageConfidence: null, languageEligible: true },
    ] as const;
    const original = structuredClone(tracks);
    const audit = buildLanguageAudit(tracks);

    expect(audit).toMatchObject({
      total: 3, accepted: 2, classifiedAllowed: 1, unclassifiedAccepted: 1, rejectedClassified: 1,
      byLanguage: { en: 1, de: 1, unknown: 1 },
      bySource: { detector: 2, unknown: 1 },
    });
    expect(audit.confidence).toMatchObject({ unknown: 1, "0.80-0.94": 1, "0.95-1.00": 1 });
    expect(formatLanguageAudit(audit)).toContain("One - C (unknown)");
    expect(tracks).toEqual(original);
  });
});
