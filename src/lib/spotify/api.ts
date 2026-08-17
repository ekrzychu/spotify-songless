export class SpotifyApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "SpotifyApiError";
  }
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function spotifyFetch<T>(
  accessToken: string,
  path: string,
  init: RequestInit = {},
  retried = false,
): Promise<T> {
  const response = await fetch(path.startsWith("http") ? path : `https://api.spotify.com/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...init.headers },
    cache: "no-store",
  });
  if (response.status === 429 && !retried) {
    const retrySeconds = Math.min(Number(response.headers.get("retry-after") ?? 1), 10);
    await wait(retrySeconds * 1000);
    return spotifyFetch<T>(accessToken, path, init, true);
  }
  if (!response.ok) throw new SpotifyApiError(response.status, `Spotify request failed (${response.status})`);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
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
