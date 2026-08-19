# spodle

spodle is an unlimited Spotify song-guessing game built with Next.js, React, Prisma, and SQLite. Players identify songs from progressively longer intros, with ranked difficulties based on verified lifetime Spotify stream counts and an Unranked mode for catalog tracks that have not yet been enriched.

## Features

- Spotify Web Playback SDK playback
- Six intro stages: `0.1s`, `1s`, `2s`, `5s`, `10s`, `15s`
- Local song autocomplete during gameplay
- Categories by genre and decade
- Ranked difficulties based on verified lifetime stream counts
- Unranked gameplay for populated tracks without stream data
- Per-set completion progress and reset support
- Soundcharts enrichment for automated ranking
- CSV import for externally verified stream counts
- Local SQLite persistence through Prisma

### Difficulty thresholds

| Difficulty | Lifetime Spotify streams |
| --- | ---: |
| Easy | `>= 1,000,000,000` |
| Normal | `>= 250,000,000` |
| Hard | `>= 50,000,000` |
| Extreme | `>= 10,000,000` |
| Impossible | `< 10,000,000` |
| Unranked | Stream count or ranked difficulty not yet available |

When an Unranked track is successfully enriched, it automatically leaves the Unranked pool and becomes available in the appropriate ranked difficulty.

## Tech stack

- Next.js 16
- React 19
- TypeScript
- Prisma
- SQLite
- Spotify Web API
- Spotify Web Playback SDK
- Soundcharts API
- Vitest
- Playwright

## Requirements

- Node.js `>= 20.11.0`
- npm
- Git
- Spotify Premium account
- Spotify Developer application

Soundcharts API credentials are optional unless automatic stream-count enrichment is required.

## Installation

### Windows

Install Git and Node.js if necessary:

```powershell
winget install Git.Git
winget install OpenJS.NodeJS.LTS
```

Clone and install:

```powershell
git clone https://github.com/ekrzychu/spotify-songless.git
Set-Location spotify-songless
npm ci
Copy-Item .env.example .env.local
```

Edit the environment file:

```powershell
notepad .env.local
```

### Linux

Install Git, Node.js, and npm using the package manager appropriate for the distribution.

Arch Linux example:

```bash
sudo pacman -S git nodejs npm
```

Clone and install:

```bash
git clone https://github.com/ekrzychu/spotify-songless.git
cd spotify-songless
npm ci
cp .env.example .env.local
```

Edit `.env.local` with the preferred editor.

### macOS

Using Homebrew:

```bash
brew install git node
```

Clone and install:

```bash
git clone https://github.com/ekrzychu/spotify-songless.git
cd spotify-songless
npm ci
cp .env.example .env.local
```

Edit `.env.local` with the preferred editor.

## Environment configuration

`.env.example` contains the supported local configuration:

```env
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/api/auth/spotify/callback
SESSION_SECRET=replace-with-at-least-32-random-characters
DATABASE_URL=file:./dev.db
ALLOWED_DEV_ORIGINS=127.0.0.1,192.168.0.15
SPOTIFY_MARKET=US
SOUNDCHARTS_CLIENT_ID=
SOUNDCHARTS_CLIENT_SECRET=
SOUNDCHARTS_QUOTA_RESERVE=50
SOUNDCHARTS_DEBUG=false
```

Generate a session secret with Node.js:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Required Spotify values:

```env
SPOTIFY_CLIENT_ID=<spotify-client-id>
SPOTIFY_CLIENT_SECRET=<spotify-client-secret>
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/api/auth/spotify/callback
SESSION_SECRET=<generated-secret>
DATABASE_URL=file:./dev.db
SPOTIFY_MARKET=US
```

Optional Soundcharts configuration:

```env
SOUNDCHARTS_CLIENT_ID=<soundcharts-client-id>
SOUNDCHARTS_CLIENT_SECRET=<soundcharts-client-secret>
SOUNDCHARTS_QUOTA_RESERVE=50
SOUNDCHARTS_DEBUG=false
```

Do not commit `.env.local`.

## Spotify Developer application

Configure the Spotify application for:

- Web API
- Web Playback SDK

Add the following redirect URI exactly:

```text
http://127.0.0.1:3000/api/auth/spotify/callback
```

For Spotify Development Mode, add each Spotify account that will use the application to the app's user-management list. Browser playback requires Spotify Premium.

## Database setup

Create or synchronize the local SQLite database:

```bash
npm run db:push
```

The default local database is:

```text
prisma/dev.db
```

The database is not committed to Git. A newly cloned repository therefore starts with an empty catalog.

## Catalog population

### Inspect catalog status

```bash
npm run catalog:status
```

### Preview the population plan

```bash
npm run catalog:populate -- --plan
```

Plan mode is local-only and does not call Spotify.

### Populate tracks

Example initial population:

```bash
npm run catalog:populate -- --target=5000 --max-requests=500
```

Example larger target:

```bash
npm run catalog:populate -- --target=20000 --max-requests=500
```

Population progress is stored in:

```text
.runtime/catalog-populate-checkpoint.json
```

If a run stops because of its request budget, Spotify quota, or an interruption, rerun the same command to continue from the checkpoint.

Do not use `--reset-checkpoint` unless intentionally starting a new population configuration.

### Population options

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

### Discovery strategy

Catalog discovery uses deterministic Spotify Search shards for every active genre and release year from 1970 through the current UTC year.

Current genre queries:

| Category | Spotify query |
| --- | --- |
| Pop | `genre:pop` |
| Rock | `genre:rock` |
| Hip-Hop / Rap | `genre:hip-hop` |
| R&B / Soul | `genre:r-n-b` |
| Electronic / Dance | `genre:electronic` |
| Classical | `genre:classical` |

