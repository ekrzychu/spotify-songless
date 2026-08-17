export class SpotifyApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly spotifyMessage: string | null,
    public readonly reason: string | null,
    public readonly retryAfterSeconds: number | null,
  ) {
    super(`Spotify request failed (${status})`);
    this.name = "SpotifyApiError";
  }
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export type SpotifyRetryOptions = {
  maxRetries?: number;
  maxRetryAfterSeconds?: number;
  sleep?: (milliseconds: number) => Promise<void>;
};

export async function spotifyFetch<T>(
  accessToken: string,
  path: string,
  init: RequestInit = {},
  retryOptions: SpotifyRetryOptions = {},
  attempt = 0,
): Promise<T> {
  const response = await fetch(path.startsWith("http") ? path : `https://api.spotify.com/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...init.headers },
    cache: "no-store",
  });
  const errorDetails = response.ok ? null : await readSpotifyError(response);
  const maxRetries = retryOptions.maxRetries ?? 1;
  if (response.status === 429 && attempt < maxRetries && errorDetails?.reason !== "QUOTA_EXCEEDED") {
    const retrySeconds = Math.min(
      errorDetails?.retryAfterSeconds ?? 1,
      retryOptions.maxRetryAfterSeconds ?? 10,
    );
    if (process.env.NODE_ENV === "development") {
      console.warn(`Spotify rate limited: retrying after ${retrySeconds}s`);
    }
    await (retryOptions.sleep ?? wait)(retrySeconds * 1000);
    return spotifyFetch<T>(accessToken, path, init, retryOptions, attempt + 1);
  }
  if (!response.ok) {
    throw new SpotifyApiError(
      response.status,
      errorDetails?.message ?? null,
      errorDetails?.reason ?? null,
      errorDetails?.retryAfterSeconds ?? null,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function readSpotifyError(response: Response): Promise<{
  message: string | null; reason: string | null; retryAfterSeconds: number | null;
}> {
  const payload: unknown = await response.json().catch(() => null);
  const nested = payload && typeof payload === "object" ? (payload as { error?: unknown }).error : null;
  const nestedObject = nested && typeof nested === "object" ? nested as { message?: unknown; reason?: unknown } : null;
  const topLevel = payload && typeof payload === "object" ? payload as { message?: unknown; reason?: unknown } : null;
  const message = typeof nestedObject?.message === "string"
    ? nestedObject.message
    : typeof nested === "string"
      ? nested
      : typeof topLevel?.message === "string" ? topLevel.message : null;
  const reason = typeof nestedObject?.reason === "string"
    ? nestedObject.reason
    : typeof topLevel?.reason === "string" ? topLevel.reason : null;
  const retryValue = response.headers.get("retry-after");
  const retryHeader = retryValue === null ? Number.NaN : Number(retryValue);
  return {
    message: message?.slice(0, 300) ?? null,
    reason: reason?.slice(0, 100).toUpperCase() ?? null,
    retryAfterSeconds: Number.isFinite(retryHeader) && retryHeader >= 0 ? retryHeader : null,
  };
}

export type SpotifyTrack = {
  id: string;
  uri: string;
  name: string;
  is_playable?: boolean;
  external_ids?: { isrc?: string };
  external_urls: { spotify: string };
  artists: { id: string; name: string }[];
  album: { name: string; release_date?: string };
};

export type SpotifySearchResponse = {
  tracks: { items: SpotifyTrack[]; next: string | null; total: number };
};

export async function getClientCredentialsToken(): Promise<string> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !secret) throw new Error("SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are required");
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  if (!response.ok) throw new Error(`Spotify client credentials failed (${response.status})`);
  return ((await response.json()) as { access_token: string }).access_token;
}
