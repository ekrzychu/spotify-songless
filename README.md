# Spodle

Spodle is an unlimited Spotify song-guessing game built with Next.js, React, Prisma, and SQLite.

Players identify songs from progressively longer intros, choose a genre or decade, and play across ranked difficulty levels or an Unranked pool.

## Features

- Spotify Web Playback SDK playback
- Six intro stages: `0.1s`, `1s`, `2s`, `5s`, `10s`, `15s`
- Unlimited rounds
- Local song autocomplete during gameplay
- Genre and decade categories
- Five ranked difficulty levels
- Unranked gameplay for catalog tracks without ranking data
- Per-set completion tracking and reset support
- Spotify account logout and switching
- Optional Soundcharts enrichment
- Generic CSV import for verified stream counts
- Local SQLite persistence through Prisma
- Unit and browser test suites

## Difficulty levels

Ranked difficulties use verified lifetime Spotify stream counts:

| Difficulty | Lifetime Spotify streams |
| --- | ---: |
| Easy | `>= 1,000,000,000` |
| Normal | `>= 250,000,000` |
| Hard | `>= 50,000,000` |
| Extreme | `>= 10,000,000` |
| Impossible | `< 10,000,000` |
| Unranked | No ranked stream data available |

When an eligible Unranked track receives verified stream data, it automatically becomes available in the appropriate ranked difficulty.

## Tech stack

- Next.js 16
- React 19
- TypeScript
- Prisma
- SQLite
- Spotify Web API
- Spotify Web Playback SDK
- Soundcharts API integration
- Vitest
- Playwright

## Requirements

- Node.js `>= 20.11.0`
- npm
- Git
- Spotify Premium account
- Spotify Developer application

Soundcharts credentials are optional and are only required if you want to use automatic Soundcharts enrichment.

---

## Installation

### Windows

Install Git and Node.js if needed:

```powershell
winget install Git.Git
winget install OpenJS.NodeJS.LTS
```

Clone the repository and install dependencies:

```powershell
git clone https://github.com/ekrzychu/spodle.git
Set-Location spodle
npm ci
Copy-Item .env.example .env.local
```

Edit the environment file:

```powershell
notepad .env.local
```

### Linux

Install Git, Node.js, and npm with your distribution's package manager.

Arch Linux example:

```bash
sudo pacman -S git nodejs npm
```

Clone the repository and install dependencies:

```bash
git clone https://github.com/ekrzychu/spodle.git
cd spodle
npm ci
cp .env.example .env.local
```

Edit `.env.local` with your preferred editor.

### macOS

Using Homebrew:

```bash
brew install git node
```

Clone the repository and install dependencies:

```bash
git clone https://github.com/ekrzychu/spodle.git
cd spodle
npm ci
cp .env.example .env.local
```

Edit `.env.local` with your preferred editor.

---

## Environment configuration

Copy `.env.example` to `.env.local` and configure the local installation.

Typical configuration:

```env
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/api/auth/spotify/callback

SESSION_SECRET=
DATABASE_URL=file:./dev.db

ALLOWED_DEV_ORIGINS=127.0.0.1
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

At minimum, configure:

```env
SPOTIFY_CLIENT_ID=<spotify-client-id>
SPOTIFY_CLIENT_SECRET=<spotify-client-secret>
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/api/auth/spotify/callback
SESSION_SECRET=<generated-secret>
DATABASE_URL=file:./dev.db
SPOTIFY_MARKET=US
```

Do not commit `.env.local`.

---

## Spotify Developer application

Create a Spotify Developer application and configure it for the Spotify Web API and Web Playback SDK.

Add this redirect URI exactly:

```text
http://127.0.0.1:3000/api/auth/spotify/callback
```

For applications running in Spotify Development Mode, add each Spotify account that should be allowed to use the app through Spotify's developer user-management settings.

Browser playback requires Spotify Premium.

Spodle connects one Spotify account at a time. When connected, use **Log out** to disconnect the current account, then use **Connect Spotify** to authorize another allowed account.

---

## Database setup

Create or synchronize the local SQLite database:

```bash
npm run db:push
```

The default local database is:

```text
prisma/dev.db
```

The database is local and is not committed to Git. A fresh clone therefore starts with an empty catalog.

---

## Running Spodle

Start the development server:

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:3000
```

