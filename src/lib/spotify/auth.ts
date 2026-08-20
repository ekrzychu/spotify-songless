import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { baseCookie } from "@/lib/server/cookies";
import { seal, unseal } from "@/lib/server/sealed-cookie";
import {
  consumeOAuthAttempt,
  parseOAuthAttemptStore,
  type OAuthAttempt,
  type OAuthAttemptStore,
} from "@/lib/spotify/oauth-state";

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

export class OAuthStateError extends Error {
  constructor(public readonly reason: "mismatch" | "expired") {
    super(`Spotify authorization state ${reason}`);
    this.name = "OAuthStateError";
  }
}

const OAUTH_COOKIE_PREFIX = "nd_oauth_";

export function oauthAttemptCookieName(state: string): string | null {
  return /^[A-Za-z0-9_-]{20,128}$/.test(state) ? `${OAUTH_COOKIE_PREFIX}${state}` : null;
}

export function spotifyAuthorizationParameters(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}): URLSearchParams {
  return new URLSearchParams({
    client_id: input.clientId,
    response_type: "code",
    redirect_uri: input.redirectUri,
    scope: SPOTIFY_SCOPES,
    state: input.state,
    code_challenge_method: "S256",
    code_challenge: input.challenge,
    show_dialog: "true",
  });
}

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
  pruneOAuthCookies(store.getAll().filter((cookie) => cookie.name.startsWith(OAUTH_COOKIE_PREFIX)), store);
  const cookieName = oauthAttemptCookieName(state);
  if (!cookieName) throw new Error("Generated OAuth state was invalid");
  store.set(cookieName, seal({ state, verifier, expiresAt: Date.now() + 10 * 60_000 } satisfies OAuthAttempt), {
    ...baseCookie, maxAge: 600,
  });
  const query = spotifyAuthorizationParameters({
    clientId: required("SPOTIFY_CLIENT_ID"),
    redirectUri: required("SPOTIFY_REDIRECT_URI"),
    state,
    challenge,
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
  const cookieName = oauthAttemptCookieName(returnedState);
  const stateCookie = cookieName ? store.get(cookieName)?.value : null;
  if (cookieName) store.delete(cookieName);
  let attempt = stateCookie ? validOAuthAttempt(unseal<OAuthAttempt>(stateCookie), returnedState) : null;

  // A flow started before the per-attempt-cookie upgrade can still finish once.
  if (!attempt) {
    const legacyCookie = store.get("nd_oauth")?.value;
    const attempts = parseOAuthAttemptStore(legacyCookie ? unseal<OAuthAttemptStore>(legacyCookie) : null);
    const consumed = consumeOAuthAttempt(attempts, returnedState);
    if (consumed.remaining.attempts.length) {
      store.set("nd_oauth", seal(consumed.remaining), { ...baseCookie, maxAge: 600 });
    } else if (legacyCookie) store.delete("nd_oauth");
    attempt = consumed.attempt;
    if (!attempt) throw new OAuthStateError(consumed.reason ?? "mismatch");
  }
  if (attempt.expiresAt <= Date.now()) throw new OAuthStateError("expired");
  const token = await tokenRequest(new URLSearchParams({
    client_id: required("SPOTIFY_CLIENT_ID"), grant_type: "authorization_code", code,
    redirect_uri: required("SPOTIFY_REDIRECT_URI"), code_verifier: attempt.verifier,
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
  const store = await cookies();
  store.delete("nd_spotify");
  store.delete("nd_oauth");
  for (const cookie of store.getAll()) {
    if (cookie.name.startsWith(OAUTH_COOKIE_PREFIX)) store.delete(cookie.name);
  }
}

function validOAuthAttempt(value: OAuthAttempt | null, state: string): OAuthAttempt | null {
  return value
    && value.state === state
    && typeof value.verifier === "string"
    && typeof value.expiresAt === "number"
    ? value
    : null;
}

function pruneOAuthCookies(
  cookiesToCheck: { name: string; value: string }[],
  store: Awaited<ReturnType<typeof cookies>>,
): void {
  const now = Date.now();
  const valid = cookiesToCheck.map((cookie) => ({ cookie, attempt: unseal<OAuthAttempt>(cookie.value) }))
    .filter((item) => item.attempt && item.attempt.expiresAt > now)
    .sort((left, right) => left.attempt!.expiresAt - right.attempt!.expiresAt);
  for (const item of cookiesToCheck) {
    if (!valid.some((entry) => entry.cookie.name === item.name)) store.delete(item.name);
  }
  for (const item of valid.slice(0, Math.max(0, valid.length - 4))) store.delete(item.cookie.name);
}
