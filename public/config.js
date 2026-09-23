// Deployment settings. Edit here or rewrite this file in your CI.
// Route on this deployment that packages OpenStreetMap surroundings.
export const SURROUNDINGS_URL='/api/surroundings';
// Public GeoSrbija search endpoint; the browser calls it directly (cross-origin works because
// the service replies with permissive CORS). Point it at your own proxy if RGZ ever changes that.
export const GEOSRBIJA_URL='https://a3.geosrbija.rs/WebServices/search/SearchProxy.asmx/Search';
