import { describe, expect, it } from "vitest";
import { filterSchema, roundIdSchema } from "@/lib/validation";

describe("API input validation", () => {
  it("accepts configured filters", () => {
    expect(filterSchema.safeParse({ category: "rock", difficulty: "hard" }).success).toBe(true);
  });

  it.each([
    { category: "made-up", difficulty: "hard" },
    { category: "rock", difficulty: "legendary" },
    { category: 12, difficulty: "easy" },
  ])("rejects invalid category or difficulty", (input) => {
    expect(filterSchema.safeParse(input).success).toBe(false);
  });

  it("rejects malformed round IDs", () => {
    expect(roundIdSchema.safeParse("../../some-round").success).toBe(false);
  });
});
