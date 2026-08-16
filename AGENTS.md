# AGENTS.md

Guidance for AI agents (and future humans) working on this repo. Read this before changing anything.

## What this is

**VB Transit Arcade** — a personal commute router for Munich, deployed as a free-tier Cloudflare Worker. It combines realtime MVV transit (EFA) with Open-Meteo weather to recommend the fastest door-to-door option between two freely chosen places, including "bike to the station" and "bike all the way" options when the weather allows.

Live URL: **https://personal-route-planner.vishalvichu45.workers.dev**

## Privacy model (important)

- **No personal data is committed to the repo.** Places (names, addresses, coordinates, chosen stations) live in the user's browser (`localStorage`, key `commute:places`) and are sent to the API per request. The repo only holds a generic seed (`SEED_PLACES` in `src/config.ts`) with public transit stations — no street addresses, no home coordinates.
- The Worker is stateless (no KV/D1/DO): place data is used transiently for a request and never stored server-side.
- Default seed (first run): Home (station Moosach Bf `91000300`), BMW Garching (Carl-von-Linde `1002009`, Voithstraße `1002012`), BMW FIZ (Am Hart `91000760`).

## Environment gotchas (important)

- **Use `/home/visha/n/bin/npm` and `/home/visha/n/bin/npx`**, never bare `npm`/`npx`. The bare ones on PATH are Windows binaries (`/mnt/c/Program Files/nodejs/`) and break under WSL (workerd install fails with "UNC paths are not supported"). `node` itself is Linux (`/home/visha/n/bin/node`, v24).
- **`wrangler dev` / `wrangler deploy` run detached.** The agent shell kills foreground processes on timeout. Start them with `setsid nohup /home/visha/n/bin/npx wrangler dev --port 8787 > /tmp/opencode/wrangler.log 2>&1 &` and poll the log. Logs and temp files go in `/tmp/opencode/`.
- This repo IS a git repo (added later) with remote `origin` → GitHub. Commit only when asked.

## Commands

```bash
/home/visha/n/bin/npm install            # after changing deps
/home/visha/n/bin/npx tsc --noEmit       # typecheck
/home/visha/n/bin/npx vitest run         # tests (23 tests across 3 files)
/home/visha/n/bin/npx wrangler dev       # local dev (detached, see above)
/home/visha/n/bin/npx wrangler deploy    # deploy to production (detached)
```

## Architecture

- **Cloudflare Worker + Hono** (`src/index.ts`). Free tier, no KV/D1/DO — only the `ASSETS` binding (static files in `public/`, incl. the MVV stop list at `public/data/stops.json`).
- Modules:
  - `src/config.ts` — tuning constants (walk/bike speeds, thresholds, defaults), `SEED_PLACES`, time/distance helpers.
  - `src/efa.ts` — MVV EFA client: trip search, stopfinder (`searchStops`), single-stop info (`stopInfo`), timezone helpers.
  - `src/geocode.ts` — Open-Meteo (places) + Nominatim (street addresses).
  - `src/search.ts` — merged free-text search across EFA stops / Open-Meteo / Nominatim.
  - `src/stations.ts` — nearest-station resolution (bundled OSM stop list + EFA stopfinder).
  - `src/weather.ts` — Open-Meteo forecast + `computeWeather` bike verdict.
  - `src/planner.ts` — assembles + ranks options for arbitrary `PlaceSpec` pairs.
  - `src/types.ts` — shared types (`PlaceSpec`, `StationSpec`, options, response).
- **Frontend**: vanilla JS (`public/app.js`), no build step. Places (`commute:places`), route (`commute:route`), settings (`commute:settings`), last data (`commute:last`) in `localStorage`. Retro pixel-art theme (Press Start 2P + VT323 via Google Fonts).
- **API**:
  - `GET /api/search?q=` → stations (EFA), places (Open-Meteo), addresses (Nominatim).
  - `GET /api/stations?lat=&lon=` → nearest EFA stations with access times (for setting up a new place).
  - `GET /api/station?stopId=` → name + coords for a stop id.
  - `POST /api/commute` body `{ from: PlaceSpec, to: PlaceSpec, maxBikeMinutes?, start? }` → `weather`, `options` (ranked by arrival), `errors`.
  - `GET /api/health`.

## Domain quirks (see also the `munich-transit-realtime` skill)

- MVV EFA (`https://efa.mvv-muenchen.de/ng/`) is the only working realtime source. The old `www.mvg.de/api/*` endpoints are dead (404); `v6.db.transport.rest` is unreliable (503).
- `itdDate` MUST be `YYYYMMDD`. `DD.MM.YYYY` and `DDMMYYYY` are both parsed wrongly (month/day out of range).
- EFA address geocoding is broken (`-8010`). Always query **stop→stop** with numeric stop IDs (`type_origin=stop&name_origin=<id>`). Ambiguous names return 0 trips — disambiguate with the numeric ID.
- **Stopfinder response shape varies**: unique matches are `points.point` (object), multi-matches are `points` as an index-object OR array — and list matches omit coordinates (resolve via `stopInfo`/DM). `pointsToList` + `parseStopfinderCandidates` handle this.
- Realtime: `useRealtime=1&coordOutputFormat=WGS84[DD.ddddd]`. Realtime dep/arr are `legs[].points[].dateTime.rtTime`; fall back to `time`. Transfers appear as `footpath[]` (duration in min) or `Fussweg` legs.
- EFA rate-limits transiently under bursts (returns 0 trips / null points). Space out scripted requests (~2–3 s).
- Nearest-station resolution uses `public/data/stops.json` (bundled OSM/MVV stop list, loaded in the Worker via `ASSETS.fetch`) + EFA stopfinder for the numeric stop id.
- Weather bike verdict (`src/weather.ts`): next-2h window, bike allowed iff temp ≥ 5 °C AND precip-prob < 40 % AND precip ≤ 0.1 mm. Bike-to-station requires >600 m (`MIN_BIKE_TO_STATION_METERS`).

## Conventions

- No comments in code unless asked.
- Keep the pixel-art visual language. **ASCII-only glyphs in user-facing strings** — pixel fonts lack `→ · ′ ⚠ — °` (use `>`, `|`, `'`, `!`, `-`, `C`). Press Start 2P only for numeric/iconic readouts; VT323 for body/labels.
- Tests use fixtures in `test/fixtures/` (live EFA/Open-Meteo JSON captured once). Add/refresh fixtures rather than mocking raw responses.
- After any code change: run `tsc --noEmit`, `vitest run`, then `wrangler dev` smoke test, then `wrangler deploy`.

## User preferences captured along the way

- Title: "VB Transit Arcade". Route labels: "Home", "BMW Garching", "BMW FIZ".
- Settings (user-local, in `localStorage` under `commute:settings`): max bike time (default 20 min), depart "now" vs specific time.
- The user iterated through several visual styles before settling on retro pixel art — don't change the theme without being asked.
