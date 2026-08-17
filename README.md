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
CATALOG_RESULTS_PER_CATEGORY=100
SPOTIFY_MARKET=US
```

`SESSION_SECRET` must be a random value of at least 32 characters. Never commit `.env.local` or share its contents.

`ALLOWED_DEV_ORIGINS` is a comma-separated list of additional hostnames allowed to request Next.js development assets. The defaults already include `127.0.0.1` and `192.168.0.15`; the variable lets another local development hostname be added deliberately. It does not alter Spotify OAuth and has no effect on production CORS.

`CATALOG_RESULTS_PER_CATEGORY` defaults to 100 and is capped at 500. Spotify Development Mode Search returns at most 10 results per request, so the default performs at most 10 sequential requests for each configured genre or decade. `SPOTIFY_MARKET` defaults to `US`.

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
npm run catalog:populate
```

The command reads the centralized genre/decade configuration, searches Spotify sequentially in pages of at most 10, follows pagination until the configured result target or the end of results, applies bounded `Retry-After` handling, deduplicates tracks, upserts metadata, and preserves every category association. It prints request, discovered, created, updated, and unique-track totals.

Catalog population does not assign difficulty. New tracks remain unranked until verified stream counts are imported.

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
