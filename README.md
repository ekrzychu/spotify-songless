# spodle

spodle is an unlimited Spotify song-guessing game. Each failed guess or skip unlocks a longer intro: 0.1, 1, 2, 5, 10, then 15 seconds. Difficulty comes only from imported, verified lifetime stream counts; unranked tracks are never used in ranked play.

## Requirements

- Node.js 20.11 or newer
- npm
- A Spotify Premium account
- A Spotify Developer application
- A verified external source of Spotify lifetime stream counts

The app uses SQLite through Prisma for local development. It does not download, proxy, modify, or store Spotify audio.

## Spotify Dashboard

In the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), configure the application with:

- Web API
- Web Playback SDK
- Redirect URI: `http://127.0.0.1:3000/api/auth/spotify/callback`

Under **User Management**, add every Spotify account that will test the Development Mode application. Spotify Development Mode currently requires Premium and limits authorized users.

The redirect URI must match exactly. Do not replace `127.0.0.1` with `localhost` or a LAN address, and do not derive it from the browser hostname.

## Windows environment setup

From PowerShell in the project directory, create the local environment file:

```powershell
Copy-Item .env.example .env.local
notepad .env.local
```

Configure these values:

```env
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/api/auth/spotify/callback
SESSION_SECRET=
DATABASE_URL=file:./dev.db
ALLOWED_DEV_ORIGINS=127.0.0.1,192.168.0.15
SPOTIFY_MARKET=US
```

`SESSION_SECRET` must be a random value of at least 32 characters. Never commit `.env.local` or share its contents.

`ALLOWED_DEV_ORIGINS` is a comma-separated list of additional hostnames allowed to request Next.js development assets. The defaults already include `127.0.0.1` and `192.168.0.15`; the variable lets another local development hostname be added deliberately. It does not alter Spotify OAuth and has no effect on production CORS.

`SPOTIFY_MARKET` defaults to `US` and is used by catalog discovery unless `--market` overrides it for one run.

Soundcharts credentials are used only by the optional server-side diagnostic. Put them in `.env.local`, never in browser code:

```env
SOUNDCHARTS_CLIENT_ID=
SOUNDCHARTS_CLIENT_SECRET=
SOUNDCHARTS_QUOTA_RESERVE=50
```

## Initial installation

```powershell
npm install
npm run db:push
```

`db:push` loads `.env.local`, creates the SQLite file when necessary, and applies the Prisma schema. Existing `dev.db` data does not need to be deleted; the session-unavailable-track table is an additive schema change.

## Development

```powershell
npm run dev
```

Open exactly:

```text
http://127.0.0.1:3000
```

The OAuth flow uses Authorization Code with PKCE, short-lived integrity-protected authorization attempts, encrypted HTTP-only token storage, and automatic refresh. The browser receives only the short-lived access token required by the Web Playback SDK. The client secret and refresh token remain server-side.

## Populate the Spotify catalog

```powershell
npm run catalog:status
npm run catalog:populate -- --plan
npm run catalog:populate -- --target=20000 --max-requests=500
```

Catalog discovery uses deterministic active-genre-by-release-year shards from 1970 through the current UTC year. It processes the lowest checkpointed offset first, giving every genre/year shard broad coverage before going deeper. Spotify Search requests remain sequential and use pages of at most 10.

Progress is saved after every completed Spotify page at:

```text
.runtime/catalog-populate-checkpoint.json
```

Rerunning the same command resumes from that checkpoint. The default target is 20,000 unique database tracks, but each execution is capped at 500 Spotify Search page requests. Reaching that request budget is a clean resumable stop, not an error.

Available controls are:

```text
--target=20000
--year-from=1970
--year-to=<current UTC year>
--max-per-shard=100
--max-requests=500
--delay-ms=300
--market=US
--plan
--reset-checkpoint
```

`--max-per-shard` can be increased on a later run without resetting progress. Use `--reset-checkpoint` only when intentionally changing checkpoint identity such as the market or year range. Plan mode reads only the local database and checkpoint; it does not request a Spotify access token or call Spotify Search.

