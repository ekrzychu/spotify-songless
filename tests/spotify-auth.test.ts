import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieStore = vi.hoisted(() => ({
  getAll: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => cookieStore) }));

import {
  clearSpotifySession,
  spotifyAuthorizationParameters,
} from "@/lib/spotify/auth";

describe("Spotify account switching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookieStore.getAll.mockReturnValue([
      { name: "nd_spotify", value: "session" },
      { name: "nd_oauth_abc", value: "attempt" },
      { name: "nd_other", value: "keep" },
    ]);
  });

  it("forces the Spotify account chooser without changing PKCE fields", () => {
    const query = spotifyAuthorizationParameters({
      clientId: "client", redirectUri: "https://example.test/callback", state: "state", challenge: "challenge",
    });
    expect(query.get("show_dialog")).toBe("true");
    expect(query.get("code_challenge_method")).toBe("S256");
    expect(query.get("code_challenge")).toBe("challenge");
    expect(query.get("state")).toBe("state");
  });

  it("clears the token and temporary OAuth cookies only", async () => {
    await clearSpotifySession();
    expect(cookieStore.delete).toHaveBeenCalledWith("nd_spotify");
    expect(cookieStore.delete).toHaveBeenCalledWith("nd_oauth");
    expect(cookieStore.delete).toHaveBeenCalledWith("nd_oauth_abc");
    expect(cookieStore.delete).not.toHaveBeenCalledWith("nd_other");
  });
});
