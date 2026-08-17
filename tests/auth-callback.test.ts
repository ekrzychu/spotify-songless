import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  class FakeOAuthStateError extends Error {
    reason: "mismatch" | "expired";
    constructor(reason: "mismatch" | "expired") { super(reason); this.reason = reason; }
  }
  return { complete: vi.fn(), session: vi.fn(), FakeOAuthStateError };
});

vi.mock("@/lib/spotify/auth", () => ({
  completeAuthorization: mocks.complete,
  getSpotifySession: mocks.session,
  OAuthStateError: mocks.FakeOAuthStateError,
}));

import { GET } from "@/app/api/auth/spotify/callback/route";

describe("Spotify OAuth callback", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not invalidate or hide a separate valid session after a stale callback", async () => {
    mocks.complete.mockRejectedValue(new mocks.FakeOAuthStateError("mismatch"));
    mocks.session.mockResolvedValue({ accessToken: "existing", refreshToken: "existing", expiresAt: Date.now() + 60_000 });
    const response = await GET(new NextRequest("http://127.0.0.1:3000/api/auth/spotify/callback?code=old&state=stale"));
    expect(mocks.session).toHaveBeenCalledOnce();
    expect(new URL(response.headers.get("location")!).searchParams.get("auth")).toBe("stale");
  });

  it("reports a failed callback when no valid session exists", async () => {
    mocks.complete.mockRejectedValue(new mocks.FakeOAuthStateError("expired"));
    mocks.session.mockResolvedValue(null);
    const response = await GET(new NextRequest("http://127.0.0.1:3000/api/auth/spotify/callback?code=old&state=expired"));
    expect(new URL(response.headers.get("location")!).searchParams.get("auth")).toBe("failed");
  });
});
