export type SpotifyConnectionState = "checking" | "connected" | "disconnected" | "error";

export class SpotifyConnectionCheckError extends Error {
  constructor(public readonly code: "endpoint" | "timeout" | "malformed") {
    super(`Spotify connection check failed: ${code}`);
    this.name = "SpotifyConnectionCheckError";
  }
}

export async function checkSpotifyConnection(
  fetcher: typeof fetch = fetch,
  timeoutMs = 6_000,
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher("/api/auth/status", { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new SpotifyConnectionCheckError("endpoint");
    const payload: unknown = await response.json().catch(() => null);
    if (!payload || typeof payload !== "object" || typeof (payload as { connected?: unknown }).connected !== "boolean") {
      throw new SpotifyConnectionCheckError("malformed");
    }
    return (payload as { connected: boolean }).connected;
  } catch (error) {
    if (error instanceof SpotifyConnectionCheckError) throw error;
    if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw new SpotifyConnectionCheckError("timeout");
    }
    throw new SpotifyConnectionCheckError("endpoint");
  } finally {
    clearTimeout(timeout);
  }
}

export function oauthNotice(auth: string | null, connected: boolean): { text: string; success: boolean } | null {
  if (!auth) return null;
  if (connected) {
    if (auth === "connected") return { text: "Spotify connected.", success: true };
    if (auth === "stale" || auth === "failed") return { text: "Spotify is already connected.", success: true };
    return null;
  }
  if (auth === "denied") return { text: "Spotify connection was cancelled.", success: false };
  if (auth === "config") return { text: "Spotify is not configured for this environment.", success: false };
  if (auth === "failed" || auth === "stale") return { text: "Spotify connection failed. Try again.", success: false };
  return null;
}
