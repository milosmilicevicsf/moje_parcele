// Deployment settings. Change these when hosting the app for more than one user:
// the public Overpass instance has fair-use limits, so a wider deployment should
// point OVERPASS_URL to its own Overpass instance or a caching proxy.
export const OVERPASS_URL='https://overpass-api.de/api/interpreter';
// Half-width of the downloaded surroundings box, in degrees of latitude (~1 km).
export const SURROUNDINGS_RADIUS=.009;