Example shards:

```text
genre:rock year:1977
genre:pop year:2005
genre:electronic year:2014
genre:classical year:2020
```

The importer processes shards breadth-first by checkpoint offset. Spotify Search pages are requested sequentially with up to 10 tracks per page. Duplicate Spotify track IDs are upserted rather than inserted as duplicate rows.

Decade categories are derived from the Spotify release date stored during ingestion.

## Unranked gameplay

Newly populated tracks do not have verified stream counts by default:

```text
streamCount = null
difficulty = null
```

Eligible tracks are immediately available in the **Unranked** difficulty.

Normal gameplay eligibility requires Spotify playability, track-level game eligibility, and language eligibility. The current language policy accepts unknown or uncertain classifications and tracks classified as English, Polish, or Spanish; tracks confidently classified as another language are excluded.

## Soundcharts enrichment

Soundcharts enrichment assigns verified lifetime stream counts and ranked difficulties to eligible Unranked tracks.

### Preview candidates

```bash
npm run streams:plan:soundcharts -- --limit=25
```

The planner is local-only and performs no API requests or database writes.

### Run a canary

```bash
npm run streams:enrich:soundcharts -- --canary
```

Canary mode processes one recording group with a small request budget and reports Soundcharts quota telemetry.

### Enrich a controlled batch

```bash
npm run streams:enrich:soundcharts -- --limit=25 --max-api-requests=75
```

Repeat controlled batches as quota permits.

Successful enrichment writes the verified stream count and ranked difficulty to the existing track. No additional migration is required to move the track out of Unranked gameplay.

Normal enrichment excludes previously resolved groups without usable audience data and definitive Soundcharts `NOT FOUND` groups. Optional retry flags are available when required:

```text
--include-cached-unranked
--include-not-found
```

Candidate ordering is neutral and deterministic after eligibility filtering:

1. number of eligible local target tracks represented
2. normalized ISRC availability
3. stable deterministic key ordering

Category and difficulty coverage are reporting diagnostics only and do not determine enrichment order.

## Import stream counts from CSV

Verified stream counts can also be imported from CSV.

Required header:

```csv
spotify_track_id,isrc,stream_count
```

Windows:

```powershell
npm run import:streams -- .\data\streams.csv
```

Linux/macOS:

```bash
npm run import:streams -- ./data/streams.csv
```

Tracks are matched by Spotify track ID first and normalized ISRC second.

## Running the application

Start the development server:

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:3000
```

The local Spotify callback is configured for `127.0.0.1`; use the same host when running the development application.

## Fresh installation workflow

After cloning the repository and configuring `.env.local`, the standard setup is:

```bash
npm ci
npm run db:push
npm run catalog:status
npm run catalog:populate -- --plan
npm run catalog:populate -- --target=5000 --max-requests=500
npm run catalog:status
npm run dev
```

At this point the populated catalog is available in Unranked mode.

To begin creating ranked pools:

```bash
npm run streams:plan:soundcharts -- --limit=25
npm run streams:enrich:soundcharts -- --canary
npm run streams:enrich:soundcharts -- --limit=25 --max-api-requests=75
npm run catalog:status
```

## Updating an existing installation

For an existing local installation with a populated database:

```bash
git pull
npm ci
npm run db:push
npm run catalog:status
```

`dev.db`, `.env.local`, and `.runtime/` are ignored by Git and are not replaced by a normal pull.

Do not delete the database or reset the catalog checkpoint when updating unless a specific migration or maintenance task requires it.

## Maintenance commands

### Catalog audits

```bash
npm run catalog:audit-genres
npm run catalog:audit-languages
npm run catalog:audit-soundcharts-metadata
```

These audits are read-only and do not call external APIs.

### Backfills for older databases

```bash
npm run catalog:backfill-decades
npm run catalog:backfill-game-eligibility
npm run catalog:backfill-languages
npm run catalog:backfill-game-categories
```

Current fresh installations do not normally require these commands because new catalog rows are created using the current schema and eligibility logic.

## Testing

Run the standard checks:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Install Playwright Chromium once:

```bash
npx playwright install chromium
```

Run browser tests:

```bash
npm run test:browser
```

## npm scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Next.js development server |
| `npm run build` | Create a production build |
| `npm run start` | Start the production build |
| `npm run db:push` | Synchronize the Prisma schema with SQLite |
| `npm run catalog:status` | Display catalog, ranked, and Unranked counts |
| `npm run catalog:populate -- --plan` | Preview catalog population |
| `npm run catalog:populate -- ...` | Populate tracks from Spotify Search |
| `npm run streams:plan:soundcharts -- --limit=25` | Preview Soundcharts enrichment candidates |
| `npm run streams:enrich:soundcharts -- --canary` | Run one Soundcharts enrichment canary |
| `npm run streams:enrich:soundcharts -- --limit=25 --max-api-requests=75` | Enrich a controlled batch |
| `npm run import:streams -- <csv>` | Import verified lifetime stream counts |
| `npm run catalog:audit-genres` | Run the local genre audit |
| `npm run catalog:audit-languages` | Run the local language audit |
| `npm run catalog:audit-soundcharts-metadata` | Audit stored Soundcharts metadata |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript validation |
| `npm test` | Run Vitest tests |
| `npm run test:browser` | Run Playwright browser tests |

## Local data and security

The following local files and directories are ignored by Git:

```text
.env
.env.local
.env.*.local
dev.db
.runtime/
node_modules/
.next/
```

Spotify and Soundcharts credentials must remain server-side and must not be committed.

spodle does not store Spotify audio. Playback is provided by Spotify through the Web Playback SDK.

## License

No license has been specified for this repository.
