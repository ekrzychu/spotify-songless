import { describe, expect, it } from "vitest";
import { addOAuthAttempt, consumeOAuthAttempt, type OAuthAttemptStore } from "@/lib/spotify/oauth-state";
import { oauthAttemptCookieName } from "@/lib/spotify/auth";

const NOW = 1_000_000;
const empty = (): OAuthAttemptStore => ({ version: 1, attempts: [] });

describe("OAuth attempt state", () => {
  it("accepts and consumes a valid state", () => {
    const store = addOAuthAttempt(empty(), { state: "valid", verifier: "secret", expiresAt: NOW + 1_000 }, NOW);
    const result = consumeOAuthAttempt(store, "valid", NOW);
    expect(result.attempt?.verifier).toBe("secret");
    expect(result.remaining.attempts).toHaveLength(0);
  });

  it("rejects a mismatched state without removing valid attempts", () => {
    const store = addOAuthAttempt(empty(), { state: "valid", verifier: "secret", expiresAt: NOW + 1_000 }, NOW);
    const result = consumeOAuthAttempt(store, "wrong", NOW);
    expect(result).toMatchObject({ attempt: null, reason: "mismatch" });
    expect(result.remaining.attempts).toHaveLength(1);
  });

  it("rejects and removes an expired state", () => {
    const store: OAuthAttemptStore = { version: 1, attempts: [{ state: "old", verifier: "secret", expiresAt: NOW - 1 }] };
    expect(consumeOAuthAttempt(store, "old", NOW)).toEqual({
      attempt: null, reason: "expired", remaining: { version: 1, attempts: [] },
    });
  });

  it("makes a state single-use", () => {
    const store = addOAuthAttempt(empty(), { state: "once", verifier: "secret", expiresAt: NOW + 1_000 }, NOW);
    const first = consumeOAuthAttempt(store, "once", NOW);
    expect(first.attempt).not.toBeNull();
    expect(consumeOAuthAttempt(first.remaining, "once", NOW).reason).toBe("mismatch");
  });

  it("keeps two authorization attempts independent", () => {
    const first = addOAuthAttempt(empty(), { state: "one", verifier: "first", expiresAt: NOW + 1_000 }, NOW);
    const both = addOAuthAttempt(first, { state: "two", verifier: "second", expiresAt: NOW + 1_000 }, NOW);
    const consumedFirst = consumeOAuthAttempt(both, "one", NOW);
    expect(consumedFirst.attempt?.verifier).toBe("first");
    expect(consumedFirst.remaining.attempts.map((item) => item.state)).toEqual(["two"]);
    expect(oauthAttemptCookieName("aaaaaaaaaaaaaaaaaaaa")).not.toBe(oauthAttemptCookieName("bbbbbbbbbbbbbbbbbbbb"));
  });
});
