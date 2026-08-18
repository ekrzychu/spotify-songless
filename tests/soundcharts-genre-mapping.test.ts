import { describe, expect, it } from "vitest";
import { mapSoundchartsGenresToActiveCategories } from "@/lib/catalog/soundcharts-genre-mapping";

describe("Soundcharts active genre mapping", () => {
  it.each([
    [[{ root: "pop", sub: [] }, { root: "rock", sub: [] }, { root: "folk", sub: [] }], ["pop", "rock"]],
    [[{ root: "electro", sub: ["electronic", "dance"] }], ["electronic"]],
    [[{ root: "r&b", sub: ["soul"] }], ["r-and-b"]],
    [[{ root: "rap", sub: [] }], ["hip-hop"]],
    [[{ root: "classical", sub: [] }], ["classical"]],
    [[{ root: "folk", sub: [] }], []],
  ] as const)("maps only explicit active taxonomy aliases", (genres, expected) => {
    expect(mapSoundchartsGenresToActiveCategories(genres)).toEqual(expected);
  });

  it("normalizes case, punctuation, hyphens, ampersands, and whitespace", () => {
    expect(mapSoundchartsGenresToActiveCategories([{
      root: "  POP  ",
      sub: ["HIP-HOP", "R & B", " E.D.M. "],
    }])).toEqual(["pop", "hip-hop", "r-and-b", "electronic"]);
  });
});
