const SOUNDCHARTS_TOKEN_URL = "https://account.soundcharts.com/oauth/token";
const SOUNDCHARTS_API_URL = "https://customer.api.soundcharts.com";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type SoundchartsErrorCode =
  | "configuration"
  | "authentication_failed"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "quota_reserve"
  | "api_error"
  | "malformed_response"
  | "network_error";

export class SoundchartsApiError extends Error {
  constructor(
    public readonly code: SoundchartsErrorCode,
    public readonly status: number | null,
  ) {
    super(messageForError(code, status));
    this.name = "SoundchartsApiError";
  }
}

export type SpotifyAudiencePoint = {
  date: string;
  streams: number;
};

export type SpotifyAudienceSnapshot = {
  date: string;
  plots: unknown[];
};

export type SoundchartsClientOptions = {
  fetch?: FetchLike;
  sleep?: (milliseconds: number) => Promise<void>;
  maxRateLimitRetries?: number;
  maxRetryAfterSeconds?: number;
  credentials?: { clientId: string; clientSecret: string };
};

function messageForError(code: SoundchartsErrorCode, status: number | null): string {
  switch (code) {
    case "configuration": return "Soundcharts credentials are not configured";
    case "authentication_failed": return "Soundcharts authentication failed";
    case "forbidden": return "Endpoint not included in the current Soundcharts plan";
    case "not_found": return "Song not found in Soundcharts";
    case "rate_limited": return "Soundcharts quota or rate limit reached";
    case "quota_reserve": return "Soundcharts quota safety reserve reached";
    case "malformed_response": return "Soundcharts returned a malformed response";
    case "network_error": return "Soundcharts request could not be completed";
    default: return `Soundcharts request failed${status === null ? "" : ` (${status})`}`;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parseAccessTokenResponse(payload: unknown): string {
  const accessToken = asRecord(payload)?.access_token;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new SoundchartsApiError("malformed_response", 200);
  }
  return accessToken;
}

export function parseSongUuidResponse(payload: unknown): string {
  const uuid = asRecord(asRecord(payload)?.object)?.uuid;
  if (typeof uuid !== "string" || uuid.length === 0) {
    throw new SoundchartsApiError("malformed_response", 200);
  }
  return uuid;
}

export function parseLatestSpotifyAudience(
  payload: unknown,
  spotifyTrackId: string,
): SpotifyAudiencePoint | null {
  const items = asRecord(payload)?.items;
  if (!Array.isArray(items)) throw new SoundchartsApiError("malformed_response", 200);
  if (items.length === 0) return null;

  const points: Array<SpotifyAudiencePoint & { timestamp: number }> = [];
  for (const rawItem of items) {
    const item = asRecord(rawItem);
    const date = item?.date;
    const plots = item?.plots;
    if (typeof date !== "string" || !Number.isFinite(Date.parse(date)) || !Array.isArray(plots)) {
      throw new SoundchartsApiError("malformed_response", 200);
    }
    const matchingPlot = plots
      .map(asRecord)
      .find((plot) => plot?.identifier === spotifyTrackId);
    if (!matchingPlot) continue;
    const value = matchingPlot.value;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
      throw new SoundchartsApiError("malformed_response", 200);
    }
    points.push({ date, streams: value, timestamp: Date.parse(date) });
  }

  const latest = points.sort((left, right) => right.timestamp - left.timestamp)[0];
  return latest ? { date: latest.date, streams: latest.streams } : null;
}

export function parseLatestSpotifyAudienceSnapshot(payload: unknown): SpotifyAudienceSnapshot | null {
  const items = asRecord(payload)?.items;
  if (!Array.isArray(items)) throw new SoundchartsApiError("malformed_response", 200);
  if (items.length === 0) return null;

  const snapshots = items.map((rawItem) => {
    const item = asRecord(rawItem);
    const date = item?.date;
    const plots = item?.plots;
    const timestamp = typeof date === "string" ? Date.parse(date) : Number.NaN;
    if (typeof date !== "string" || !Number.isFinite(timestamp) || !Array.isArray(plots)) {
      throw new SoundchartsApiError("malformed_response", 200);
    }
    return { date, plots, timestamp };
  });
  const latest = snapshots.sort((left, right) => right.timestamp - left.timestamp)[0];
  return latest ? { date: latest.date, plots: latest.plots } : null;
}

