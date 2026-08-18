# AGENTS.md

Guidance for AI agents (and future humans) working on this repo. Read this before changing anything.

## What this is

**RadlDash MUC** — a personal commute router for Munich, deployed as a free-tier Cloudflare Worker. It combines realtime MVV transit (EFA) with Open-Meteo weather to recommend the fastest door-to-door option between two freely chosen places, including "bike to the station" and "bike all the way" options when the weather allows.

Live URL: **https://personal-route-planner.vishalvichu45.workers.dev**

## Privacy model (important)

- **No personal data is committed to the repo.** Places (names, addresses, coordinates, chosen stations) live in the user's browser (`localStorage`, key `commute:places`) and are sent to the API per request. The repo only holds a generic seed (`SEED_PLACES` in `src/config.ts`) with public transit stations — no street addresses, no home coordinates.
- The Worker is stateless (no KV/D1/DO): place data is used transiently for a request and never stored server-side.
- GPS "current location" is an **ephemeral** place (`id: "gps"`, in-memory only, never written to `commute:places`); it is re-fixed from the browser on load and dropped on failure.
- Default seed (first run): Home (station Moosach Bf `91000300`), BMW Garching (Carl-von-Linde `1002009`, Voithstraße `1002012`), BMW FIZ (Am Hart `91000760`).
- **This repo is PUBLIC.** History was rewritten to purge the one commit that contained personal addresses. Never commit addresses, coordinates of private locations, or personal routines — keep anything like that in browser `localStorage` only.

## Environment gotchas (important)

- **Use `/home/visha/n/bin/npm` and `/home/visha/n/bin/npx`**, never bare `npm`/`npx`. The bare ones on PATH are Windows binaries (`/mnt/c/Program Files/nodejs/`) and break under WSL (workerd install fails with "UNC paths are not supported"). `node` itself is Linux (`/home/visha/n/bin/node`, v24).
- **`wrangler dev` / `wrangler deploy` run detached.** The agent shell kills foreground processes on timeout. Start them with `setsid nohup /home/visha/n/bin/npx wrangler dev --port 8787 > /tmp/opencode/wrangler.log 2>&1 &` and poll the log. Logs and temp files go in `/tmp/opencode/`.
- This repo is a git repo, remote `origin` → GitHub (SSH). Commit + push only when asked. To push, an ssh-agent must be running — point `SSH_AUTH_SOCK` at the agent socket (`ls /tmp/ssh-*/agent.*`) first.

## Commands

```bash
/home/visha/n/bin/npm install            # after changing deps
/home/visha/n/bin/npx tsc --noEmit       # typecheck
/home/visha/n/bin/npx vitest run         # tests (23 tests across 3 files)
/home/visha/n/bin/npx wrangler dev       # local dev (detached, see above)
/home/visha/n/bin/npx wrangler deploy    # deploy to production (detached)

git add -A && git commit -m "..."        # commit
SSH_AUTH_SOCK=$(ls /tmp/ssh-*/agent.* | head -1) git push origin main
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
- **Frontend**: vanilla JS (`public/app.js`), no build step. Places (`commute:places`), route (`commute:route`), saved commutes (`commute:saved`), settings (`commute:settings`), last data (`commute:last`) in `localStorage`. Retro pixel-art theme (Press Start 2P + VT323 via Google Fonts).
- **API**:
  - `GET /api/search?q=` → stations (EFA), places (Open-Meteo), addresses (Nominatim).
  - `GET /api/stations?lat=&lon=` → nearest EFA stations with access times (for setting up a new place).
  - `GET /api/station?stopId=` → name + coords for a stop id.
  - `GET /api/reverse?lat=&lon=` → short place name for a coordinate (GPS current location, via Nominatim reverse).
  - `POST /api/commute` body `{ from: PlaceSpec, to: PlaceSpec, maxBikeMinutes?, travelMode?, start? }` → `weather`, `options` (ranked by arrival), `errors`. `travelMode` is `"auto"` (weather decides) | `"bike"` (force bike, hides walk-access options) | `"transit"` (no bike).
  - `GET /api/health`.
- Route cards: header shows the route endpoints (`Home > BMW Garching`); the transport summary (`S1 > 292`) is secondary; transfer hubs get a `CHANGE` badge on the timeline.

## Stop list (`public/data/stops.json`)

- ~11.7k MVV stops (name + WGS84 lat/lon), extracted once from OpenStreetMap via Overpass (nodes tagged `public_transport=platform`, `railway=station|stop|halt|tram_stop`, `highway=bus_stop` in the Munich metro bbox; deduped by name + rounded coords).
- Loaded in the Worker via `env.ASSETS.fetch("/data/stops.json")` (not bundled, to keep the script small). Do not inline it into the Worker bundle.
- Used for nearest-stop lookup; the **numeric EFA stop id is resolved live** via EFA stopfinder (`searchStops`) + DM (`stopInfo`) — names/coords from OSM ≠ EFA ids.
- To refresh the list, re-run the Overpass query (see the `munich-transit-realtime` skill) and regenerate the file.

## Domain quirks (see also the `munich-transit-realtime` skill)

- MVV EFA (`https://efa.mvv-muenchen.de/ng/`) is the only working realtime source. The old `www.mvg.de/api/*` endpoints are dead (404); `v6.db.transport.rest` is unreliable (503).
- `itdDate` MUST be `YYYYMMDD`. `DD.MM.YYYY` and `DDMMYYYY` are both parsed wrongly (month/day out of range).
- EFA address geocoding is broken (`-8010`). Always query **stop→stop** with numeric stop IDs (`type_origin=stop&name_origin=<id>`). Ambiguous names return 0 trips — disambiguate with the numeric ID.
- **Stopfinder response shape varies**: unique matches are `points.point` (object), multi-matches are `points` as an index-object OR array — and list matches omit coordinates (resolve via `stopInfo`/DM). `pointsToList` + `parseStopfinderCandidates` handle this.
- **Free-text search ranking** (`src/search.ts`): address-like queries (contain digits or street words) skip EFA stopfinder and go straight to Nominatim, then Open-Meteo — otherwise foreign-city stops ("Marienplatz" in Stuttgart, …) drown out the address. Station/place names keep stops first, sorted with Munich-area matches on top.
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

- Title: "RadlDash MUC". Route labels: "Home", "BMW Garching", "BMW FIZ".
- Settings (user-local, in `localStorage` under `commute:settings`): max bike time (default 20 min), depart "now" vs specific time (stale past times reset to "now").
- Saved commutes (`commute:saved`): one-tap route presets shown as chips; save button next to the route picker.
- Footer: "Made by Vishal Balaji" linking to the GitHub repo.
- The user iterated through several visual styles before settling on retro pixel art — don't change the theme without being asked.
