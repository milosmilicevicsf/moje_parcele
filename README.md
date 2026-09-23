# Moje parcele · Teren

Phone-first parcel field map. Open `/teren.html` (the root redirects there).

## Capabilities
- Exact parcel search against the public GeoSrbija search service, filtering parcel number, cadastral municipality, and municipality; EPSG:32634 conversion to WGS84.
- Canvas vector map with polygon holes, vertices, pan, pinch zoom, scale, north reference.
- User-initiated download of a bounded OpenStreetMap Overpass extract (~1 km around parcel center): roads, tracks, buildings, land use, water. ODbL attribution links remain visible. No standard OSM tile bulk download.
- Device-local IndexedDB parcels and surroundings, service-worker app shell cache with explicit completeness check. App never reports full offline readiness based on geometry alone.
- Foreground high-accuracy geolocation, accuracy circle, nearest-boundary distance, inside/outside/uncertain status; stale fixes identified after 30 seconds or GPS stop.
- External Google/Apple road navigation to a selected vertex; offline straight-line bearing/distance. No offline road-routing engine or background tracking.
- JSON backup export/import; import validates official polygon geometry before use.

## Data provenance
The app ships with no built-in parcel. On first open it shows an empty map and the search form; afterwards it opens the most recently saved parcel from the device. Every boundary comes from a live GeoSrbija search and carries its retrieval date. Nearby data is fetched on explicit Save for terrain. Public upstream availability is not guaranteed. `tests/fixtures/parcel.json` is a real search result (1227/2 Pepeljevac, Lajkovac, retrieved 2026-09-16) used only by the geometry tests.

Location fixes stay in page memory; no analytics or location server transmission. External navigation uses only the selected destination in the URL. Parcel searches go to GeoSrbija; area downloads go to Overpass.

## Configuration
`public/config.js` holds deployment settings: `OVERPASS_URL` (surroundings source) and `SURROUNDINGS_RADIUS` (download box half-width in degrees). The default is the public Overpass instance, which is acceptable for personal use only; a deployment for many users must point `OVERPASS_URL` to its own Overpass instance or a caching proxy so the load and the failure modes are under your control.

## Offline use
Install via Safari Add to Home Screen / Android install, open from installed icon online, save each parcel, wait for confirmed shell and data storage. Verify reopening in airplane mode before going into the field. Browser storage can be evicted or cleared; export a backup. GPS must be enabled and have a signal. Background updates while the app is closed are not implemented.

## Validation
`node --test tests/field.test.mjs`: nearest segment distance, holes, multipolygons, bearings, fixture coordinate/area, no built-in parcel, app shell completeness, offline navigation and asset fetch behavior, API exclusions.
Live managed-browser checks: successful GeoSrbija search; Overpass download; device storage persists through page reload; map renders actual parcel and surrounding roads. Managed HTTP preview does not permit a service worker or WebMCP: physical-phone GPS, installed PWA cold start in airplane mode, and WebMCP runtime validation remain unverified. Do not describe these as device-tested.

The app is packaged with the managed Sites Vinext starter. Static frontend files are self-contained; Vinext provides the root redirect. Native Sites workflow builds and publishes the Cloudflare Worker and its assets.
