const SOUNDCHARTS_TOKEN_URL = "https://account.soundcharts.com/oauth/token";
const SOUNDCHARTS_API_URL = "https://customer.api.soundcharts.com";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type SoundchartsErrorCode =
  | "configuration"
  | "authentication_failed"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "request_budget"
  | "quota_reserve"
  | "api_error"
  | "malformed_response"
  | "network_error";

export class SoundchartsApiError extends Error {
  constructor(
    public readonly code: SoundchartsErrorCode,
    public readonly status: number | null,
    public readonly apiMessage: string | null = null,
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

export type SoundchartsSongGenre = {
  root: string;
  sub: string[];
};

export type SoundchartsSongResolution = {
  uuid: string;
  releaseDate: string | null;
  genres: SoundchartsSongGenre[] | null;
};

export type SoundchartsClientOptions = {
  fetch?: FetchLike;
  sleep?: (milliseconds: number) => Promise<void>;
  maxRateLimitRetries?: number;
  maxRetryAfterSeconds?: number;
  maxCustomerApiRequests?: number;
  quotaReserve?: number;
  debug?: boolean;
  credentials?: { clientId: string; clientSecret: string };
};

export type SoundchartsRequestTelemetry = {
  totalHttpRequests: number;
  tokenRequests: number;
  customerApiRequests: number;
  retryRequests: number;
  quotaHeaderObservations: number;
  firstQuotaRemaining: number | null;
  lastQuotaRemaining: number | null;
  minimumQuotaRemaining: number | null;
  observedQuotaDelta: number | null;
};

function messageForError(code: SoundchartsErrorCode, status: number | null): string {
  switch (code) {
    case "configuration": return "Soundcharts credentials are not configured";
    case "authentication_failed": return "Soundcharts authentication failed";
    case "forbidden": return "Endpoint not included in the current Soundcharts plan";
    case "not_found": return "Song not found in Soundcharts";
    case "rate_limited": return "Soundcharts quota or rate limit reached";
    case "request_budget": return "Soundcharts customer API request budget reached";
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

export function parseSoundchartsSongResponse(payload: unknown): SoundchartsSongResolution {
  const song = asRecord(asRecord(payload)?.object);
  const uuid = typeof song?.uuid === "string" ? song.uuid.trim() : "";
  if (uuid.length === 0) {
    throw new SoundchartsApiError("malformed_response", 200);
  }

  const rawReleaseDate = song?.releaseDate;
  const releaseDate = typeof rawReleaseDate === "string"
    && rawReleaseDate.trim().length > 0
    && rawReleaseDate.length <= 100
    && Number.isFinite(Date.parse(rawReleaseDate))
    ? rawReleaseDate.trim()
    : null;
  const rawGenres = song?.genres;
  const genres = Array.isArray(rawGenres)
    ? rawGenres.flatMap((rawGenre): SoundchartsSongGenre[] => {
      const genre = asRecord(rawGenre);
      const root = typeof genre?.root === "string" ? genre.root.trim() : "";
      if (root.length === 0 || root.length > 100) return [];
      const sub = Array.isArray(genre?.sub)
        ? [...new Set(genre.sub.flatMap((value) => (
          typeof value === "string" && value.trim().length > 0 && value.trim().length <= 100
            ? [value.trim()]
            : []
        )))]
        : [];
      return [{ root, sub }];
    })
    : null;

  return { uuid, releaseDate, genres };
}

export function parseSongUuidResponse(payload: unknown): string {
  return parseSoundchartsSongResponse(payload).uuid;
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

function statusToError(status: number, apiMessage: string | null): SoundchartsApiError {
  if (status === 401) return new SoundchartsApiError("authentication_failed", status, apiMessage);
  if (status === 403) return new SoundchartsApiError("forbidden", status, apiMessage);
  if (status === 404) return new SoundchartsApiError("not_found", status, apiMessage);
  if (status === 429) return new SoundchartsApiError("rate_limited", status, apiMessage);
  return new SoundchartsApiError("api_error", status, apiMessage);
}

async function defaultSleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class SoundchartsClient {
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly maxRateLimitRetries: number;
  private readonly maxRetryAfterSeconds: number;
  private readonly maxCustomerApiRequests: number;
  private readonly quotaReserve: number | null;
  private readonly debug: boolean;
  private readonly credentials?: { clientId: string; clientSecret: string };
  private accessTokenPromise: Promise<string> | null = null;
  private readonly telemetryValue: Omit<SoundchartsRequestTelemetry, "observedQuotaDelta"> = {
    totalHttpRequests: 0,
    tokenRequests: 0,
    customerApiRequests: 0,
    retryRequests: 0,
    quotaHeaderObservations: 0,
    firstQuotaRemaining: null,
    lastQuotaRemaining: null,
    minimumQuotaRemaining: null,
  };

  constructor(options: SoundchartsClientOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.maxRateLimitRetries = options.maxRateLimitRetries ?? 1;
    this.maxRetryAfterSeconds = options.maxRetryAfterSeconds ?? 5;
    this.maxCustomerApiRequests = options.maxCustomerApiRequests ?? Number.POSITIVE_INFINITY;
    this.quotaReserve = options.quotaReserve ?? null;
    this.debug = options.debug ?? process.env.SOUNDCHARTS_DEBUG === "true";
    this.credentials = options.credentials;
  }

  get telemetry(): SoundchartsRequestTelemetry {
    const first = this.telemetryValue.firstQuotaRemaining;
    const last = this.telemetryValue.lastQuotaRemaining;
    return {
      ...this.telemetryValue,
      observedQuotaDelta: this.telemetryValue.quotaHeaderObservations >= 2 && first !== null && last !== null
        ? Math.max(first - last, 0)
        : null,
    };
  }

  get quotaRemaining(): number | null {
    return this.telemetryValue.lastQuotaRemaining;
  }

  getAccessToken(): Promise<string> {
    this.accessTokenPromise ??= this.requestAccessToken();
    return this.accessTokenPromise;
  }

  async getSongBySpotifyId(spotifyTrackId: string): Promise<SoundchartsSongResolution> {
    const payload = await this.authorizedRequest(
      `/api/v2.25/song/by-platform/spotify/${encodeURIComponent(spotifyTrackId)}`,
      "song/by-platform/spotify/:id",
    );
    return parseSoundchartsSongResponse(payload);
  }

  async getSongByIsrc(isrc: string): Promise<SoundchartsSongResolution> {
    const payload = await this.authorizedRequest(
      `/api/v2.25/song/by-isrc/${encodeURIComponent(isrc)}`,
      "song/by-isrc/:isrc",
    );
    return parseSoundchartsSongResponse(payload);
  }

  async getLatestSpotifyAudience(
    soundchartsSongUuid: string,
    spotifyTrackId: string,
  ): Promise<SpotifyAudiencePoint | null> {
    const query = new URLSearchParams({ sort: "desc", limit: "1", identifier: spotifyTrackId });
    const payload = await this.authorizedRequest(
      `/api/v2/song/${encodeURIComponent(soundchartsSongUuid)}/audience/spotify?${query}`,
      "song/:uuid/audience/spotify",
    );
    return parseLatestSpotifyAudience(payload, spotifyTrackId);
  }

  async getLatestSpotifyAudienceSnapshot(
    soundchartsSongUuid: string,
  ): Promise<SpotifyAudienceSnapshot | null> {
    const query = new URLSearchParams({ sort: "desc", limit: "1" });
    const payload = await this.authorizedRequest(
      `/api/v2/song/${encodeURIComponent(soundchartsSongUuid)}/audience/spotify?${query}`,
      "song/:uuid/audience/spotify",
    );
    return parseLatestSpotifyAudienceSnapshot(payload);
  }

  /** Legacy optional quota probe. Enrichment does not call this automatically. */
  async refreshQuotaRemaining(): Promise<number | null> {
    await this.authorizedRequest("/api/v2/team/usage", "team/usage");
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
    }, "token", "oauth/token");
    return parseAccessTokenResponse(payload);
  }

  private async authorizedRequest(path: string, endpointFamily: string): Promise<unknown> {
    this.assertCustomerRequestAllowed();
    const accessToken = await this.getAccessToken();
    return this.requestJson(`${SOUNDCHARTS_API_URL}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }, "customer", endpointFamily);
  }

  private async requestJson(
    url: string,
    init: RequestInit,
    kind: "token" | "customer",
    endpointFamily: string,
    attempt = 0,
  ): Promise<unknown> {
    if (kind === "customer") this.assertCustomerRequestAllowed();
    let response: Response;
    this.telemetryValue.totalHttpRequests += 1;
    if (kind === "token") this.telemetryValue.tokenRequests += 1;
    else {
      this.telemetryValue.customerApiRequests += 1;
      if (attempt > 0) this.telemetryValue.retryRequests += 1;
    }
    try {
      response = await this.fetchImpl(url, init);
    } catch {
      throw new SoundchartsApiError("network_error", null);
    }

    if (kind === "customer") {
      this.observeQuotaHeader(response.headers.get("x-quota-remaining"));
    }
    this.debugResponse(endpointFamily, response.status, attempt);

    if (response.status === 429 && attempt < this.maxRateLimitRetries) {
      if (kind === "customer") this.assertCustomerRequestAllowed();
      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfter = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
      const seconds = Math.min(
        Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : 1,
        this.maxRetryAfterSeconds,
      );
      await this.sleep(seconds * 1000);
      return this.requestJson(url, init, kind, endpointFamily, attempt + 1);
    }
    if (!response.ok) throw statusToError(response.status, await readSanitizedErrorMessage(response));

    try {
      return await response.json() as unknown;
    } catch {
      throw new SoundchartsApiError("malformed_response", response.status);
    }
  }

  private assertCustomerRequestAllowed(): void {
    if (
      this.quotaReserve !== null
      && this.quotaRemaining !== null
      && this.quotaRemaining <= this.quotaReserve
    ) {
      throw new SoundchartsApiError("quota_reserve", null);
    }
    if (this.telemetryValue.customerApiRequests >= this.maxCustomerApiRequests) {
      throw new SoundchartsApiError("request_budget", null);
    }
  }

  private observeQuotaHeader(raw: string | null): void {
    if (raw === null || !/^\d+$/.test(raw.trim())) return;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 0) return;
    this.telemetryValue.quotaHeaderObservations += 1;
    this.telemetryValue.firstQuotaRemaining ??= value;
    this.telemetryValue.lastQuotaRemaining = value;
    this.telemetryValue.minimumQuotaRemaining = this.telemetryValue.minimumQuotaRemaining === null
      ? value
      : Math.min(this.telemetryValue.minimumQuotaRemaining, value);
  }

  private debugResponse(endpointFamily: string, status: number, attempt: number): void {
    if (!this.debug) return;
    console.error([
      "[soundcharts]",
      `endpoint=${endpointFamily}`,
      `status=${status}`,
      `quotaRemaining=${this.quotaRemaining ?? "unknown"}`,
      `attempt=${attempt + 1}`,
    ].join(" "));
  }
}

async function readSanitizedErrorMessage(response: Response): Promise<string | null> {
  const payload: unknown = await response.json().catch(() => null);
  const value = asRecord(payload);
  const nested = asRecord(value?.error);
  const candidate = nested?.message ?? value?.message ?? value?.detail;
  return typeof candidate === "string" && candidate.trim().length > 0
    ? candidate.trim().slice(0, 200)
    : null;
}

export function formatSoundchartsRequestTelemetry(telemetry: SoundchartsRequestTelemetry): string {
  return [
    "SOUNDCHARTS REQUEST TELEMETRY",
    "",
    `HTTP requests total: ${telemetry.totalHttpRequests}`,
    `OAuth token requests: ${telemetry.tokenRequests}`,
    `Customer API requests: ${telemetry.customerApiRequests}`,
    `Retry requests: ${telemetry.retryRequests}`,
    "",
    `Quota headers observed: ${telemetry.quotaHeaderObservations}`,
    `Quota remaining at first observation: ${telemetry.firstQuotaRemaining ?? "unknown"}`,
    `Quota remaining at last observation: ${telemetry.lastQuotaRemaining ?? "unknown"}`,
    `Minimum quota remaining observed: ${telemetry.minimumQuotaRemaining ?? "unknown"}`,
    `Observed quota decrease: ${telemetry.observedQuotaDelta ?? "unknown"}`,
    "",
    "IMPORTANT: HTTP request count is not assumed to equal charged quota.",
  ].join("\n");
}
