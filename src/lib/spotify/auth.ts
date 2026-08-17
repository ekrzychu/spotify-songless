import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { baseCookie } from "@/lib/server/cookies";
import { seal, unseal } from "@/lib/server/sealed-cookie";

export const SPOTIFY_SCOPES = [
  "streaming",
  "user-read-private",
  "user-read-email",
  "user-read-playback-state",
  "user-modify-playback-state",
].join(" ");

export type SpotifyTokenSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

type OAuthState = { state: string; verifier: string };

function required(name: "SPOTIFY_CLIENT_ID" | "SPOTIFY_REDIRECT_URI"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export async function createAuthorizationUrl(): Promise<string> {
  const verifier = randomBytes(64).toString("base64url");
  const state = randomBytes(24).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const store = await cookies();
  store.set("nd_oauth", seal({ state, verifier } satisfies OAuthState), { ...baseCookie, maxAge: 600 });
  const query = new URLSearchParams({
    client_id: required("SPOTIFY_CLIENT_ID"), response_type: "code",
    redirect_uri: required("SPOTIFY_REDIRECT_URI"), scope: SPOTIFY_SCOPES,
    state, code_challenge_method: "S256", code_challenge: challenge,
  });
  return `https://accounts.spotify.com/authorize?${query}`;
}

async function tokenRequest(body: URLSearchParams): Promise<SpotifyTokenSession> {
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Spotify token exchange failed (${response.status})`);
  const data = (await response.json()) as {
    access_token: string; refresh_token?: string; expires_in: number;
  };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? body.get("refresh_token") ?? "",
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

export async function completeAuthorization(code: string, returnedState: string): Promise<void> {
  const store = await cookies();
  const stateCookie = store.get("nd_oauth")?.value;
  const oauth = stateCookie ? unseal<OAuthState>(stateCookie) : null;
  store.delete("nd_oauth");
  if (!oauth || oauth.state !== returnedState) throw new Error("Spotify authorization state did not match");
  const token = await tokenRequest(new URLSearchParams({
    client_id: required("SPOTIFY_CLIENT_ID"), grant_type: "authorization_code", code,
    redirect_uri: required("SPOTIFY_REDIRECT_URI"), code_verifier: oauth.verifier,
  }));
  store.set("nd_spotify", seal(token), { ...baseCookie, maxAge: 60 * 60 * 24 * 30 });
}

export async function getSpotifySession(): Promise<SpotifyTokenSession | null> {
  const store = await cookies();
  const raw = store.get("nd_spotify")?.value;
  const session = raw ? unseal<SpotifyTokenSession>(raw) : null;
  if (!session) return null;
  if (session.expiresAt > Date.now() + 60_000) return session;
  try {
    const refreshed = await tokenRequest(new URLSearchParams({
      client_id: required("SPOTIFY_CLIENT_ID"), grant_type: "refresh_token",
      refresh_token: session.refreshToken,
    }));
    store.set("nd_spotify", seal(refreshed), { ...baseCookie, maxAge: 60 * 60 * 24 * 30 });
    return refreshed;
  } catch {
    store.delete("nd_spotify");
    return null;
  }
}

export async function clearSpotifySession(): Promise<void> {
  (await cookies()).delete("nd_spotify");
}
