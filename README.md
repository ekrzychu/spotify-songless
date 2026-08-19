# spodle

**spodle** is an unlimited Spotify song-guessing game built with Next.js, React, Prisma and SQLite.

A round starts with a very short intro. Every wrong guess or skip unlocks a longer stage:

```text
0.1s → 1s → 2s → 5s → 10s → 15s
```

The game supports:

- Spotify Web Playback SDK playback
- six unlimited-play guessing stages
- local song search while guessing — no live Spotify Search request is needed for autocomplete
- categories by genre and decade
- ranked difficulties based on verified lifetime Spotify stream counts
- an **Unranked** mode for populated songs that do not yet have verified stream counts
- per-set progress and resettable completion history
- automatic difficulty assignment after Soundcharts enrichment
- local SQLite storage through Prisma

Ranked difficulty thresholds are:

| Difficulty | Verified lifetime Spotify streams |
| --- | ---: |
| Easy | `>= 1,000,000,000` |
| Normal | `>= 250,000,000` |
| Hard | `>= 50,000,000` |
| Extreme | `>= 10,000,000` |
| Impossible | `< 10,000,000` |
| Unranked | no verified stream count/difficulty yet |

Successfully enriching an Unranked track automatically removes it from the Unranked pool and makes it available in the correct ranked difficulty. No manual move or migration is required.

---

## Fresh clone: what is and is not included

The Git repository contains the application code, Prisma schema and npm lockfile.

A fresh clone **does not** contain:

- `.env.local`
- your Spotify or Soundcharts credentials
- `dev.db`
- previously populated songs
- `.runtime/catalog-populate-checkpoint.json`
- your local game/session progress

Those files are intentionally ignored by Git.

This means somebody cloning the repository today must:

1. install Node.js dependencies
2. create `.env.local`
3. configure a Spotify Developer application
4. create the local SQLite database
5. populate Spotify tracks into the local catalog
6. optionally enrich tracks with Soundcharts to create ranked difficulties
7. start the application

### Do I need a `.venv`?

**No.**

spodle is a Node.js/TypeScript application, not a Python application. Do not create a Python `.venv` for this project.

Dependencies are installed into `node_modules` with npm. The repository includes `package-lock.json`, so `npm ci` is the preferred installation command for a fresh clone.

---

# Requirements

Required:

- **Node.js 20.11.0 or newer**
- npm
- Git
- a Spotify Premium account
- a Spotify Developer application

Optional, but required for automatic ranked-difficulty enrichment:

- Soundcharts API client credentials

Spotify does not provide lifetime stream counts through the normal Spotify Web API, so ranked play requires verified stream-count data from Soundcharts or an imported verified CSV.

The app does not download, proxy, modify or store Spotify audio.

---

# Installation

## Windows

### 1. Install Git and Node.js

If you do not already have them, one option on Windows 10/11 is `winget`:

```powershell
winget install Git.Git
winget install OpenJS.NodeJS.LTS
```

Close and reopen PowerShell after installation, then verify:

```powershell
git --version
node --version
npm --version
```

`node --version` must be at least `v20.11.0`.

### 2. Clone the repository

```powershell
git clone https://github.com/ekrzychu/spotify-songless.git
Set-Location spotify-songless
```

### 3. Install dependencies

```powershell
npm ci
```

### 4. Create the environment file

```powershell
Copy-Item .env.example .env.local
notepad .env.local
```

