import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  spotifyFetch: vi.fn(),
}));

vi.mock("@/lib/spotify/auth", () => ({ getSpotifySession: mocks.getSession }));
vi.mock("@/lib/spotify/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/spotify/api")>(),
  spotifyFetch: mocks.spotifyFetch,
}));

import { PUT } from "@/app/api/spotify/playback/pause/route";

function request(body: unknown): NextRequest {
  return new NextRequest("http://127.0.0.1:3000/api/spotify/playback/pause", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Spotify remote pause fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ accessToken: "token" });
    mocks.spotifyFetch.mockResolvedValue(undefined);
  });

  it("targets the authenticated Web Playback SDK device", async () => {
    const response = await PUT(request({ deviceId: "browser-device" }));
    expect(response.status).toBe(204);
    expect(mocks.spotifyFetch).toHaveBeenCalledWith(
      "token",
      "/me/player/pause?device_id=browser-device",
      { method: "PUT" },
    );
  });

  it("rejects malformed or unauthenticated pause requests", async () => {
    await expect(PUT(request({ deviceId: "" }))).resolves.toMatchObject({ status: 400 });
    mocks.getSession.mockResolvedValue(null);
    await expect(PUT(request({ deviceId: "browser-device" }))).resolves.toMatchObject({ status: 401 });
    expect(mocks.spotifyFetch).not.toHaveBeenCalled();
  });
});
