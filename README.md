# VB Transit Arcade

Made by **Vishal Balaji**.

A personal commute router for Munich. Combines **realtime MVV transit** (EFA) with **Open-Meteo weather** to recommend the fastest door-to-door option between two freely chosen places, including "bike to the station" and "bike all the way" options when the weather allows.

Live: **https://personal-route-planner.vishalvichu45.workers.dev** · Source: **https://github.com/VishalBalaji321/personal-route-planner**

## Features

- Freely choosable start & destination — search any address, station or place (EFA stopfinder + Open-Meteo geocoding + Nominatim)
- **Saved commutes** — save the current route as a one-tap preset chip; saved places with a "home" flag
- Realtime MVV departures with live delays (no cached schedules)
- Weather-based bike verdict: temp ≥ 5°C, rain probability < 40%, ≤ 0.1 mm over the next 2 hours
- Bike-to-station (only if > 600 m) and full-bike (only from a place marked "home"), capped by a "max bike time" setting
- Options ranked by arrival time; leg-by-leg timeline with **change-hub highlighting**, platforms and delays
- Depart "now" or at a specific time (stale times reset to the user's current time)
- Retro pixel-art, mobile-first UI; auto-refresh every 60 s; offline fallback with a "stale" badge

## Privacy

- **No personal data is committed to the repo.** Places, routes and commutes live in your browser's `localStorage` (`commute:places`, `commute:route`, `commute:saved`, `commute:settings`) and are sent to the API per request. The Worker is stateless — nothing is stored server-side.
- The bundled stop list (`public/data/stops.json`) is public OSM/MVV transit data only.
- **This repo is public** — never commit addresses, coordinates, or any other personal data. See `AGENTS.md`.

## Tech

- Cloudflare Worker + Hono (TypeScript), free tier — no KV/D1/DO, only static `ASSETS`
- Vanilla JS frontend (no build step), state in `localStorage`
- Data: MVV EFA (`efa.mvv-muenchen.de/ng`), Open-Meteo (forecast + geocoding), Nominatim (addresses)

## API

```
GET  /api/search?q=<text>                       stations (EFA) + places + addresses
GET  /api/stations?lat=<lat>&lon=<lon>          nearest EFA stations (for a new place)
GET  /api/station?stopId=<id>                   name + coords for a stop id
POST /api/commute  {"from": PlaceSpec, "to": PlaceSpec, "maxBikeMinutes": n, "start": ISO}
GET  /api/health
```

`PlaceSpec` = `{ id, name, isHome, stations: [{ stopId, label, lat, lon, walkMin, bikeMin, distanceMeters }] }`.

## Development

```bash
npm install         # install deps
npx tsc --noEmit    # typecheck
npx vitest run      # tests
npx wrangler dev    # local dev on :8787
npx wrangler deploy # deploy
```

> On the author's machine the bare `npm`/`npx` are Windows binaries that break under WSL — prefix `/home/visha/n/bin/` there.

See `AGENTS.md` for architecture, domain quirks (EFA date format, stop IDs, realtime fields), and conventions.
