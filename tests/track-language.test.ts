import { describe, expect, it, vi } from "vitest";
import {
  backfillTrackLanguages,
  deriveTrackLanguageState,
  normalizeLanguageDetectionText,
  type LanguageBackfillTrack,
  type TrackLanguageState,
} from "@/lib/catalog/track-language";

function detect(title: string, albumName: string): TrackLanguageState {
  return deriveTrackLanguageState({ spotifyTrackId: title, title, albumName });
}

describe("track language classification", () => {
  it.each([
    ["en", "Dancing through the night with all my friends", "Songs about love and summer"],
    ["pl", "Tańczymy razem przez całą noc", "Piosenki o miłości i lecie"],
    ["es", "La música española habla del corazón", "La vida los amigos y la familia todos los días"],
  ])("classifies confident %s text as gameplay eligible", (code, title, albumName) => {
    expect(detect(title, albumName)).toMatchObject({
      languageCode: code,
      languageSource: "detector",
      languageEligible: true,
    });
  });

  it.each([
    ["de", "Wir tanzen gemeinsam durch die ganze Nacht", "Lieder über Liebe und Sommer"],
    ["fr", "Nous dansons ensemble pendant toute la nuit", "Chansons sur l'amour et l'été"],
    ["it", "La musica italiana parla del cuore", "Della vita degli amici e della famiglia ogni giorno"],
    ["pt", "Dançamos juntos durante toda a noite", "Canções de amor e verão"],
    ["ru", "Мы танцуем вместе всю долгую ночь", "Песни о любви и лете"],
  ])("classifies confident %s text but keeps it ineligible", (code, title, albumName) => {
    expect(detect(title, albumName)).toMatchObject({
      languageCode: code,
      languageSource: "detector",
      languageEligible: false,
    });
  });

  it.each(["Again", "Cars", "Free", "One", "Halo"])("keeps short ambiguous title %s unknown", (title) => {
    expect(detect(title, title)).toEqual({
      languageCode: null,
      languageSource: "unknown",
      languageConfidence: null,
      languageEligible: false,
    });
  });

  it("uses manual override, then persisted manual, then provider before detection", () => {
    const detector = vi.fn(() => [{ lang: "de", accuracy: 1 }]);
    expect(deriveTrackLanguageState({
      spotifyTrackId: "override", title: "Kurzer Titel", albumName: "Ein Album",
      providerLanguageCode: "fr", existingLanguageCode: "de", existingLanguageSource: "manual",
    }, { overrides: { override: "pl" }, detector })).toMatchObject({
      languageCode: "pl", languageSource: "manual", languageEligible: true,
    });
    expect(deriveTrackLanguageState({
      spotifyTrackId: "persisted", title: "Kurzer Titel", albumName: "Ein Album",
      providerLanguageCode: "fr", existingLanguageCode: "es", existingLanguageSource: "manual",
    }, { overrides: {}, detector })).toMatchObject({
      languageCode: "es", languageSource: "manual", languageEligible: true,
    });
    expect(deriveTrackLanguageState({
      spotifyTrackId: "provider", title: "Kurzer Titel", albumName: "Ein Album",
      providerLanguageCode: "de",
    }, { overrides: {}, detector })).toMatchObject({
      languageCode: "de", languageSource: "provider", languageEligible: false,
    });
    expect(detector).not.toHaveBeenCalled();
  });

  it("preserves a persisted trusted provider classification", () => {
    expect(deriveTrackLanguageState({
      spotifyTrackId: "provider", title: "One", albumName: "One",
      existingLanguageCode: "es", existingLanguageSource: "provider",
    }, { overrides: {} })).toMatchObject({
      languageCode: "es", languageSource: "provider", languageEligible: true,
    });
  });

  it("strips version metadata before detection", () => {
    expect(normalizeLanguageDetectionText(
      "Dancing Through the Night (Remastered 2024)",
      "Dancing Through the Night - Radio Edit",
    )).toBe("Dancing Through the Night");
  });

  it("backfills offline and is deterministic and idempotent", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network forbidden"));
    const tracks: LanguageBackfillTrack[] = [{
      id: "one",
      spotifyTrackId: "spotify-one",
      title: "Dancing through the night with all my friends",
      albumName: "Songs about love and summer",
      languageCode: null,
      languageSource: null,
      languageConfidence: null,
      languageEligible: true,
    }];
    const updateTrack = vi.fn(async (id: string, state: TrackLanguageState) => {
      Object.assign(tracks.find((track) => track.id === id)!, state);
    });

    const first = await backfillTrackLanguages(tracks, { updateTrack });
    const second = await backfillTrackLanguages(tracks, { updateTrack });

    expect(first).toMatchObject({ scanned: 1, eligible: 1, updated: 1, byLanguage: { en: 1 } });
    expect(second).toMatchObject({ scanned: 1, eligible: 1, updated: 0, byLanguage: { en: 1 } });
    expect(updateTrack).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
