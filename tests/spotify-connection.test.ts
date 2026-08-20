import { describe, expect, it, vi } from "vitest";
import {
  checkSpotifyConnection,
  disconnectSpotify,
  SpotifyConnectionCheckError,
} from "@/lib/client/spotify-connection";

const response = (body: unknown, ok = true) => ({ ok, json: vi.fn().mockResolvedValue(body) }) as unknown as Response;

describe("Spotify connection status", () => {
  it("returns connected", async () => {
    await expect(checkSpotifyConnection(vi.fn().mockResolvedValue(response({ connected: true })))).resolves.toBe(true);
  });

  it("returns not connected", async () => {
    await expect(checkSpotifyConnection(vi.fn().mockResolvedValue(response({ connected: false })))).resolves.toBe(false);
  });

  it("reports endpoint failure", async () => {
    await expect(checkSpotifyConnection(vi.fn().mockResolvedValue(response({}, false))))
      .rejects.toMatchObject({ code: "endpoint" } satisfies Partial<SpotifyConnectionCheckError>);
  });

  it("reports malformed responses", async () => {
    await expect(checkSpotifyConnection(vi.fn().mockResolvedValue(response({ connected: "yes" }))))
      .rejects.toMatchObject({ code: "malformed" } satisfies Partial<SpotifyConnectionCheckError>);
  });

  it("times out", async () => {
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })) as typeof fetch;
    await expect(checkSpotifyConnection(fetcher, 5)).rejects.toMatchObject({ code: "timeout" });
  });
});

describe("Spotify logout", () => {
  it("stops playback before deleting the server session", async () => {
    const calls: string[] = [];
    const reset = vi.fn(async () => { calls.push("reset"); return true; });
    const fetcher = vi.fn(async () => {
      calls.push("logout");
      return response({ ok: true });
    }) as typeof fetch;
    await disconnectSpotify(reset, fetcher);
    expect(calls).toEqual(["reset", "logout"]);
    expect(fetcher).toHaveBeenCalledWith("/api/auth/logout", { method: "POST" });
  });

  it("does not delete the session when playback cannot be stopped", async () => {
    const fetcher = vi.fn() as typeof fetch;
    await expect(disconnectSpotify(async () => false, fetcher)).rejects.toThrow("could not be stopped");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
