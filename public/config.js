// Deployment settings for the browser app.
// Surroundings are downloaded through the app's own Worker route (app/api/surroundings),
// which builds the Overpass query, caches results and talks to the upstream set by the
// OVERPASS_URL environment variable. The browser never calls Overpass directly.
export const SURROUNDINGS_URL='/api/surroundings';
