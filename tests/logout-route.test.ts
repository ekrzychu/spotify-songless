import { describe, expect, it, vi } from "vitest";

const clearSpotifySession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/spotify/auth", () => ({ clearSpotifySession }));

import { POST } from "@/app/api/auth/logout/route";

describe("POST /api/auth/logout", () => {
  it("clears the existing Spotify application session", async () => {
    clearSpotifySession.mockResolvedValue(undefined);
    const response = await POST();
    expect(clearSpotifySession).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