Use `127.0.0.1` rather than `localhost` so the browser origin matches the configured Spotify callback.

For a production build:

```bash
npm run build
npm run start
```

---

## Catalog population

A fresh database does not contain songs. Spodle can populate its local catalog from Spotify Search.

### Check catalog status

```bash
npm run catalog:status
```

### Preview the population plan

```bash
npm run catalog:populate -- --plan
```

Plan mode does not call Spotify or modify the database.

### Populate the catalog

Use the default population settings:

```bash
npm run catalog:populate
```

Or override selected options:

```bash
npm run catalog:populate -- --target=20000 --max-requests=500
```

Population progress is stored in:

```text
.runtime/catalog-populate-checkpoint.json
```

If a run stops because of its request budget, Spotify quota, or an interruption, rerun the population command to continue from the checkpoint.

Do not use `--reset-checkpoint` unless you intentionally want to start a new population configuration.

### Population options

```text
--target=<track count>
--year-from=<year>
--year-to=<year>
--max-per-shard=<results per genre/year shard>
--max-requests=<request budget for this run>
--delay-ms=<delay between requests>
--market=<two-letter market>
--plan
--reset-checkpoint
```

The default catalog strategy searches active genre/year shards from 1970 through the current UTC year.

Current genre categories include:

| Category | Spotify query |
| --- | --- |
| Pop | `genre:pop` |
| Rock | `genre:rock` |
| Hip-Hop / Rap | `genre:hip-hop` |
| R&B / Soul | `genre:r-n-b` |
| Electronic / Dance | `genre:electronic` |
| Classical | `genre:classical` |

Decade categories are derived from the release date stored during ingestion.

Duplicate Spotify track IDs are reused rather than inserted as duplicate catalog rows.

---

## Unranked gameplay

Newly populated catalog tracks may not yet have verified lifetime stream counts.

Tracks without ranked stream data can be played in **Unranked** mode as long as they meet the normal gameplay eligibility rules.

Gameplay eligibility includes:

- Spotify playability
- track-level game eligibility
- language eligibility

The current language policy accepts unknown or uncertain classifications, plus tracks confidently classified as English, Polish, or Spanish.

---

## Ranked stream data

Spodle supports two general ways to add verified stream-count data:

1. Soundcharts enrichment
2. CSV import

These workflows update existing catalog tracks rather than creating a separate song catalog.

### Soundcharts enrichment

Soundcharts integration is optional.

Configure:

```env
SOUNDCHARTS_CLIENT_ID=<soundcharts-client-id>
SOUNDCHARTS_CLIENT_SECRET=<soundcharts-client-secret>
SOUNDCHARTS_QUOTA_RESERVE=50
SOUNDCHARTS_DEBUG=false
```

Preview enrichment candidates:

```bash
npm run streams:plan:soundcharts -- --limit=25
```

Run a small canary:

```bash
npm run streams:enrich:soundcharts -- --canary
```

Run a controlled batch:

```bash
npm run streams:enrich:soundcharts -- --limit=25 --max-api-requests=75
```

Successful enrichment stores verified stream data and assigns the canonical ranked difficulty.

Optional retry flags include:

```text
--include-cached-unranked
--include-not-found
```

Candidate selection is deterministic after eligibility filtering.

### Import verified stream counts from CSV

Verified stream counts can also be imported from a CSV file.

Expected header:

```csv
spotify_track_id,isrc,stream_count
```

Windows example:

```powershell
npm run import:streams -- .\data\streams.csv
```

Linux/macOS example:

