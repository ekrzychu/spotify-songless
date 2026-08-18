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
SOUNDCHARTS_DEBUG=false
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
npm run catalog:audit-genres
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

`npm run catalog:status` is also local-only. It reports total/playable, game-eligible/game-ineligible, gameplay-ranked, and raw ranked/unranked counts plus active genre and decade pool coverage and a separate language-policy section. Historical removed-category relations are not included in active pool reporting.

`npm run catalog:audit-genres` is a read-only SQLite audit. It contacts neither Spotify nor Soundcharts, requests no OAuth token, and never modifies category relations. The report shows active-genre overlap counts, samples of classical crossover associations, and a conservative title-based track-quality audit. Overlaps are evidence for review, not automatic declarations that a relation is incorrect. Historical relations do not contain Spotify search-shard provenance, so the audit does not invent it.

Catalog population does not spend Soundcharts quota, does not call Soundcharts, does not assign difficulty, and does not invent stream counts. New tracks remain unranked until verified stream counts are imported. A fixed request count cannot guarantee 20,000 tracks because Spotify page exhaustion and duplicate track IDs vary by shard.

Spotify rate limits use importer-specific bounded retries. A `QUOTA_EXCEEDED` response stops cleanly with the last completed-page checkpoint preserved for a later rerun.

Decade membership is derived from each track's Spotify release date during ingestion, so catalog population only performs genre searches. To reconcile decade associations for tracks already in the local database without contacting Spotify, run:

```powershell
npm run catalog:backfill-decades
```

The backfill preserves genre associations, upserts the matching decade relation for release years from 1970 through 2029, removes stale decade relations, and prints the resulting count for every decade.

Gameplay suitability is stored separately from Spotify playability. `playable` continues to mean that Spotify can play the track for the current workflow; `gameEligible` is derived from the conservative title-quality classifier and is required by normal round selection. After applying the additive schema fields with `npm run db:push`, reconcile all existing tracks locally with:

```powershell
npm run catalog:backfill-game-eligibility
```

This deterministic backfill reads and updates SQLite only. It reports scanned, eligible, excluded, updated, and per-reason counts. It changes only `gameEligible`; existing stream counts, difficulty, Soundcharts provenance, and category relations are preserved.

Normal gameplay and Soundcharts enrichment also use a separate language policy. Unclassified, unknown, and uncertain tracks are accepted; classified `en`, `pl`, and `es` tracks are accepted; a track is rejected only when it is classified as another language. After first applying the additive language fields, or whenever policy logic changes, reconcile existing tracks locally with:

```powershell
npm run catalog:backfill-languages
```

Language precedence is a Spotify-ID manual override in `rules/language_overrides.json`, a trustworthy explicit provider value when one is available, the local `tinyld` detector, then unknown. Spotify currently supplies no trusted lyric-language field to this ingestion path. Detection uses the title and album title after removing common version markers. It requires at least 12 letters, three tokens, detector confidence 0.65, and a 0.20 lead over the next result. Short or uncertain metadata remains explicitly unclassified but accepted. This heuristic describes metadata language; it is not verified lyric language. Audit classifications without writes or network access with `npm run catalog:audit-languages`.

## Verify Soundcharts access

To test Soundcharts resolution and Spotify audience access against 10 deterministic, unranked catalog tracks, run:

```powershell
npm run soundcharts:test
```

Use a smaller diagnostic batch with `npm run soundcharts:test -- --limit 5`; values above 10 are clamped to 10. The command uses the current client-credentials flow, performs no database writes, and prints explicit OAuth/customer/retry telemetry. Soundcharts song-level Spotify audience values are cumulative Spotify stream counts.

HTTP request totals are not treated as quota consumption. Quota remaining is reported only when Soundcharts supplies a valid `x-quota-remaining` header on a customer API response. `SOUNDCHARTS_DEBUG=true` enables sanitized endpoint-family, status, quota-header, and retry diagnostics without logging credentials or tokens.

## Enrich stream counts from Soundcharts

Plan a neutral deterministic batch before making any external requests:

```powershell
npm run streams:plan:soundcharts -- --limit=100
```

