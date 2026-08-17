# Needle Drop

Needle Drop is an unlimited Spotify song-guessing game. Each failed guess or skip unlocks a longer intro: 0.1, 1, 2, 5, 10, then 15 seconds. Difficulty is derived only from imported, verified lifetime stream counts; tracks without a count are excluded from ranked play.

## Prerequisites

- Node.js 20.11 or newer and npm
- A Spotify Premium account for Web Playback SDK playback
- A Spotify Developer application with **Web API** and **Web Playback SDK** selected
- A CSV or another verified data source for lifetime stream counts (Spotify does not provide this metric)

## Spotify setup

1. Create an app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Enable Web API and Web Playback SDK access.
3. Add `http://127.0.0.1:3000/api/auth/spotify/callback` as a redirect URI. Spotify requires an exact match; use the same host everywhere.
4. Copy `.env.example` to `.env.local` and add the client ID and secret. The secret is used only by the server-side catalog command; browser login uses Authorization Code with PKCE.
5. Generate a random `SESSION_SECRET` of at least 32 characters.

The user authorization requests these scopes:

- `streaming` for the browser player
- `user-read-private` and `user-read-email`, required by Spotify's Web Playback integration
- `user-read-playback-state` and `user-modify-playback-state` to target the SDK device and start the selected track

Tokens are encrypted in secure, HTTP-only cookies. The client can obtain a short-lived access token only from the authenticated token route because the Web Playback SDK requires it. Refresh tokens and the client secret are never returned to browser JavaScript.

## Environment variables

```env
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/api/auth/spotify/callback
SESSION_SECRET=replace-with-at-least-32-random-characters
DATABASE_URL=file:./dev.db
```

Optional catalog settings are `SPOTIFY_MARKET` (default `US`) and `CATALOG_PAGES_PER_CATEGORY` (default `2`, maximum `10`). Never commit `.env.local`, credentials, or tokens.

## Install and database setup

```bash
npm install
npm run db:push
```

The database command loads `.env.local`, creates the SQLite file when necessary, and applies the Prisma schema. The schema keeps catalog ingestion separate from round and attempt records, and can be migrated to PostgreSQL by changing the datasource and creating a migration.

## Populate the catalog

```bash
npm run catalog:populate
```

The command queries each configured genre and decade sequentially, honors Spotify `Retry-After` responses with a bounded retry, upserts track metadata, and records category associations. It does not invent stream counts, so newly ingested tracks remain unranked until enrichment.

## Import verified stream counts

Prepare a CSV like `data/stream-counts.example.csv`:

```csv
spotify_track_id,isrc,stream_count
4cOdK2wGLETKBW3PvgPWqT,USXXXXXXXXX,1234567890
```

Then run:

```bash
npm run import:streams -- ./data/streams.csv
```

Rows are validated, matched by Spotify track ID first and ISRC second, updated, and reclassified using the central thresholds. The command prints read, matched, updated, missing, and invalid totals and returns a non-zero status when invalid rows are present.

## Run

```bash
npm run dev
```

Open `http://127.0.0.1:3000` so the host matches the configured redirect URI. Connect a Premium account, select a category and difficulty, and play. Current filters, active round ID, session track history, and lightweight player statistics persist locally or in the anonymous server session as appropriate.

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Tests cover difficulty boundaries, ID/ISRC answer matching, ranked/category selection and exclusions, every snippet duration, replay behavior, round transitions, and invalid API input shapes.

## Platform constraints

- Audio is streamed directly by Spotify's Web Playback SDK. The app never downloads, proxies, modifies, or stores audio.
- Spotify Premium is required for playback.
- Spotify does not expose lifetime stream counts in its Web API. A verified external CSV is therefore required before tracks become eligible for difficulty-filtered games.
- The Spotify URI must reach the browser to initiate playback and can be inspected by a determined user. Server-owned answer metadata and attempt validation provide reasonable game integrity, not DRM.
- Spotify platform policy currently restricts commercial streaming applications and synchronization of Spotify content with visual media. Review the current [Web Playback SDK documentation](https://developer.spotify.com/documentation/web-playback-sdk) before deployment.