```bash
npm run import:streams -- ./data/streams.csv
```

Tracks are matched by Spotify track ID first and normalized ISRC second.

Keep private or licensed datasets out of Git unless their license explicitly permits redistribution.

---

## Fresh installation workflow

A typical fresh setup is:

```bash
npm ci
npm run db:push
npm run catalog:status
npm run catalog:populate -- --plan
npm run catalog:populate
npm run catalog:status
npm run dev
```

After population, songs without verified stream data are available through Unranked mode.

If Soundcharts is configured, ranked pools can then be built gradually:

```bash
npm run streams:plan:soundcharts -- --limit=25
npm run streams:enrich:soundcharts -- --canary
npm run streams:enrich:soundcharts -- --limit=25 --max-api-requests=75
npm run catalog:status
```

---

## Updating an existing installation

For an existing local installation:

```bash
git pull
npm ci
npm run db:push
npm run catalog:status
```

Local runtime data such as `.env.local`, the SQLite database, and `.runtime/` is not replaced by a normal Git pull.

Do not delete the database or reset the catalog checkpoint unless a specific migration or maintenance task requires it.

---

## Maintenance

### Catalog audits

```bash
npm run catalog:audit-genres
npm run catalog:audit-languages
npm run catalog:audit-soundcharts-metadata
```

### Backfills

Older databases may occasionally need one of the available backfills:

```bash
npm run catalog:backfill-decades
npm run catalog:backfill-game-eligibility
npm run catalog:backfill-languages
npm run catalog:backfill-game-categories
```

Fresh installations normally do not require manual backfills.

---

## Testing

Run the standard project checks:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Run Vitest in watch mode while developing:

```bash
npm run test:watch
```

Install Playwright Chromium once:

```bash
npx playwright install chromium
```

Run browser tests:

```bash
npm run test:browser
```

The `tests/` directory is part of the project and verifies behavior such as authentication, catalog population, ranking rules, gameplay logic, imports, and regressions.

---

## npm scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Next.js development server |
| `npm run build` | Create a production build |
| `npm run start` | Start the production build |
| `npm run db:push` | Synchronize the Prisma schema with SQLite |
| `npm run catalog:status` | Display catalog and ranking status |
| `npm run catalog:populate -- --plan` | Preview catalog population |
| `npm run catalog:populate` | Populate or continue populating the catalog |
| `npm run catalog:audit-genres` | Run the local genre audit |
| `npm run catalog:audit-languages` | Run the local language audit |
| `npm run catalog:audit-soundcharts-metadata` | Audit stored Soundcharts metadata |
| `npm run streams:plan:soundcharts -- --limit=25` | Preview Soundcharts enrichment candidates |
| `npm run streams:enrich:soundcharts -- --canary` | Run one Soundcharts enrichment canary |
| `npm run streams:enrich:soundcharts -- ...` | Run Soundcharts enrichment |
| `npm run import:streams -- <csv>` | Import verified stream counts |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript validation |
| `npm test` | Run Vitest tests |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run test:browser` | Run Playwright browser tests |

Some repository scripts are intended for development, diagnostics, or data maintenance and are therefore not listed as part of the normal user workflow.

---

## Local data and security

Keep credentials and local runtime data out of Git.

Common local-only files and directories include:

```text
.env
.env.local
.env.*.local
dev.db
.runtime/
data/*.csv
node_modules/
.next/
```

Never commit Spotify, Soundcharts, or other service credentials.

Do not commit private or licensed datasets.

Spodle does not store Spotify audio. Playback is provided by Spotify through the Web Playback SDK.

---

## Project structure

```text
spodle/
├── prisma/       Prisma schema and local database configuration
├── scripts/      Catalog, database, import, enrichment, and maintenance commands
├── src/          Application source code
├── tests/        Unit and integration tests
├── data/         Local data files
└── .runtime/     Local runtime/checkpoint state
```

---

## License

No license has been specified for this repository.