The planner reads SQLite only: it requests no OAuth token, makes no Spotify or Soundcharts requests, and performs no database writes. It prints raw ranked counts separately from the category-by-difficulty gameplay matrix. Coverage and thin cells are reporting only. Normal enrichment targets require Spotify playability, persistent track eligibility, and `languageEligible=true`; this accepts unknown/unclassified tracks plus classified `en`, `pl`, and `es`, while rejecting classified other languages. Candidate difficulty remains unknown until verified Soundcharts stream counts are returned.

The default reporting target is 10 ranked tracks per active category/difficulty cell. `--target-per-cell=N` changes reporting only and never candidate selection. Use `--limit=N` or `--verbose` to adjust output. Previously resolved groups that still have no audience value are reported but excluded by default; include them deliberately with `--include-cached-unranked`.

Obvious non-song-like recording groups are also excluded from planning and enrichment by default. The conservative rules cover explicit skit, interview/entrevista, commentary, spoken-word, dialogue, and voice-memo/note markers after case, punctuation, diacritic, and whitespace normalization. Generic musical terms such as intro, outro, instrumental, mix, remix, live, demo, edit, remaster, and version are not excluded. `The Interview` remains an explicit eligible exact title; other interview markers at a title boundary are excluded as a documented conservative tradeoff. Use `--include-non-songlike` for deliberate debugging or manual review; the default exclusion is recommended for normal enrichment.

Start real enrichment with one canary recording group:

```powershell
npm run streams:enrich:soundcharts -- --canary
```

Canary mode selects exactly one recording group, disables refresh, and permits at most three customer API attempts. The OAuth token request is tracked separately and is not part of that three-request budget. Inspect its telemetry before running a small batch such as:

```powershell
npm run streams:enrich:soundcharts -- --limit=10 --max-api-requests=30
```

Execution uses the exact same neutral deterministic selector as the planner. After eligibility filtering, groups are ordered by the number of eligible local targets represented, valid normalized ISRC availability, then the stable hash/key comparison. Genre, decade, difficulty-cell deficit, and `target-per-cell` values do not affect selection or order.

The default execution limit is 100 groups, the maximum is 400, and the default hard customer API request budget is 300. Every customer attempt, including a 429 retry, consumes that execution budget; the OAuth request does not. The client does not call `/api/v2/team/usage` automatically. `SOUNDCHARTS_QUOTA_RESERVE` is enforced only after a valid quota header has been observed, while the hard request budget protects runs whose quota remains unknown.

Tracks with existing stream counts are skipped. Local Spotify versions sharing a normalized ISRC are processed as one recording group, identical Soundcharts stream values across Spotify identifiers are counted once, and successful values use the centralized difficulty classifier.

An explicit refresh updates missing tracks plus values whose current source is Soundcharts; CSV-owned values remain untouched:

```powershell
npm run streams:enrich:soundcharts -- --limit 100 --refresh
```

Resolved songs without audience data retain a null stream count and difficulty. The Soundcharts UUID is cached so a deliberate later attempt can skip identifier resolution; these cached-unranked groups remain excluded unless `--include-cached-unranked` is supplied.

Fresh song resolution also retains optional Soundcharts `releaseDate` and normalized root/subgenre metadata from that same resolver response, so capturing it costs no additional request. Metadata is propagated to every local Spotify version in the recording group. A group using an already-cached UUID does not perform another resolution merely to fill missing metadata, so older enriched rows may legitimately remain null.

Raw `TrackCategory` rows preserve Spotify discovery associations. Each row has separate gameplay trust fields; normal category rounds and planner coverage reporting require the relation to be gameplay-enabled. Fresh Soundcharts genre metadata validates only existing active genre relations through a small explicit alias table. Supported relations are enabled, unsupported relations are disabled only when at least one active Soundcharts genre maps successfully, and unmapped evidence leaves trust unchanged. Validation never creates or deletes genre rows and never validates decades. Apply the same rules to stored metadata locally with:

```powershell
npm run catalog:backfill-game-categories
```

The command is deterministic, idempotent, SQLite-only, and makes no external requests. Spotify catalog rediscovery keeps `update: {}` for existing relations, so it cannot silently re-enable a validated rejection.

Audit the stored evidence without network access or database writes:

```powershell
npm run catalog:audit-soundcharts-metadata
```

The SQLite-only report compares Spotify and Soundcharts release years/decades, lists the actual stored root genres and subgenres, and distinguishes raw local genres, gameplay-enabled genres, and explicitly mapped Soundcharts genres. It does not mutate category relations.

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
