import { describe, expect, it, vi } from "vitest";
import { checkSpotifyConnection, SpotifyConnectionCheckError } from "@/lib/client/spotify-connection";

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
