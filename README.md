# Moje parcele · Teren

Phone-first parcel field map. Open `/teren.html` (the root redirects there).

## Capabilities
- Exact parcel search against the public GeoSrbija search service, filtering parcel number, cadastral municipality, and municipality; EPSG:32634 conversion to WGS84.
- Canvas vector map with polygon holes, vertices, pan, pinch zoom, scale, north reference.
- User-initiated download of a bounded OpenStreetMap extract (~1 km around parcel center) through the app's own `/api/surroundings` Worker route: roads, tracks, buildings, land use, water. ODbL attribution links remain visible. No standard OSM tile bulk download.
- Device-local IndexedDB parcels and surroundings, service-worker app shell cache with explicit completeness check. App never reports full offline readiness based on geometry alone.
- Foreground high-accuracy geolocation, accuracy circle, nearest-boundary distance, inside/outside/uncertain status; stale fixes identified after 30 seconds or GPS stop.
- External Google/Apple road navigation to a selected vertex; offline straight-line bearing/distance. No offline road-routing engine or background tracking.
- JSON backup export/import; import validates official polygon geometry before use.

## Data provenance
The app ships with no built-in parcel. On first open it shows an empty map and the search form; afterwards it opens the most recently saved parcel from the device. Every boundary comes from a live GeoSrbija search and carries its retrieval date. Nearby data is fetched on explicit Save for terrain. Public upstream availability is not guaranteed. `tests/fixtures/parcel.json` is a real search result (1227/2 Pepeljevac, Lajkovac, retrieved 2026-09-16) used only by the geometry tests.

Location fixes stay in page memory; no analytics or location server transmission. External navigation uses only the selected destination in the URL. Parcel searches go from the browser to GeoSrbija (its servers were observed to time out for datacenter IPs, so they are not proxied). Surroundings go to the app's own Worker route, which forwards only a bounded query to Overpass.

## Surroundings service
`app/api/surroundings/route.ts` (`GET /api/surroundings?lat=&lon=`) is the only place that talks to Overpass. It validates that the centre lies in Serbia, rounds it to ~100 m, builds the fixed query from `lib/surroundings.js`, and returns `{elements, bbox, downloadedAt, source}`. Responses carry `Cache-Control: public, max-age=86400, s-maxage=604800` so the hosting CDN shares one download between users for 7 days (the browser also rounds the centre to 3 decimals so the URLs match); on Cloudflare the Workers Cache API is used in addition. Requests with `Sec-Fetch-Site: cross-site` are refused so other sites cannot use the deployment as a relay.

`OVERPASS_URL` (environment variable, comma-separated) lists the upstreams tried in order; the default is the public `overpass-api.de` followed by two public mirrors. Public instances are often busy (504 "server too busy" was observed during development), so a deployment for many users should run its own Overpass instance and put it first. For per-user limits use a Cloudflare rate-limiting rule on `/api/surroundings`; the route itself has none.

`public/config.js` holds the browser-side setting `SURROUNDINGS_URL` (default `/api/surroundings`).

## Offline use
Install via Safari Add to Home Screen / Android install, open from installed icon online, save each parcel, wait for confirmed shell and data storage. Verify reopening in airplane mode before going into the field. Browser storage can be evicted or cleared; export a backup. GPS must be enabled and have a signal. Background updates while the app is closed are not implemented.

## Validation
`node --test tests/field.test.mjs`: nearest segment distance, holes, multipolygons, bearings, fixture coordinate/area, no built-in parcel, surroundings service validation and query, app shell completeness, offline navigation and asset fetch behavior, API exclusions.
Live managed-browser checks: successful GeoSrbija search; Overpass download; device storage persists through page reload; map renders actual parcel and surrounding roads. Managed HTTP preview does not permit a service worker or WebMCP: physical-phone GPS, installed PWA cold start in airplane mode, and WebMCP runtime validation remain unverified. Do not describe these as device-tested.

## Deployment
The project is a standard Next.js app: `pnpm build` runs `next build`, so importing the repository into Vercel works with the defaults (framework Next.js, output `.next`). Static frontend files in `public/` are self-contained and `app/page.tsx` provides the root redirect. Set the `OVERPASS_URL` environment variable in the hosting dashboard when you have your own Overpass instance; the `/api/surroundings` function declares `maxDuration = 60` because public Overpass instances can take 20–50 s to answer.

The original Sites/Cloudflare Worker packaging remains available as `pnpm dev:cloudflare`, `pnpm build:cloudflare` and `pnpm start:cloudflare` (vinext + wrangler). The API route reads settings from `process.env` and uses the Workers cache only when it exists, so the same code runs on both hosts.