`npm run catalog:status` is also local-only. It reports total/playable and ranked/unranked counts plus active genre and decade pool coverage. Historical removed-category relations are not included in active pool reporting.

Catalog population does not spend Soundcharts quota, does not call Soundcharts, does not assign difficulty, and does not invent stream counts. New tracks remain unranked until verified stream counts are imported. A fixed request count cannot guarantee 20,000 tracks because Spotify page exhaustion and duplicate track IDs vary by shard.

Spotify rate limits use importer-specific bounded retries. A `QUOTA_EXCEEDED` response stops cleanly with the last completed-page checkpoint preserved for a later rerun.

Decade membership is derived from each track's Spotify release date during ingestion, so catalog population only performs genre searches. To reconcile decade associations for tracks already in the local database without contacting Spotify, run:

```powershell
npm run catalog:backfill-decades
```

The backfill preserves genre associations, upserts the matching decade relation for release years from 1970 through 2029, removes stale decade relations, and prints the resulting count for every decade.

## Verify Soundcharts access

To test Soundcharts resolution and Spotify audience access against 10 deterministic, unranked catalog tracks, run:

```powershell
npm run soundcharts:test
```

Use a smaller diagnostic batch with `npm run soundcharts:test -- --limit 5`; values above 10 are clamped to 10. The command uses the current client-credentials flow, performs no database writes, and prints its approximate request count. Soundcharts song-level Spotify audience values are cumulative Spotify stream counts.

## Enrich stream counts from Soundcharts

Apply the additive provenance schema once before the first enrichment run:

```powershell
npm run db:push
```

Then enrich a deterministic, category-balanced batch of 100 recording groups:

```powershell
npm run streams:enrich:soundcharts -- --limit 100
```

The default is 100 groups and the maximum is 400 per execution. Tracks with existing stream counts are skipped. Local Spotify versions sharing a normalized ISRC are processed as one recording group, identical Soundcharts stream values across Spotify identifiers are counted once, and successful values use the centralized difficulty classifier. The command stops when the reported quota reaches `SOUNDCHARTS_QUOTA_RESERVE`, which defaults to 50.

An explicit refresh updates missing tracks plus values whose current source is Soundcharts; CSV-owned values remain untouched:

```powershell
npm run streams:enrich:soundcharts -- --limit 100 --refresh
```

Resolved songs without audience data retain a null stream count and difficulty. The Soundcharts UUID is cached so a later attempt can skip identifier resolution.

## Import verified lifetime stream counts

Prepare a CSV at `data\streams.csv` with this header:

```csv
spotify_track_id,isrc,stream_count
```

Run:

```powershell
npm run import:streams -- .\data\streams.csv
```

Rows are matched by Spotify track ID first and normalized ISRC second. The importer rejects malformed identifiers, negative or unsafe counts, duplicate conflicts, and inconsistent values. It reports read, matched, updated, unchanged, missing, invalid, and conflict totals. It never invents missing counts.

## Verification

Run the unit and production checks:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

Install Playwright's browser once, then run the mocked browser suite:

```powershell
npx playwright install chromium
npm run test:browser
```

The browser tests do not automate a real Spotify login. They mock the Spotify-facing application layer and verify hydration, connection states, custom filter accessibility, attempts, result focus, Next Song, and mobile overflow.

## Local data and security

- `.env`, `.env.local`, and `.env.*.local` are ignored by git.
- `dev.db` is ignored by git.
- Spotify tokens are never logged.
- Authentication cookies keep their existing `nd_*` names so current local sessions are not broken by the spodle branding change.
- Existing `needle-drop:filters`, `needle-drop:round`, and `needle-drop:stats` values are copied to their new `spodle:*` names only when the new key is absent. Legacy keys are left untouched.

## Platform constraints

- Spotify Premium is required for Web Playback SDK playback.
- Spotify does not expose lifetime stream counts through the Web API. A verified external dataset is still required before gameplay has eligible tracks.
- Spotify URIs necessarily reach the browser for playback and can be inspected by a determined user. Server-owned round and answer validation provide reasonable game integrity, not DRM.
- Review Spotify's current [Web Playback SDK documentation](https://developer.spotify.com/documentation/web-playback-sdk) and platform policies before deployment.