Continue with [Environment configuration](#environment-configuration).

---

## Linux

Install Git, Node.js 20.11+ and npm with the method appropriate for your distribution.

For example, on Arch Linux:

```bash
sudo pacman -S git nodejs npm
```

On distributions whose default repository ships an older Node.js release, install a current Node.js LTS release through your preferred Node version manager or the official Node.js distribution method instead.

Verify:

```bash
git --version
node --version
npm --version
```

`node --version` must be at least `v20.11.0`.

### Clone and install

```bash
git clone https://github.com/ekrzychu/spotify-songless.git
cd spotify-songless
npm ci
cp .env.example .env.local
```

Edit the environment file with your preferred editor, for example:

```bash
nano .env.local
```

Continue with [Environment configuration](#environment-configuration).

---

## macOS

Install Git and Node.js 20.11+.

If you use Homebrew:

```bash
brew install git node
```

Verify:

```bash
git --version
node --version
npm --version
```

`node --version` must be at least `v20.11.0`.

### Clone and install

```bash
git clone https://github.com/ekrzychu/spotify-songless.git
cd spotify-songless
npm ci
cp .env.example .env.local
```

Edit `.env.local` with your preferred editor.

Continue with [Environment configuration](#environment-configuration).

---

# Environment configuration

The repository contains `.env.example` with the currently supported variables:

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

## Generate `SESSION_SECRET`

This command works on Windows, Linux and macOS as long as Node.js is installed:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the generated value into:

```env
SESSION_SECRET=<generated-value>
```

Never commit `.env.local` or paste its contents into issues, logs or chat messages.

## Required Spotify values

Set:

```env
SPOTIFY_CLIENT_ID=<your-client-id>
SPOTIFY_CLIENT_SECRET=<your-client-secret>
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/api/auth/spotify/callback
DATABASE_URL=file:./dev.db
SPOTIFY_MARKET=US
```

`SPOTIFY_MARKET` is a two-letter market such as `US` or `PL`. It is used during Spotify catalog discovery unless a population command overrides it with `--market=XX`.

`ALLOWED_DEV_ORIGINS` is only for additional Next.js development hosts. It does **not** change Spotify OAuth. The Spotify redirect URI must remain the exact configured callback.

## Optional Soundcharts values

If you want automatic stream-count enrichment, also configure:

```env
SOUNDCHARTS_CLIENT_ID=<your-client-id>
SOUNDCHARTS_CLIENT_SECRET=<your-client-secret>
SOUNDCHARTS_QUOTA_RESERVE=50
SOUNDCHARTS_DEBUG=false
```

If these are left empty, the app can still use populated tracks in **Unranked** mode. Ranked difficulties require verified stream counts from Soundcharts or CSV import.

---

# Spotify Developer Dashboard setup

Open the Spotify Developer Dashboard and configure the application for:

- Web API
- Web Playback SDK

Add this redirect URI **exactly**:

```text
http://127.0.0.1:3000/api/auth/spotify/callback
```

Do not replace `127.0.0.1` with `localhost`.

For Spotify Development Mode, add every Spotify account that will test the application under the app's user-management settings. Playback requires Spotify Premium.

---

# Create the local database

After `.env.local` is configured, run:

```bash
npm run db:push
```

This creates/synchronizes the local SQLite database and generates the Prisma client.

The database is stored locally as:

```text
dev.db
```

`dev.db` is intentionally ignored by Git.

## Fresh install: do I need the backfill commands?

Normally, **no**.

A fresh empty database populated by the current code already receives the current:

- decade associations
- gameplay eligibility state
- language classification/eligibility state
- category rows

The `catalog:backfill-*` commands exist mainly for upgrading older local databases created by previous versions of spodle.

For a brand-new installation, the normal sequence is simply:

```text
npm ci
→ configure .env.local
→ npm run db:push
→ populate catalog
→ optionally enrich streams
→ npm run dev
```

---

# Populate the Spotify catalog

A brand-new database contains **zero songs**. Catalog population is therefore required before normal gameplay can select tracks.

## 1. Check the current catalog

```bash
npm run catalog:status
```

On a completely fresh installation, the track counts should initially be zero.

## 2. Preview the population plan

```bash
npm run catalog:populate -- --plan
```

Plan mode is local-only. It does not request a Spotify access token and does not call Spotify Search.

## 3. Populate tracks

A practical first target is 5,000 tracks:

```bash
npm run catalog:populate -- --target=5000 --max-requests=500
```

To grow the catalog further later:

```bash
npm run catalog:populate -- --target=20000 --max-requests=500
```

The command stops cleanly when it reaches its request budget, target, Spotify quota limit or an intentional interruption.

If it stops before the target, simply rerun the **same command** later:

```bash
npm run catalog:populate -- --target=20000 --max-requests=500
```

Do not reset the checkpoint just because a run stopped.

## Population checkpoint

Progress is saved after completed Spotify Search pages in:

```text
.runtime/catalog-populate-checkpoint.json
```

The checkpoint is local and ignored by Git.

Rerunning catalog population resumes from that checkpoint.

Use:

```text
--reset-checkpoint
```

only when you intentionally want to create a new population run identity, for example after deliberately changing the population market or year range.

## Population options

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

The defaults currently include:

- target: `20,000`
- first year: `1970`
- last year: current UTC year
- maximum results considered per genre/year shard: `100`
- Spotify Search page size: `10`
- maximum requests per run: `500`
- delay between requests: `300ms`

---

# How Spotify songs are collected

Catalog population is **not random**.

spodle creates deterministic Spotify Search shards for each active genre and year.

Current search genres are:

```text
Pop                  genre:pop
Rock                 genre:rock
Hip-Hop / Rap        genre:hip-hop
R&B / Soul           genre:r-n-b
Electronic / Dance   genre:electronic
Classical            genre:classical
```

For every year from 1970 through the current UTC year, the importer creates searches such as:

```text
genre:rock year:1977
genre:pop year:2005
genre:electronic year:2014
genre:classical year:2020
```

Population is breadth-first by checkpoint offset. In simplified form:

```text
first page from each genre/year shard
→ next page from each still-active shard
→ next page
→ ...
```

Spotify Search pages are requested sequentially, at up to 10 tracks per page.

The importer itself does not randomly shuffle the Spotify Search results and does not build a global popularity ranking. Spotify decides the order of results returned for each genre/year query.

Duplicate Spotify track IDs are upserted rather than inserted as duplicate database tracks.

Decade categories are derived from the Spotify release date stored during ingestion. Because release metadata can represent a reissue/remaster, decade data is intentionally kept separate from Soundcharts release-date metadata.

---

# What happens immediately after population?

Newly populated tracks normally have:

```text
streamCount = null
difficulty = null
```

They are therefore **Unranked**.

If they pass the normal playback, game-eligibility and language-policy filters, they can already be played in:

```text
Difficulty → Unranked
```

This makes it possible to use a large freshly populated catalog before every track has been enriched with stream counts.

The current language policy is:

```text
unknown / uncertain        → accepted
en / pl / es               → accepted
classified other language  → rejected
```

Obvious non-song items caught by the conservative local classifier are also excluded from normal gameplay.

---

# Rank tracks with Soundcharts

Soundcharts enrichment is optional for Unranked play, but required if you want the automatically assigned ranked difficulties.

## 1. Check the offline plan

```bash
npm run streams:plan:soundcharts -- --limit=25
```

This command:

- reads SQLite only
- does not request a Soundcharts OAuth token
- makes no Spotify request
- makes no Soundcharts customer request
- performs no database writes

The planner reports how many fresh eligible recording groups remain.

## 2. Run one canary first

```bash
npm run streams:enrich:soundcharts -- --canary
```

Canary mode attempts one recording group with a small customer-request budget. Inspect the quota telemetry before starting a larger run.

## 3. Enrich a normal batch

A conservative normal batch is:

```bash
npm run streams:enrich:soundcharts -- --limit=25 --max-api-requests=75
```

Run it again whenever you want to rank more songs and the Soundcharts quota permits it.

You do **not** need to enrich the entire catalog before using the application.

## Automatic Unranked → ranked transition

If a track starts as:

```text
streamCount = null
difficulty = null
```

it is available in Unranked mode.

If Soundcharts later verifies, for example:

```text
streamCount = 560000000
difficulty = normal
```

then on subsequent round selection it automatically:

```text
leaves Unranked
→ becomes available in Normal
```

There is no separate migration command.

## Previously resolved or NOT FOUND groups

Normal enrichment excludes two special states by default:

- resolved Soundcharts UUID but no usable audience value
- definitive Soundcharts resolver NOT FOUND

They can be deliberately retried with:

```text
--include-cached-unranked
--include-not-found
```

Do not add these flags to normal batches unless you intentionally want to retry those groups.

The normal neutral Soundcharts ordering is based on:

1. number of eligible local target tracks represented by the recording group
2. availability of a normalized ISRC
3. deterministic stable ordering

Genre/decade/difficulty deficits are reporting diagnostics only and do not control candidate order.

---

# Alternative: import verified stream counts from CSV

If you already have a verified stream-count dataset, prepare:

```text
data/streams.csv
```

with:

```csv
spotify_track_id,isrc,stream_count
```

Windows PowerShell:

```powershell
npm run import:streams -- .\data\streams.csv
```

Linux/macOS:

```bash
npm run import:streams -- ./data/streams.csv
```

Tracks are matched by Spotify track ID first and normalized ISRC second.

The importer never invents missing counts.

---

# Start the application

Development mode:

```bash
npm run dev
```

Open exactly:

```text
http://127.0.0.1:3000
```

Do not use `localhost` for the Spotify OAuth callback unless you intentionally change both the Spotify Developer Dashboard and application configuration. The recommended local configuration uses `127.0.0.1`.

On first use, connect the Spotify Premium account through the UI.

---

# Recommended fresh-install sequence

If you cloned the repository **right now**, this is the complete setup order.

## Windows PowerShell

```powershell
git clone https://github.com/ekrzychu/spotify-songless.git
Set-Location spotify-songless
npm ci
Copy-Item .env.example .env.local
notepad .env.local
```

Then:

1. configure Spotify Developer Dashboard
2. fill in `.env.local`
3. optionally add Soundcharts credentials
4. run:

```powershell
npm run db:push
npm run catalog:status
npm run catalog:populate -- --plan
npm run catalog:populate -- --target=5000 --max-requests=500
npm run catalog:status
npm run dev
```

At this point the newly populated songs can be played in **Unranked** mode.

To start building ranked pools afterward:

```powershell
npm run streams:plan:soundcharts -- --limit=25
npm run streams:enrich:soundcharts -- --canary
npm run streams:enrich:soundcharts -- --limit=25 --max-api-requests=75
npm run catalog:status
```

## Linux/macOS

```bash
git clone https://github.com/ekrzychu/spotify-songless.git
cd spotify-songless
npm ci
cp .env.example .env.local
```

Edit `.env.local`, configure Spotify, then run:

```bash
npm run db:push
npm run catalog:status
npm run catalog:populate -- --plan
npm run catalog:populate -- --target=5000 --max-requests=500
npm run catalog:status
npm run dev
```

At this point the newly populated songs can be played in **Unranked** mode.

Optional ranked enrichment:

```bash
npm run streams:plan:soundcharts -- --limit=25
npm run streams:enrich:soundcharts -- --canary
npm run streams:enrich:soundcharts -- --limit=25 --max-api-requests=75
npm run catalog:status
```

---

# Updating an existing installation

If you already have a local spodle installation with a populated `dev.db`, do **not** delete the database or population checkpoint just to update the code.

Typical update:

```bash
git pull
npm ci
npm run db:push
npm run catalog:status
```

Because `dev.db`, `.env.local` and `.runtime/` are ignored by Git, normal pulls do not overwrite them.

If a particular release requires a local backfill, run the specific documented backfill for that change. Do not blindly reset the catalog or checkpoint.

---

# Useful catalog commands

## Status

```bash
npm run catalog:status
```

Shows, among other things:

- total catalog tracks
- Spotify-playable tracks
- game-eligible/ineligible tracks
- raw ranked tracks
- gameplay-ranked tracks
- raw Unranked tracks
- gameplay-eligible Unranked tracks
- difficulty coverage
- genre/decade coverage
- language-policy counts

## Genre audit

```bash
npm run catalog:audit-genres
```

SQLite-only. No external API request and no writes.

## Language audit

```bash
npm run catalog:audit-languages
```

SQLite-only. No external API request and no writes.

## Soundcharts metadata audit

```bash
npm run catalog:audit-soundcharts-metadata
```

SQLite-only. Compares stored Spotify/Soundcharts metadata without changing category relations.

---

# Backfill commands for older databases

These are primarily maintenance tools for an existing database created by older code.

```bash
npm run catalog:backfill-decades
npm run catalog:backfill-game-eligibility
npm run catalog:backfill-languages
npm run catalog:backfill-game-categories
```

They are local database operations and do not need to be part of the normal fresh-install path.

---

# Development and verification

Run the standard checks:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

For browser tests, install Playwright Chromium once:

```bash
npx playwright install chromium
```

Then:

```bash
npm run test:browser
```

The browser tests mock Spotify-facing application behavior and do not automate a real Spotify login.

---

# Main npm commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | start Next.js development server |
| `npm run build` | production build |
| `npm run start` | start built production app |
| `npm run db:push` | sync SQLite schema and generate Prisma client |
| `npm run catalog:status` | inspect catalog/ranked/unranked counts |
| `npm run catalog:populate -- --plan` | preview population locally |
| `npm run catalog:populate -- ...` | discover/populate Spotify tracks |
| `npm run streams:plan:soundcharts -- --limit=25` | preview Soundcharts candidates offline |
| `npm run streams:enrich:soundcharts -- --canary` | one-group Soundcharts test |
| `npm run streams:enrich:soundcharts -- --limit=25 --max-api-requests=75` | rank a controlled batch |
| `npm run import:streams -- <csv>` | import verified stream counts |
| `npm run catalog:audit-genres` | read-only genre audit |
| `npm run catalog:audit-languages` | read-only language audit |
| `npm run catalog:audit-soundcharts-metadata` | read-only metadata audit |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript check |
| `npm test` | Vitest unit tests |
| `npm run test:browser` | Playwright browser tests |

---

# Local data and security

The following are intentionally ignored by Git:

```text
.env
.env.local
.env.*.local
dev.db
.runtime/
node_modules/
.next/
```

Important rules:

- never commit Spotify credentials
- never commit Soundcharts credentials
- never commit `.env.local`
- never log access/refresh tokens
- Spotify audio is streamed by Spotify; spodle does not store audio files
- the browser necessarily receives the Spotify URI required for playback

Authentication uses Spotify Authorization Code with PKCE. Sensitive refresh/client credentials remain server-side.

---

# Gameplay notes

## Ranked vs Unranked

Ranked play requires both:

```text
streamCount != null
difficulty != null
```

Unranked means at least one of those values is still null.

Both ranked and Unranked selection also require the normal gameplay eligibility checks.

## Categories

Current game categories include:

- All Music
- Pop
- Rock
- Hip-Hop / Rap
- R&B / Soul
- Electronic / Dance
- Classical
- 70s
- 80s
- 90s
- 2000s
- 2010s
- 2020s

For non-All categories, only gameplay-enabled category relations are used.

## Set progress

Progress is scoped to the current session + category + difficulty.

Finished songs are not repeated in that set until progress is reset. When every currently available song in a set has been completed, the UI reports that the set is complete and offers a progress reset.

---

# Spotify and Soundcharts quota behavior

Spotify catalog population and Soundcharts enrichment are separate systems.

## Spotify

Catalog population uses Spotify Search and therefore consumes Spotify Web API capacity.

If Spotify returns a quota-exhausted response, the population run stops cleanly and preserves the last completed-page checkpoint. Rerun the same population command later.

## Soundcharts

Soundcharts enrichment has its own customer-request budget and quota telemetry.

HTTP request count is **not** assumed to be equal to Soundcharts charged quota consumption. The application treats the `x-quota-remaining` response header, when supplied, as the observed quota signal.

`SOUNDCHARTS_QUOTA_RESERVE` provides a safety reserve after a valid quota header has been observed.

---

# Deployment note

The current repository is primarily designed and tested as a local application.

Before public deployment, review the current Spotify Web Playback SDK documentation, Spotify Developer Mode/Extended Quota requirements, Spotify platform policies, session/cookie deployment settings, database persistence strategy and production HTTPS/OAuth callback configuration.