function statusToError(status: number): SoundchartsApiError {
  if (status === 401) return new SoundchartsApiError("authentication_failed", status);
  if (status === 403) return new SoundchartsApiError("forbidden", status);
  if (status === 404) return new SoundchartsApiError("not_found", status);
  if (status === 429) return new SoundchartsApiError("rate_limited", status);
  return new SoundchartsApiError("api_error", status);
}

async function defaultSleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class SoundchartsClient {
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly maxRateLimitRetries: number;
  private readonly maxRetryAfterSeconds: number;
  private readonly credentials?: { clientId: string; clientSecret: string };
  private accessTokenPromise: Promise<string> | null = null;
  private requests = 0;
  private quotaRemainingValue: number | null = null;

  constructor(options: SoundchartsClientOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.maxRateLimitRetries = options.maxRateLimitRetries ?? 1;
    this.maxRetryAfterSeconds = options.maxRetryAfterSeconds ?? 5;
    this.credentials = options.credentials;
  }

  get requestCount(): number {
    return this.requests;
  }

  get quotaRemaining(): number | null {
    return this.quotaRemainingValue;
  }

  getAccessToken(): Promise<string> {
    this.accessTokenPromise ??= this.requestAccessToken();
    return this.accessTokenPromise;
  }

  async getSongBySpotifyId(spotifyTrackId: string): Promise<string> {
    const payload = await this.authorizedRequest(
      `/api/v2.25/song/by-platform/spotify/${encodeURIComponent(spotifyTrackId)}`,
    );
    return parseSongUuidResponse(payload);
  }

  async getSongByIsrc(isrc: string): Promise<string> {
    const payload = await this.authorizedRequest(`/api/v2.25/song/by-isrc/${encodeURIComponent(isrc)}`);
    return parseSongUuidResponse(payload);
  }

  async getLatestSpotifyAudience(
    soundchartsSongUuid: string,
    spotifyTrackId: string,
  ): Promise<SpotifyAudiencePoint | null> {
    const query = new URLSearchParams({ sort: "desc", limit: "1", identifier: spotifyTrackId });
    const payload = await this.authorizedRequest(
      `/api/v2/song/${encodeURIComponent(soundchartsSongUuid)}/audience/spotify?${query}`,
    );
    return parseLatestSpotifyAudience(payload, spotifyTrackId);
  }

  async getLatestSpotifyAudienceSnapshot(
    soundchartsSongUuid: string,
  ): Promise<SpotifyAudienceSnapshot | null> {
    const query = new URLSearchParams({ sort: "desc", limit: "1" });
    const payload = await this.authorizedRequest(
      `/api/v2/song/${encodeURIComponent(soundchartsSongUuid)}/audience/spotify?${query}`,
    );
    return parseLatestSpotifyAudienceSnapshot(payload);
  }

  async refreshQuotaRemaining(): Promise<number | null> {
    await this.authorizedRequest("/api/v2/team/usage");
    return this.quotaRemaining;
  }

  private async requestAccessToken(): Promise<string> {
    const clientId = this.credentials?.clientId ?? process.env.SOUNDCHARTS_CLIENT_ID;
    const clientSecret = this.credentials?.clientSecret ?? process.env.SOUNDCHARTS_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new SoundchartsApiError("configuration", null);

    const payload = await this.requestJson(SOUNDCHARTS_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "client_credentials" }),
    });
    return parseAccessTokenResponse(payload);
  }

  private async authorizedRequest(path: string): Promise<unknown> {
    const accessToken = await this.getAccessToken();
    return this.requestJson(`${SOUNDCHARTS_API_URL}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }

  private async requestJson(url: string, init: RequestInit, attempt = 0): Promise<unknown> {
    let response: Response;
    this.requests += 1;
    try {
      response = await this.fetchImpl(url, init);
    } catch {
      throw new SoundchartsApiError("network_error", null);
    }

    const quotaHeader = response.headers.get("x-quota-remaining");
    const quotaRemaining = quotaHeader === null ? Number.NaN : Number(quotaHeader);
    if (Number.isSafeInteger(quotaRemaining) && quotaRemaining >= 0) {
      this.quotaRemainingValue = quotaRemaining;
    }

    if (response.status === 429 && attempt < this.maxRateLimitRetries) {
      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfter = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
      const seconds = Math.min(
        Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : 1,
        this.maxRetryAfterSeconds,
      );
      await this.sleep(seconds * 1000);
      return this.requestJson(url, init, attempt + 1);
    }
    if (!response.ok) throw statusToError(response.status);

    try {
      return await response.json() as unknown;
    } catch {
      throw new SoundchartsApiError("malformed_response", response.status);
    }
  }
}
