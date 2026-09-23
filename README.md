# Moje parcele · Teren

Phone-first parcel field map. Open `/teren.html` (the root redirects there).

## Capabilities
- Exact parcel search against the public GeoSrbija search service, filtering parcel number, cadastral municipality, and municipality; EPSG:32634 conversion to WGS84 and back.
- "Parcele oko mene": every parcel within 150 m of the GPS fix (or of the map centre) drawn as vector outlines with numbers; tap one to select it. This reuses the spatial `circle` request the GeoSrbija map viewer itself sends on a click (`st:"circle", s:"E,N,R", layers:"586,"`), so it needs no token or account. The place line for such parcels is the Latin half of the service's `desc` (cadastral municipality and municipality together).
- Canvas vector map with polygon holes, vertices, pan, pinch zoom, scale, north reference.
- User-initiated download of a bounded OpenStreetMap extract (~1 km around parcel center) through the app's own `/api/surroundings` Worker route: roads, tracks, buildings, land use, water. ODbL attribution links remain visible. No standard OSM tile bulk download.
- Device-local IndexedDB parcels and surroundings, service-worker app shell cache with explicit completeness check. App never reports full offline readiness based on geometry alone.
- Foreground high-accuracy geolocation, accuracy circle, nearest-boundary distance, inside/outside/uncertain status; stale fixes identified after 30 seconds or GPS stop.
- External Google/Apple road navigation to a selected vertex; offline straight-line bearing/distance. No offline road-routing engine or background tracking.
- JSON backup export/import; import validates official polygon geometry before use.

## Data provenance
The app ships with no built-in parcel. On online startup it requests location and automatically loads actual cadastral polygons within 150 m of the first fresh GPS fix. It refreshes after movement of 75 m, at most once per 30 seconds, with one request in flight. Tapping a polygon selects it; manual search and saved-parcel selection stop automatic nearby updates. Offline startup opens a saved parcel. Nearby searches paginate up to 1,000 records and label an incomplete result explicitly. Every boundary comes from a live GeoSrbija search and carries its retrieval date. Nearby data is fetched on explicit Save for terrain. Public upstream availability is not guaranteed. `tests/fixtures/parcel.json` is a real search result (1227/2 Pepeljevac, Lajkovac, retrieved 2026-09-16) used only by the geometry tests.

Location fixes stay in page memory; there is no analytics or tracking history. To load nearby parcels, the current search center is sent to GeoSrbija after location permission is granted. External navigation uses only the selected destination in the URL. Parcel searches go from the browser to GeoSrbija (its servers were observed to time out for datacenter IPs, so they are not proxied; `GEOSRBIJA_URL` in `public/config.js` lets a deployment point at its own proxy). Surroundings go to the app's own Worker route, which forwards only a bounded query to Overpass.

## Surroundings service
`app/api/surroundings/route.ts` (`GET /api/surroundings?lat=&lon=`) is the only place that talks to Overpass. It validates that the centre lies in Serbia, rounds it to ~100 m, builds the fixed query from `lib/surroundings.js`, and returns `{elements, bbox, downloadedAt, source}`. Responses carry `Cache-Control: public, max-age=86400, s-maxage=604800` so the hosting CDN shares one download between users for 7 days (the browser also rounds the centre to 3 decimals so the URLs match); on Cloudflare the Workers Cache API is used in addition. Requests with `Sec-Fetch-Site: cross-site` are refused so other sites cannot use the deployment as a relay.

`OVERPASS_URL` (environment variable, comma-separated) lists the upstreams; the default is the public `overpass-api.de` followed by two public mirrors. Public instances are randomly busy (the same query answers in 3 s or returns 504), so the route hedges: each next upstream is started 5 s after the previous one, a busy 429/504 answer is retried once after 3 s, the first good answer wins and the others are aborted, all within a 50 s budget. Buildings are requested only within ~500 m of the parcel (roads, water, woods and land use within ~1 km) to keep town packages around 3 MB instead of 7 MB.

This only softens the problem. Production should run its own Overpass instance with the Serbia extract and list it first in `OVERPASS_URL`; `deploy/overpass/` contains a ready docker-compose (Overpass + Caddy HTTPS, protected by the `OVERPASS_KEY` header the route sends when the variable is set) and step-by-step instructions. For per-user limits use a rate-limiting rule of the hosting platform on `/api/surroundings`; the route itself has none.

`public/config.js` holds the browser-side setting `SURROUNDINGS_URL` (default `/api/surroundings`).

## Offline use
Install via Safari Add to Home Screen / Android install, open from installed icon online, save each parcel, wait for confirmed shell and data storage. Verify reopening in airplane mode before going into the field. Browser storage can be evicted or cleared; export a backup. GPS must be enabled and have a signal. Background updates while the app is closed are not implemented.

## Validation
`node --test tests/*.test.mjs`: nearest segment distance, holes, multipolygons, bearings, fixture coordinate/area, no built-in parcel, surroundings service validation and query, app shell completeness, offline navigation and asset fetch behavior, API exclusions.
Live managed-browser checks: successful GeoSrbija search; Overpass download; device storage persists through page reload; map renders actual parcel and surrounding roads. Managed HTTP preview does not permit a service worker or WebMCP: physical-phone GPS, installed PWA cold start in airplane mode, and WebMCP runtime validation remain unverified. Do not describe these as device-tested.

## Deployment
The project is a standard Next.js app: `pnpm build` runs `next build`, so importing the repository into Vercel works with the defaults (framework Next.js, output `.next`). Static frontend files in `public/` are self-contained and `app/page.tsx` provides the root redirect. Set the `OVERPASS_URL` environment variable in the hosting dashboard when you have your own Overpass instance; the `/api/surroundings` function declares `maxDuration = 60` because public Overpass instances can take 20–50 s to answer.

The original Sites/Cloudflare Worker packaging remains available as `pnpm dev:cloudflare`, `pnpm build:cloudflare` and `pnpm start:cloudflare` (vinext + wrangler). The API route reads settings from `process.env` and uses the Workers cache only when it exists, so the same code runs on both hosts.
